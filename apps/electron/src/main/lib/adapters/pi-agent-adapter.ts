/**
 * Pi Agent 适配器
 *
 * 将 pi-coding-agent AgentSession / pi-agent-core 的事件流翻译为 Kila 的 AgentEvent 流。
 * 同时提供最小兼容层：
 * - 渠道/模型 → Pi Model
 * - Kila JSONL 消息 → 首次迁移到 Pi Session sidecar
 * - thinkingLevel / 旧设置（thinking + effort）→ Pi thinkingLevel
 */

import type {
  AgentEvent as PiAgentEvent,
  AgentState as PiAgentState,
  AgentTool,
  BeforeToolCallContext,
  BeforeToolCallResult,
  ThinkingLevel as PiThinkingLevel,
} from '@earendil-works/pi-agent-core'
import type { Api, AssistantMessage, AssistantMessageEvent, ImageContent, Model, TextContent, ToolResultMessage } from '@earendil-works/pi-ai'
import type {
  AgentSession,
  AgentSessionEvent,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import type {
  AgentControlMessage,
  AgentEvent,
  AgentMessage,
  AgentQueryInput,
  AgentProviderAdapter,
  AgentEffort,
  Channel,
  ErrorCode,
  ThinkingLevel,
  ThinkingConfig,
  TypedError,
  ModelMetadataOverride,
  ProviderDbModel,
} from '@kila/shared'
import { extractKilaImageAttachments, inferApiTypeFromProvider, resolveModelMetadata, resolveThinkingLevel, type ModelCapabilitiesOverride } from '@kila/shared'
import { convertHistoryToPiMessages } from './pi-history-converter'
import { getPiAgentDir, getPiSessionDir } from '../config-paths'
import { resolveModelCost } from '../model-pricing'
import {
  createKilaModelRuntime,
  updateKilaModelRuntimeApiKey,
  type KilaModelRuntime,
} from './pi-model-runtime'


import { createLogger } from '../logger'
import { loadExternalEsm } from '../external-esm-loader'
const log = createLogger('Pi Agent')

type PiModel = Model<Api>
type PiQueryChannel = Pick<Channel, 'provider' | 'baseUrl' | 'apiType' | 'capabilityProviderId'>
type PiAiModule = typeof import('@earendil-works/pi-ai')
type PiCodingAgentModule = typeof import('@earendil-works/pi-coding-agent')
type PiRuntimeEvent = PiAgentEvent | AgentSessionEvent

let piAiModulePromise: Promise<PiAiModule> | undefined
let piCodingAgentModulePromise: Promise<PiCodingAgentModule> | undefined

export interface PiAgentQueryOptions extends AgentQueryInput {
  channel: PiQueryChannel
  apiKey: string
  systemPrompt: string
  tools: AgentTool[]
  historyMessages?: AgentMessage[]
  promptImages?: ImageContent[]
  rawPrompt?: string
  thinkingLevel?: ThinkingLevel
  thinking?: ThinkingConfig
  effort?: AgentEffort
  beforeToolCall?: (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>
  maxRetryDelayMs?: number
  /** 显式模型能力覆盖（来自旧 ChannelModel.capabilities） */
  modelCapabilities?: ModelCapabilitiesOverride
  /** 显式模型元数据覆盖（来自 ChannelModel.metadataOverride） */
  modelMetadata?: ModelMetadataOverride
  /** 已按渠道 capabilityProviderId 解析的 Provider DB 模型能力画像。 */
  modelProviderDbEntry?: ProviderDbModel
}

const FRIENDLY_ERROR_MESSAGES: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /not logged in|please run \/login/i,
    message: '请检查是否选择了正确的 Kila 供应渠道和模型',
  },
]

const PROMPT_TOO_LONG_PATTERNS = [
  'prompt is too long',
  'prompt_too_long',
  'input is too long',
  'context_length_exceeded',
  'maximum context length',
  'token limit',
  'exceeds the model',
  'request too large',
] as const

const OPENAI_COMPATIBLE_PROVIDERS = new Set<Channel['provider']>([
  'openai',
  'deepseek',
  'moonshot',
  'zhipu',
  'minimax',
  'doubao',
  'qwen',
  'custom',
])

/**
 * Pi 版本升级时的事件覆盖闸门。
 *
 * 任一 SDK 新增的 session 事件都会令 TypeScript 在这里报错，迫使我们明确选择：
 * 映射为 Kila AgentEvent、作为内部事件忽略，或者增加新的 UI/持久化语义。
 */
const PI_SESSION_EVENT_TYPES_ACCOUNTED_FOR: Record<AgentSessionEvent['type'], true> = {
  agent_start: true,
  agent_end: true,
  agent_settled: true,
  turn_start: true,
  turn_end: true,
  message_start: true,
  message_update: true,
  message_end: true,
  tool_execution_start: true,
  tool_execution_update: true,
  tool_execution_end: true,
  queue_update: true,
  compaction_start: true,
  entry_appended: true,
  session_info_changed: true,
  thinking_level_changed: true,
  compaction_end: true,
  auto_retry_start: true,
  auto_retry_end: true,
}

