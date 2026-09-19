/**
 * Pi Runtime 事件映射。
 *
 * 只在 Utility Process bundle 中使用；主进程消费的是已转换的 AgentEvent。
 */
import type { AgentEvent as PiAgentEvent } from '@earendil-works/pi-agent-core'
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Model,
  TextContent,
  ToolResultMessage,
} from '@earendil-works/pi-ai'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import type { AgentEvent, ErrorCode, TypedError } from '@kila/shared'
import { detectBackgroundEvents, extractKilaImageAttachments } from '@kila/shared'
import {
  getCompactionNoopMessage,
  mapPiUsageToAgentEventUsage,
} from '../main/lib/compaction-settings'
import { friendlyErrorMessage, isPromptTooLongError } from '../main/lib/agent-error-utils'
import { classifyProviderError } from '../main/lib/provider-error-classifier'
import { createLogger } from '../main/lib/logger'

type PiModel = Model<Api>
type PiRuntimeEvent = PiAgentEvent | AgentSessionEvent
const log = createLogger('Pi Agent')

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
  summarization_retry_scheduled: true,
  summarization_retry_attempt_start: true,
  summarization_retry_finished: true,
  bash_execution_update: true,
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

void PI_SESSION_EVENT_TYPES_ACCOUNTED_FOR
void PI_ASSISTANT_MESSAGE_EVENT_TYPES_ACCOUNTED_FOR

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

export function mapPiErrorMessageToKilaEvent(message: string): AgentEvent {
  const friendly = friendlyErrorMessage(message)
  const lowered = friendly.toLowerCase()

  if (isPromptTooLongError(friendly)) {
    return {
      type: 'typed_error',
      error: createTypedError('prompt_too_long', '上下文过长', '当前对话的上下文已超出模型限制，请压缩上下文或开启新会话', false),
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

  const classification = classifyProviderError(friendly)
  if (classification.failureKind !== 'provider_error') {
    return {
      type: 'typed_error',
      error: createTypedError(
        classification.errorCode,
        classification.title,
        classification.message,
        classification.canRetry,
      ),
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

export interface PiEventMapOptions {
  contextWindow?: number
  /** summarization 重试事件只有 scheduled 带 attempt；用可变游标给空载荷的 start/finished 补序号。 */
  summarizationRetryCursor?: { attempt: number }
}

export function mapPiEventToKilaEvents(
  event: PiRuntimeEvent,
  options?: PiEventMapOptions,
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
        // 压缩失败是瞬时/可重试错误，不是会话终态。Pi 0.82 的 willRetry 为真时会自动重试摘要
        // 或继续 agent 主循环；映射成裸 error 会让渲染层把会话打成 stopped（「压缩中断会话」）。
        return [{
          type: 'compact_failed',
          message: friendlyErrorMessage(event.errorMessage),
          willRetry: event.willRetry,
          reason: event.reason,
        }]
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
        // 摘要那次 LLM 调用的真实用量；不计入会让「压缩越频繁、月度用量偏差越大」。
        usage: mapPiUsageToAgentEventUsage(event.result.usage, options?.contextWindow),
        estimatedTokensAfter: event.result.estimatedTokensAfter,
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
    // Pi 0.82 新增：bash 流式输出增量。工具输出已由 tool_execution_* 收敛，显式忽略。
    case 'bash_execution_update':
      return []

    // Pi 0.82 新增：摘要（压缩 / 分支摘要）调用的重试生命周期。
    // 压缩期间界面若不给反馈，用户会面对十几秒的静默，所以必须映射出来。
    case 'summarization_retry_scheduled': {
      if (options?.summarizationRetryCursor) options.summarizationRetryCursor.attempt = event.attempt
      return [{
        type: 'summarization_retry',
        attempt: event.attempt,
        delaySeconds: event.delayMs / 1000,
        phase: 'scheduled',
      }]
    }

    case 'summarization_retry_attempt_start':
      return [{
        type: 'summarization_retry',
        attempt: options?.summarizationRetryCursor?.attempt ?? 1,
        phase: 'start',
      }]

    case 'summarization_retry_finished': {
      const attempt = options?.summarizationRetryCursor?.attempt ?? 1
      if (options?.summarizationRetryCursor) options.summarizationRetryCursor.attempt = 0
      return [{ type: 'summarization_retry', attempt, phase: 'finished' }]
    }

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
        input: extractApprovedToolInput(event.result),
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
  // 记录每个工具调用的入参（来自 tool_execution_start），tool_execution_end 时用于后台任务检测。
  const toolInputsById = new Map<string, Record<string, unknown>>()
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

    // 记录工具入参，供 tool_execution_end 的后台任务检测使用（Pi 的 end 事件不含入参）。
    if (event.type === 'tool_execution_start') {
      toolInputsById.set(event.toolCallId, (event.args ?? {}) as Record<string, unknown>)
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
        const originalToolInput = toolInputsById.get(eventWithTurn.toolUseId)
        if (!eventWithTurn.input && originalToolInput) {
          normalized.push({ ...eventWithTurn, input: originalToolInput })
        } else {
          normalized.push(eventWithTurn)
        }

        // 后台任务/Shell 检测：Pi 路径的唯一接入点。
        // 用 tool_execution_start 记录的入参 + 本次结果，产出 task_backgrounded /
        // shell_backgrounded / shell_killed，驱动渲染端后台任务面板。
        const toolInput = originalToolInput ?? {}
        toolInputsById.delete(eventWithTurn.toolUseId)
        const backgroundEvents = detectBackgroundEvents(
          eventWithTurn.toolUseId,
          { name: eventWithTurn.toolName ?? '', input: toolInput },
          eventWithTurn.result,
          eventWithTurn.isError,
          activeTurnId,
        )
        normalized.push(...backgroundEvents)
        continue
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

function extractApprovedToolInput(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const details = (value as { details?: unknown }).details
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined
  const input = (details as { kilaApprovedArgs?: unknown }).kilaApprovedArgs
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : undefined
}