/** Pi assistant 流内部事件同样必须在升级时显式审计。 */
const PI_ASSISTANT_MESSAGE_EVENT_TYPES_ACCOUNTED_FOR: Record<AssistantMessageEvent['type'], true> = {
  start: true,
  text_start: true,
  text_delta: true,
  text_end: true,
  thinking_start: true,
  thinking_delta: true,
  thinking_end: true,
  toolcall_start: true,
  toolcall_delta: true,
  toolcall_end: true,
  done: true,
  error: true,
}

// 保留上述常量的运行时零成本引用，同时让 lint/构建不会把覆盖闸门视为死代码。
void PI_SESSION_EVENT_TYPES_ACCOUNTED_FOR
void PI_ASSISTANT_MESSAGE_EVENT_TYPES_ACCOUNTED_FOR

const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
} as const

// Electron 主进程当前产物是 CJS，Pi 包是 ESM-only。
// 运行时必须使用原生动态 import，避免 bundle 产物生成 require('@earendil-works/...')。
export function loadPiAi(): Promise<PiAiModule> {
  piAiModulePromise ??= loadExternalEsm<PiAiModule>('@earendil-works/pi-ai')
  return piAiModulePromise
}

export function loadPiCodingAgent(): Promise<PiCodingAgentModule> {
  piCodingAgentModulePromise ??= loadExternalEsm<PiCodingAgentModule>('@earendil-works/pi-coding-agent')
  return piCodingAgentModulePromise
}

/**
 * 将 Kila Channel 的显式协议选择映射为 Pi API。
 *
 * `apiType` 是 Kila 渠道配置的协议真相源，必须优先于 provider / model ID 猜测。
 * 只有旧渠道没有 apiType 时，才保留 GPT-5/o 系列的 Responses API 历史推断，避免
 * 老配置升级后无提示地改变请求协议。
 */
export function resolvePiApiType(channel: PiQueryChannel, modelId: string): Api {
  const apiType = channel.apiType ?? inferApiTypeFromProvider(channel.provider)

  switch (apiType) {
    case 'anthropic':
      return 'anthropic-messages'
    case 'google':
      return 'google-generative-ai'
    case 'openai-responses':
      return 'openai-responses'
    case 'openai':
    case 'ollama':
    case 'custom':
      // 旧配置没有 apiType 时，沿用 Kila 对新 OpenAI 推理模型的 Responses API 推断。
      if (!channel.apiType && prefersOpenAIResponses(modelId)) return 'openai-responses'
      return 'openai-completions'
  }
}

function getPiProviderId(channel: PiQueryChannel, modelId: string): string {
  const api = resolvePiApiType(channel, modelId)
  if (api === 'anthropic-messages') return 'anthropic'
  if (api === 'google-generative-ai') return 'google'
  if (OPENAI_COMPATIBLE_PROVIDERS.has(channel.provider)) return 'openai'
  return channel.provider
}

function prefersOpenAIResponses(modelId: string): boolean {
  const lowered = modelId.toLowerCase()
  return (
    lowered.includes('gpt-5') ||
    lowered.includes('o1') ||
    lowered.includes('o3') ||
    lowered.includes('o4')
  )
}

export function resolvePiModelMetadata(
  channel: PiQueryChannel,
  modelId: string,
  metadataOverride?: ModelMetadataOverride,
  capabilitiesOverride?: ModelCapabilitiesOverride,
  providerDbEntry?: ProviderDbModel,
) {
  return resolveModelMetadata({
    channelProvider: channel.provider,
    channelBaseUrl: channel.baseUrl,
    modelId,
    modelName: modelId,
    metadataOverride,
    capabilitiesOverride,
    providerDbEntry,
  })
}

export async function buildPiModel(
  channel: PiQueryChannel,
  modelId: string,
  metadataOverride?: ModelMetadataOverride,
  capabilitiesOverride?: ModelCapabilitiesOverride,
  hasImages?: boolean,
  providerDbEntry?: ProviderDbModel,
): Promise<PiModel> {
  const provider = getPiProviderId(channel, modelId)
  const metadata = resolvePiModelMetadata(
    channel,
    modelId,
    metadataOverride,
    capabilitiesOverride,
    providerDbEntry,
  )
  const cost = await resolveModelCost(channel, modelId)

  // 当有图片附件时，强制包含 'image' 以绕过 Pi SDK 对 model.input 的静默过滤。
  // 如果 API 真不支持图片，会在 adapter 层捕获错误并给出清晰提示。
  const includeImage = metadata.abilities.vision === 'supported' || (hasImages ?? false)

  return {
    id: modelId,
    name: modelId,
    api: resolvePiApiType(channel, modelId),
    provider,
    baseUrl: channel.baseUrl,
    reasoning: metadata.abilities.reasoning === 'supported',
    input: includeImage ? ['text', 'image'] : ['text'],
    cost,
    contextWindow: metadata.contextWindowTokens ?? 200000,
    maxTokens: metadata.maxOutputTokens ?? 32768,
  }
}

export function resolvePiThinkingLevel(
  thinkingLevel?: ThinkingLevel,
  thinking?: ThinkingConfig,
  effort?: AgentEffort,
): PiThinkingLevel {
  const resolvedLevel = resolveThinkingLevel({
    thinkingLevel,
    thinking,
    effort,
  })

  if (resolvedLevel === 'none') return 'off'
  if (resolvedLevel === 'xhigh') return 'xhigh'
  return resolvedLevel
}

function createAssistantMessage(message: AgentMessage, model: PiModel): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: message.content }],
    api: model.api,
    provider: model.provider,
    model: message.model ?? model.id,
    usage: { ...ZERO_USAGE, cost: { ...ZERO_USAGE.cost } },
    stopReason: 'stop',
    timestamp: message.createdAt,
  }
}

function extractTextParts(content: ReadonlyArray<{ type: string; text?: string }>): string {
  return content
    .filter((part): part is TextContent => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
}

function toolResultToString(result: {
  content?: ReadonlyArray<{ type: string; text?: string }>
}): string {
  const text = extractTextParts(result.content ?? [])
  return text || ''
}

function partialToolResultToString(result: unknown): string {
  if (typeof result === 'string') return result
  if (result && typeof result === 'object' && 'content' in result) {
    return toolResultToString(result as { content?: ReadonlyArray<{ type: string; text?: string }> })
  }

  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}

export function friendlyErrorMessage(raw: string): string {
  for (const { pattern, message } of FRIENDLY_ERROR_MESSAGES) {
    if (pattern.test(raw)) return message
  }
  return raw
}

export function isPromptTooLongError(...messages: string[]): boolean {
  const combined = messages.join(' ').toLowerCase()
  return PROMPT_TOO_LONG_PATTERNS.some((pattern) => combined.includes(pattern))
}

function createTypedError(
  code: ErrorCode,
  title: string,
  message: string,
  canRetry: boolean,
): TypedError {
  return {
    code,
    title,
    message,
    actions: [
      { key: 's', label: '设置', action: 'settings' },
      ...(canRetry ? [{ key: 'r', label: '重试', action: 'retry' as const }] : []),
      ...(code === 'prompt_too_long' ? [{ key: 'c', label: '压缩上下文', action: 'compact' as const }] : []),
    ],
    canRetry,
    retryDelayMs: canRetry ? 1000 : undefined,
    originalError: message,
  }
}

function mapPiErrorMessageToKilaEvent(message: string): AgentEvent {
  const friendly = friendlyErrorMessage(message)
  const lowered = friendly.toLowerCase()

  if (isPromptTooLongError(friendly)) {
    return {
      type: 'typed_error',
      error: createTypedError('prompt_too_long', '上下文过长', '当前对话的上下文已超出模型限制，请压缩上下文或开启新会话', false),
    }
  }

  if (/401|403|unauthorized|authentication|invalid api key|api key/i.test(lowered)) {
    return {
      type: 'typed_error',
      error: createTypedError('invalid_api_key', '认证失败', '无法通过 API 认证，请检查当前渠道的 API Key 或 Base URL', true),
    }
  }

  if (/429|rate limit|too many requests/i.test(lowered)) {
    return {
      type: 'typed_error',
      error: createTypedError('rate_limited', '请求频率限制', '请求过于频繁，请稍后再试', true),
    }
  }

  if (/timeout|network|socket|fetch failed|econnreset|enotfound/i.test(lowered)) {
    return {
      type: 'typed_error',
      error: createTypedError('network_error', '网络错误', friendly, true),
    }
  }

  if (/overloaded|service unavailable|server error|internal error|bad gateway|temporarily unavailable|502|503|504/i.test(lowered)) {
    return {
      type: 'typed_error',
      error: createTypedError('provider_error', '服务繁忙', friendly, true),
    }
  }

  if (/does not support image|unsupported.*image|invalid.*content.*image|image.*not.support|image.*unsupported/i.test(lowered)) {
    return {
      type: 'typed_error',
      error: createTypedError('image_not_supported', '模型不支持图片', '当前模型不支持图片输入，无法识别图片内容。请切换到支持视觉的模型（如 Claude、GPT-4o、Gemini）。', false),
    }
  }

  return { type: 'error', message: friendly }
}

function mapUsage(message: AssistantMessage, contextWindow?: number): AgentEvent[] {
  const usageEvents: AgentEvent[] = []

  usageEvents.push({
    type: 'usage_update',
    usage: {
      // Anthropic 系 usage.input 不含 cache；OpenAI 系 input 已含 cached 但 cacheRead 为 0。
      // 统一 input + cacheRead + cacheWrite 反映真实上下文占用。
      inputTokens: message.usage.input + message.usage.cacheRead + message.usage.cacheWrite,
      contextWindow,
    },
  })

  return usageEvents
}

export function mapPiEventToKilaEvents(
  event: PiRuntimeEvent,
  options?: { contextWindow?: number },
): AgentEvent[] {
  switch (event.type) {
    case 'compaction_start':
      return [{ type: 'compacting' }]

    case 'compaction_end': {
      // Pi 在会话过小或已处于压缩边界时，会发送 compaction_end 后 reject compact()。
      // 这不是压缩成功，不能落 compact_complete，否则 Kila 会把它误记为上下文边界。
      const noopMessage = getCompactionNoopMessage(event.errorMessage)
      if (noopMessage) return [{ type: 'compact_noop', message: noopMessage }]
      if (event.errorMessage) {
        return [{ type: 'error', message: friendlyErrorMessage(event.errorMessage) }]
      }
      if (event.aborted || !event.result) return []
      return [{
        type: 'compact_complete',
        reason: event.reason,
        summaryText: event.result.summary,
        firstKeptEntryId: event.result.firstKeptEntryId,
        tokensBefore: event.result.tokensBefore,
        details: event.result.details,
        willRetry: event.willRetry,
      }]
    }

    case 'auto_retry_start': {
      const attemptData = {
        attempt: event.attempt,
        timestamp: Date.now(),
        reason: event.errorMessage,
        errorMessage: event.errorMessage,
        delaySeconds: event.delayMs / 1000,
      }
      return [
        {
          type: 'retrying',
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delaySeconds: event.delayMs / 1000,
          reason: event.errorMessage,
        },
        { type: 'retry_attempt', attemptData },
      ]
    }

    case 'auto_retry_end':
      if (event.success) return [{ type: 'retry_cleared' }]
      return [{
        type: 'retry_failed',
        finalAttempt: {
          attempt: event.attempt,
          timestamp: Date.now(),
          reason: event.finalError ?? 'Pi 自动重试失败',
          errorMessage: event.finalError ?? 'Pi 自动重试失败',
          delaySeconds: 0,
        },
      }]

    case 'queue_update':
      return []

    // 这些是 Pi runtime 的内部生命周期或 sidecar 持久化边界；Kila 已以
    // turn_start / turn_end / complete 驱动 UI，并由 session-manager 管理业务持久化。
    // 显式识别它们，避免 Pi 新增已知生命周期事件时产生误导性 warning。
    case 'agent_start':
    case 'agent_settled':
    case 'message_start':
    case 'entry_appended':
    case 'session_info_changed':
    case 'thinking_level_changed':
      return []

    case 'message_update':
      switch (event.assistantMessageEvent.type) {
        case 'text_delta':
          return [{ type: 'text_delta', text: event.assistantMessageEvent.delta }]
        case 'thinking_start':
          return [{ type: 'thinking_start', contentIndex: event.assistantMessageEvent.contentIndex }]
        case 'thinking_delta':
          return [{
            type: 'thinking_delta',
            contentIndex: event.assistantMessageEvent.contentIndex,
            text: event.assistantMessageEvent.delta,
          }]
        case 'thinking_end':
          return [{
            type: 'thinking_end',
            contentIndex: event.assistantMessageEvent.contentIndex,
            text: event.assistantMessageEvent.content,
          }]

        // text_* 边界由 Kila 的 text_delta / message_end 表示；toolcall_* 由
        // tool_execution_* 承担。start/done/error 也会由外层 message/agent 事件收敛。
        case 'start':
        case 'text_start':
        case 'text_end':
        case 'toolcall_start':
        case 'toolcall_delta':
        case 'toolcall_end':
        case 'done':
        case 'error':
          return []
      }

    case 'message_end':
      if (event.message.role !== 'assistant') return []
      return [
        ...mapUsage(event.message, options?.contextWindow),
        {
          type: 'text_complete',
          text: extractTextParts(event.message.content),
          isIntermediate: event.message.stopReason === 'toolUse',
        },
      ]

    case 'tool_execution_start':
      return [{
        type: 'tool_start',
        toolUseId: event.toolCallId,
        toolName: event.toolName,
        input: (event.args ?? {}) as Record<string, unknown>,
      }]

    case 'tool_execution_update':
      return [{
        type: 'tool_update',
        toolUseId: event.toolCallId,
        toolName: event.toolName,
        partialText: partialToolResultToString(event.partialResult),
      }]

    case 'tool_execution_end': {
      const parsedResult = extractKilaImageAttachments(
        toolResultToString(event.result as ToolResultMessage['details'] & { content?: Array<{ type: string; text?: string }> }),
      )
      return [{
        type: 'tool_result',
        toolUseId: event.toolCallId,
        toolName: event.toolName,
        result: parsedResult.cleanedText,
        isError: event.isError,
        imageAttachments: parsedResult.images.length > 0 ? parsedResult.images : undefined,
      }]
    }

    case 'turn_start':
      return [{ type: 'turn_start' }]

    case 'turn_end':
      return [{
        type: 'turn_end',
        toolResultCount: event.toolResults.length,
      }]

    case 'agent_end': {
      const assistantMessages = event.messages.filter(
        (message): message is AssistantMessage => message.role === 'assistant',
      )
      const lastAssistant = assistantMessages.at(-1)
      const messagesWithUsage = assistantMessages.filter((message) => Boolean(message.usage))
      const usage = messagesWithUsage.reduce((total, message) => ({
        inputTokens: total.inputTokens + message.usage.input,
        outputTokens: total.outputTokens + message.usage.output,
        cacheReadTokens: total.cacheReadTokens + message.usage.cacheRead,
        cacheCreationTokens: total.cacheCreationTokens + message.usage.cacheWrite,
        costUsd: total.costUsd + message.usage.cost.total,
      }), {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: 0,
      })
      const lastUsage = lastAssistant?.usage
      const completeEvent: AgentEvent = {
        type: 'complete',
        stopReason: lastAssistant?.stopReason,
        ...(messagesWithUsage.length > 0 && {
          usage: {
            ...usage,
            // Pi/Anthropic 的 input 不包含 cache token。上下文占用必须包含读写缓存，
            // 否则 Context 指示器和估算校准会在缓存命中时严重偏低。
            contextInputTokens: lastUsage
              ? lastUsage.input + lastUsage.cacheRead + lastUsage.cacheWrite
              : undefined,
            contextWindow: options?.contextWindow,
          },
        }),
      }

      // Provider 即使返回错误，也可能已经产生可计费 usage。先提交 complete usage，
      // 再提交错误终态，避免失败请求从 Token/成本统计中消失。
      if (lastAssistant?.errorMessage) {
        return [completeEvent, mapPiErrorMessageToKilaEvent(lastAssistant.errorMessage)]
      }

      return [completeEvent]
    }

    default:
      if (process.env.NODE_ENV !== 'production') {
        log.warn('[Pi Agent] Unmapped event type:', (event as { type?: string }).type)
      }
      return []
  }
}

/**
 * Pi 的 partialResult 是截至当前的完整快照，而 Kila 内部按增量事件消费。
 * 每次 query 使用独立 mapper，避免把累计快照反复追加到 UI 和持久化历史。
 */
export function createPiEventMapper(
  options?: { contextWindow?: number },
): ((event: PiRuntimeEvent) => AgentEvent[]) & { flush: () => AgentEvent[] } {
  const accumulatedToolResults = new Map<string, string>()
  let turnSequence = 0
  let activeTurnId: string | undefined
  const pendingAgentEnds: Array<Extract<PiRuntimeEvent, { type: 'agent_end' }>> = []

  const mapEvent = (event: PiRuntimeEvent): AgentEvent[] => {
    // Pi 的 agent_end 只是一次 agent-core run 的边界。自动重试与 overflow
    // compact/continue 都可能在它之后继续；只有 agent_settled 才是真正终态。
    // 必须保留 settled 前的全部 run，最终 usage 才会包含失败重试与 compact 续跑成本。
    if (event.type === 'agent_end') {
      pendingAgentEnds.push(event)
      return []
    }

    if (event.type === 'turn_start') {
      activeTurnId = `pi-turn-${++turnSequence}`
    }

    const mapped = event.type === 'agent_settled' && pendingAgentEnds.length > 0
      ? mapPiEventToKilaEvents({
          ...pendingAgentEnds[pendingAgentEnds.length - 1]!,
          messages: pendingAgentEnds.flatMap((agentEnd) => agentEnd.messages),
        }, options)
      : mapPiEventToKilaEvents(event, options)

    if (event.type === 'agent_settled') {
      pendingAgentEnds.length = 0
    }

    const normalized: AgentEvent[] = []
    for (const kilaEvent of mapped) {
      const eventWithTurn = activeTurnId && (
        kilaEvent.type === 'turn_start' ||
        kilaEvent.type === 'turn_end' ||
        kilaEvent.type === 'text_delta' ||
        kilaEvent.type === 'text_complete' ||
        kilaEvent.type === 'thinking_start' ||
        kilaEvent.type === 'thinking_delta' ||
        kilaEvent.type === 'thinking_end' ||
        kilaEvent.type === 'tool_start' ||
        kilaEvent.type === 'tool_update' ||
        kilaEvent.type === 'tool_result'
      )
        ? { ...kilaEvent, turnId: activeTurnId }
        : kilaEvent

      if (eventWithTurn.type === 'tool_start') {
        accumulatedToolResults.delete(eventWithTurn.toolUseId)
        normalized.push(eventWithTurn)
        continue
      }

      if (eventWithTurn.type === 'tool_update') {
        const previous = accumulatedToolResults.get(eventWithTurn.toolUseId) ?? ''
        const current = eventWithTurn.partialText
        const delta = current.startsWith(previous)
          ? current.slice(previous.length)
          : current
        accumulatedToolResults.set(eventWithTurn.toolUseId, current)
        if (delta) normalized.push({ ...eventWithTurn, partialText: delta })
        continue
      }

      if (eventWithTurn.type === 'tool_result') {
        accumulatedToolResults.delete(eventWithTurn.toolUseId)
      }
      normalized.push(eventWithTurn)
    }

    if (event.type === 'turn_end') {
      activeTurnId = undefined
    }

    return normalized
  }

  // abort/异常时 Pi 可能只发出 agent_end，来不及发 agent_settled。
  // 不能因为缺少最后一个生命周期事件就丢掉已产生的 usage 和错误。
  mapEvent.flush = (): AgentEvent[] => {
    if (pendingAgentEnds.length === 0) return []
    const lastAgentEnd = pendingAgentEnds[pendingAgentEnds.length - 1]!
    const messages = pendingAgentEnds.flatMap((agentEnd) => agentEnd.messages)
    pendingAgentEnds.length = 0
    return mapPiEventToKilaEvents({
      ...lastAgentEnd,
      messages,
    }, options)
  }

  return mapEvent
}

interface MutableRef<T> {
  current: T
}

interface PiRuntime {
  session: AgentSession
  signature: string
  modelRuntime: KilaModelRuntime
  beforeToolCallRef: MutableRef<PiAgentQueryOptions['beforeToolCall'] | undefined>
  getAgentStateRef: MutableRef<(() => PiAgentState) | undefined>
}

function safeStableStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return '[unserializable]'
  }
}

function createRuntimeSignature(options: PiAgentQueryOptions, model: PiModel): string {
  const toolSignature = options.tools
    .map((tool) => [
      tool.name,
      tool.description,
      safeStableStringify(tool.parameters),
    ].join(':'))
    .sort()
    .join('|')

  return JSON.stringify({
    cwd: options.cwd ?? '',
    // model.provider 可能经过 Pi/兼容层归一化；渠道类型仍需参与 runtime 身份，
    // 避免 custom/openai 在相同 Base URL 与模型 ID 下错误复用认证 Provider。
    channelProvider: options.channel.provider,
    channelApiType: options.channel.apiType ?? inferApiTypeFromProvider(options.channel.provider),
    capabilityProviderId: options.channel.capabilityProviderId ?? '',
    provider: model.provider,
    api: model.api,
    baseUrl: model.baseUrl ?? '',
    model: model.id,
    input: model.input,
    reasoning: model.reasoning,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    cost: model.cost,
    thinkingLevel: resolvePiThinkingLevel(options.thinkingLevel, options.thinking, options.effort),
    systemPrompt: options.systemPrompt,
    tools: toolSignature,
  })
}

function wrapToolsWithKilaPermission(
  tools: AgentTool[],
  beforeToolCallRef: MutableRef<PiAgentQueryOptions['beforeToolCall'] | undefined>,
  getAgentStateRef: MutableRef<(() => PiAgentState) | undefined>,
): AgentTool[] {
  return tools.map((tool) => ({
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const beforeToolCall = beforeToolCallRef.current
      if (beforeToolCall) {
        const state = getAgentStateRef.current?.()
        const permission = await beforeToolCall({
          assistantMessage: {} as AssistantMessage,
          toolCall: {
            type: 'toolCall',
            id: toolCallId,
            name: tool.name,
            arguments: params,
          } as BeforeToolCallContext['toolCall'],
          args: params,
          context: {
            systemPrompt: state?.systemPrompt ?? '',
            messages: state?.messages ?? [],
            tools: state?.tools ?? tools,
          },
        }, signal)

        if (permission?.block) {
          throw new Error(permission.reason || '工具调用已被权限策略阻止')
        }
      }

      return tool.execute(toolCallId, params, signal, onUpdate)
    },
  }))
}

function hasPiSessionMessages(sessionManager: SessionManager): boolean {
  return sessionManager.getEntries().some((entry) => (
    entry.type === 'message' ||
    entry.type === 'compaction' ||
    entry.type === 'branch_summary' ||
    entry.type === 'custom_message'
  ))
}

function parseManualCompactCommand(rawPrompt: string | undefined): string | null {
  const trimmed = rawPrompt?.trim() ?? ''
  const match = trimmed.match(/^\/compact(?:\s+([\s\S]+))?$/i)
  if (!match) return null
  return match[1]?.trim() ?? ''
}

/**
 * Pi 把「无需压缩」作为 reject，而非单独结果类型。
 * Kila 将其建模为良性空操作，确保流正常结束且不会伪造 compact_complete。
 */
function getCompactionNoopMessage(error: unknown): string | null {
  const raw = typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : ''
  if (/nothing to compact/i.test(raw)) return '当前上下文较小，暂时无需压缩。'
  if (/already compacted/i.test(raw)) return '当前上下文已经压缩过，无需重复压缩。'
  return null
}

async function waitForCompactionToSettle(
  session: AgentSession,
  timeoutMs = 120_000,
  abortSignal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  await new Promise((resolve) => setTimeout(resolve, 25))
  while (session.isCompacting) {
    if (abortSignal?.aborted) {
      session.abortCompaction()
      return
    }
    if (Date.now() >= deadline) {
      session.abortCompaction()
      throw new Error(`Pi 上下文压缩在 ${timeoutMs}ms 内未完成，已中止以避免会话永久卡住`)
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

export class PiAgentAdapter implements AgentProviderAdapter {
  readonly ownsRetry = true
  private runtimes = new Map<string, PiRuntime>()

  private async disposeRuntime(sessionId: string, runtime: PiRuntime): Promise<void> {
    this.runtimes.delete(sessionId)
    try {
      await runtime.session.abort()
    } finally {
      runtime.session.abortCompaction()
      runtime.session.dispose()
    }
  }

  private async createRuntime(options: PiAgentQueryOptions, model: PiModel, signature: string): Promise<PiRuntime> {
    const [piAi, sdk] = await Promise.all([
      loadPiAi(),
      loadPiCodingAgent(),
    ])

    const cwd = options.cwd ?? process.cwd()
    const agentDir = getPiAgentDir()
    const sessionManager = sdk.SessionManager.continueRecent(cwd, getPiSessionDir(options.sessionId))
    const isNewPiSession = !hasPiSessionMessages(sessionManager)
    if (isNewPiSession) {
      sessionManager.newSession({ id: options.sessionId })
    }

    const thinkingLevel = resolvePiThinkingLevel(options.thinkingLevel, options.thinking, options.effort)
    const settingsManager = sdk.SettingsManager.inMemory({
      compaction: {
        enabled: true,
        reserveTokens: 16384,
        keepRecentTokens: 20000,
      },
      retry: {
        enabled: true,
        maxRetries: 3,
        baseDelayMs: 1000,
        provider: {
          // retry 由 AgentSession 统一拥有，禁止 provider 内部再嵌套重试。
          maxRetries: 0,
          maxRetryDelayMs: options.maxRetryDelayMs,
        },
      },
    })
    const resourceLoader = new sdk.DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      agentsFilesOverride: () => ({ agentsFiles: [] }),
      systemPromptOverride: () => options.systemPrompt,
    })
    await resourceLoader.reload()

    const modelRuntime = await createKilaModelRuntime({
      piAi,
      sdk,
      channel: options.channel,
      model,
      apiKey: options.apiKey,
    })
    const runtimeModel = modelRuntime.model

    const beforeToolCallRef: MutableRef<PiAgentQueryOptions['beforeToolCall'] | undefined> = {
      current: options.beforeToolCall,
    }
    const getAgentStateRef: MutableRef<(() => PiAgentState) | undefined> = {
      current: undefined,
    }
    const wrappedTools = wrapToolsWithKilaPermission(options.tools, beforeToolCallRef, getAgentStateRef)

    if (isNewPiSession) {
      const historyMessages = await convertHistoryToPiMessages(options.historyMessages ?? [], runtimeModel)
      if (historyMessages.length > 0) {
        sessionManager.appendModelChange(runtimeModel.provider, runtimeModel.id)
        sessionManager.appendThinkingLevelChange(thinkingLevel)
        for (const message of historyMessages) {
          sessionManager.appendMessage(message)
        }
      }
    } else {
      const sessionContext = sessionManager.buildSessionContext()
      if (
        !sessionContext.model ||
        sessionContext.model.provider !== runtimeModel.provider ||
        sessionContext.model.modelId !== runtimeModel.id
      ) {
        sessionManager.appendModelChange(runtimeModel.provider, runtimeModel.id)
      }
      if (sessionContext.thinkingLevel !== thinkingLevel) {
        sessionManager.appendThinkingLevelChange(thinkingLevel)
      }
    }

    const { session } = await sdk.createAgentSession({
      cwd,
      agentDir,
      modelRuntime: modelRuntime.modelRuntime,
      model: runtimeModel,
      thinkingLevel,
      settingsManager,
      resourceLoader,
      sessionManager,
      noTools: 'builtin',
      customTools: wrappedTools,
    })
    session.agent.toolExecution = 'sequential'
    getAgentStateRef.current = () => session.agent.state
    session.setAutoCompactionEnabled(true)

    return {
      session,
      signature,
      modelRuntime,
      beforeToolCallRef,
      getAgentStateRef,
    }
  }

  private async getRuntime(options: PiAgentQueryOptions, model: PiModel): Promise<PiRuntime> {
    const signature = createRuntimeSignature(options, model)
    const existing = this.runtimes.get(options.sessionId)
    if (existing?.signature === signature) {
      await updateKilaModelRuntimeApiKey(existing.modelRuntime, options.apiKey)
      existing.beforeToolCallRef.current = options.beforeToolCall
      return existing
    }

    if (existing) {
      await this.disposeRuntime(options.sessionId, existing)
    }

    const runtime = await this.createRuntime(options, model, signature)
    this.runtimes.set(options.sessionId, runtime)
    return runtime
  }

  async *query(input: AgentQueryInput): AsyncIterable<AgentEvent> {
    const options = input as PiAgentQueryOptions
    const modelId = options.model

    // AbortSignal 可能在 runtime/model 初始化前就已中止。addEventListener 不会补发历史 abort，
    // 因此必须在任何 Pi 资源创建和 prompt 提交前主动检查，避免“已停止”仍发模型请求或执行工具。
    if (options.abortSignal?.aborted) return

    if (!modelId) {
      yield {
        type: 'error',
        message: '缺少模型 ID，无法启动 Pi Agent',
      }
      return
    }

    const hasImages = (options.promptImages?.length ?? 0) > 0
    // hasImages 为 true 时 buildPiModel 会强行 include image input，
    // 但 promptImages 为空（orchestrator 已拦截）时不应该强行开启
    const model = await buildPiModel(
      options.channel,
      modelId,
      options.modelMetadata,
      options.modelCapabilities,
      hasImages,
      options.modelProviderDbEntry,
    )
    const queue: AgentEvent[] = []
    let done = false
    let notify: (() => void) | null = null
    const runtime = await this.getRuntime(options, model)
    if (options.abortSignal?.aborted) {
      await runtime.session.abort()
      runtime.session.abortCompaction()
      return
    }
    const mapRuntimeEvent = createPiEventMapper({ contextWindow: model.contextWindow })

    const wake = (): void => {
      notify?.()
      notify = null
    }

    const unsubscribe = runtime.session.subscribe((event) => {
      queue.push(...mapRuntimeEvent(event))
      wake()
    })

    const abortListener = (): void => {
      void runtime.session.abort().catch((error) => {
        log.warn('[Pi Agent] 中止 runtime 失败:', error)
      })
      runtime.session.abortCompaction()
    }
    options.abortSignal?.addEventListener('abort', abortListener, { once: true })
    // 防止 abort 恰好发生在上一次检查与 listener 注册之间。
    if (options.abortSignal?.aborted) abortListener()

    const manualCompactInstructions = parseManualCompactCommand(options.rawPrompt)
    const runPromise = (async () => {
      if (options.abortSignal?.aborted) return
      if (runtime.session.isCompacting) {
        await waitForCompactionToSettle(runtime.session, 120_000, options.abortSignal)
      }
      if (options.abortSignal?.aborted) return

      if (manualCompactInstructions !== null) {
        try {
          await runtime.session.compact(manualCompactInstructions || undefined)
          queue.push({ type: 'complete', stopReason: 'compact' })
        } catch (error) {
          // Pi 0.80.10 的 compact() 会先同步发送 compaction_end，再 reject Promise。
          // 错误/取消已经由 subscription 映射；这里再次 throw 会让外层 catch 重复发送错误。
          // `Nothing to compact` / `Already compacted` 只额外补产品终态，避免流式状态悬挂。
          if (getCompactionNoopMessage(error)) {
            queue.push({ type: 'complete', stopReason: 'compact_noop' })
          }
        }
        wake()
        return
      }

      // Pi 0.80.x 会在 AgentSession 内处理 provider retry 与 context overflow：
      // agent_end → retry/compact → continue → agent_settled。这里绝不能重复提交 prompt。
      if (options.abortSignal?.aborted) return
      await runtime.session.prompt(options.prompt, {
        images: options.promptImages,
        expandPromptTemplates: false,
      })
      await waitForCompactionToSettle(runtime.session, 120_000, options.abortSignal)
    })()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        queue.push(mapPiErrorMessageToKilaEvent(message))
      })
      .finally(() => {
        // abort/异常路径不一定会收到 agent_settled；在标记 done 前补刷，
        // 这样消费循环仍能把最后的 usage/错误事件交给上层。
        queue.push(...mapRuntimeEvent.flush())
        done = true
        wake()
      })

    try {
      while (!done || queue.length > 0) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            notify = resolve
          })
          continue
        }

        const next = queue.shift()
        if (next) yield next
      }

      await runPromise
    } finally {
      unsubscribe()
      options.abortSignal?.removeEventListener('abort', abortListener)
    }
  }

  abort(sessionId: string): void {
    const runtime = this.runtimes.get(sessionId)
    if (!runtime) return
    void runtime.session.abort()
    runtime.session.abortCompaction()
  }

  async steer(sessionId: string, message: AgentControlMessage): Promise<void> {
    const runtime = this.runtimes.get(sessionId)
    if (!runtime) {
      throw new Error('当前会话没有可干预的 Pi runtime')
    }

    await runtime.session.steer(message.content)
  }

  async followUp(sessionId: string, message: AgentControlMessage): Promise<void> {
    const runtime = this.runtimes.get(sessionId)
    if (!runtime) {
      throw new Error('当前会话没有可 follow-up 的 Pi runtime')
    }

    await runtime.session.followUp(message.content)
  }

  async waitForIdle(sessionId: string): Promise<void> {
    const runtime = this.runtimes.get(sessionId)
    if (!runtime) return
    await runtime.session.agent.waitForIdle()
    await waitForCompactionToSettle(runtime.session)
  }

  async resetSession(sessionId: string): Promise<void> {
    const runtime = this.runtimes.get(sessionId)
    if (!runtime) return
    await this.disposeRuntime(sessionId, runtime)
  }

  dispose(): void {
    const runtimes = [...this.runtimes.entries()]
    this.runtimes.clear()
    for (const [, runtime] of runtimes) {
      void runtime.session.abort().finally(() => {
        runtime.session.abortCompaction()
        runtime.session.dispose()
      })
    }
  }
}
