/**
 * Pi Model 装配：渠道/模型 → Pi Model + provider compat 推断。
 *
 * 从 pi-agent-adapter 拆出。包含三块职责：
 * 1. 协议映射：Kila Channel 的显式 apiType → Pi Api（协议真相源优先于模型名猜测）
 * 2. compat 推断：Kila 会把模型注册到自己的 providerId，导致 Pi 仅凭 provider 名称
 *    无法再命中部分 provider 规则。这里补齐已知网关的缓存相关 compat，并允许渠道按
 *    模型显式覆盖；未知 provider 继续交给 Pi 的 URL 自动探测，避免首个请求加载整个
 *    provider catalog。`PiModelCompat` 是按 API 判别的联合类型，推断必须按 api 分支
 *    显式构造，禁止收集到无类型 record 后裸 cast——那会让 responses API 悄悄带上
 *    它并不支持的 `sendSessionAffinityHeaders` 等字段。
 * 3. thinkingLevel 归一化。
 */

import type { ThinkingLevel as PiThinkingLevel } from '@earendil-works/pi-agent-core'
import type {
  Api,
  AnthropicMessagesCompat,
  Model,
  OpenAICompletionsCompat,
  OpenAIResponsesCompat,
} from '@earendil-works/pi-ai'
import type {
  AgentEffort,
  Channel,
  ModelCompatOverride,
  ModelMetadataOverride,
  ProviderDbModel,
  ThinkingConfig,
  ThinkingLevel,
} from '@kila/shared'
import { inferApiTypeFromProvider, resolveModelMetadata, resolveThinkingLevel, type ModelCapabilitiesOverride } from '@kila/shared'
import { resolveEffectiveContextWindow } from '../compaction-settings'
import { createLogger } from '../logger'
import { resolveModelCost } from '../model-pricing'

const log = createLogger('Pi Model')

/** adapter 查询层的渠道最小画像（来自 Channel 的稳定子集）。 */
export type PiQueryChannel = Pick<Channel, 'provider' | 'baseUrl' | 'apiType' | 'capabilityProviderId'>

type PiModel = Model<Api>

/** `Model<Api>['compat']` 对 Api 联合分布后的 compat 联合。 */
type PiModelCompat = PiModel['compat']

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

function prefersOpenAIResponses(modelId: string): boolean {
  const lowered = modelId.toLowerCase()
  return (
    lowered.includes('gpt-5') ||
    lowered.includes('o1') ||
    lowered.includes('o3') ||
    lowered.includes('o4')
  )
}

function getPiProviderId(channel: PiQueryChannel, modelId: string): string {
  const api = resolvePiApiType(channel, modelId)
  if (api === 'anthropic-messages') return 'anthropic'
  if (api === 'google-generative-ai') return 'google'
  if (OPENAI_COMPATIBLE_PROVIDERS.has(channel.provider)) return 'openai'
  return channel.provider
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
  compatOverride?: ModelCompatOverride,
): Promise<PiModel> {
  const provider = getPiProviderId(channel, modelId)
  const api = resolvePiApiType(channel, modelId)
  const compat = resolvePiModelCompat(channel, modelId, api, compatOverride)
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

  // 窗口解析单一数据源在 shared resolveModelMetadata（手动覆盖 > 模型名推断）；
  // 这里只做数值合法性守卫：非法（undefined/非正数）时按保守值兜底，避免预算计算出现负数。
  const contextWindow = resolveEffectiveContextWindow(metadata)
  if (contextWindow.source === 'fallback') {
    log.warn(`[Pi Model] 模型 ${modelId} 上下文窗口数值非法，按守卫默认 ${contextWindow.contextWindowTokens} token 处理`)
  }

  const maxTokens = metadata.maxOutputTokens ?? 32768

  return {
    id: modelId,
    name: modelId,
    api,
    provider,
    baseUrl: channel.baseUrl,
    reasoning: metadata.abilities.reasoning === 'supported',
    input: includeImage ? ['text', 'image'] : ['text'],
    cost,
    contextWindow: contextWindow.contextWindowTokens,
    maxTokens,
    ...(compat ? { compat } : {}),
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

// ============================================================================
// Provider compat 推断与合并
// ============================================================================

function describeProviderSurface(channel: PiQueryChannel): string {
  return `${channel.capabilityProviderId ?? ''} ${channel.provider} ${channel.baseUrl}`.toLowerCase()
}

interface GatewayHints {
  isOpenRouter: boolean
  isCloudflare: boolean
  isFireworks: boolean
  isDeepSeek: boolean
}

function detectGateways(channel: PiQueryChannel, api: Api): GatewayHints {
  const provider = describeProviderSurface(channel)
  const baseUrl = channel.baseUrl.toLowerCase()
  return {
    isOpenRouter: provider.includes('openrouter') || baseUrl.includes('openrouter.ai'),
    isCloudflare: provider.includes('cloudflare') || baseUrl.includes('gateway.ai.cloudflare.com'),
    isFireworks: provider.includes('fireworks') || baseUrl.includes('fireworks.ai'),
    // deepseek 的 thinkingFormat 仅对 chat completions 有意义
    isDeepSeek: api === 'openai-completions' && (provider.includes('deepseek') || baseUrl.includes('deepseek.com')),
  }
}

function inferOpenAICompletionsCompat(hints: GatewayHints, modelId: string): OpenAICompletionsCompat | undefined {
  const compat: OpenAICompletionsCompat = {}
  if (hints.isOpenRouter) {
    compat.thinkingFormat = 'openrouter'
    compat.supportsDeveloperRole = false
    compat.sessionAffinityFormat = 'openrouter'
    compat.sendSessionAffinityHeaders = true
    // OpenRouter 转发 anthropic/* 模型时使用 Anthropic 风格 cache_control 标记
    if (/^(~)?anthropic\//i.test(modelId)) compat.cacheControlFormat = 'anthropic'
  }
  if (hints.isCloudflare) {
    compat.sendSessionAffinityHeaders = true
    compat.supportsLongCacheRetention = false
  }
  if (hints.isFireworks) compat.sendSessionAffinityHeaders = true
  if (hints.isDeepSeek) {
    compat.thinkingFormat = 'deepseek'
    compat.requiresReasoningContentOnAssistantMessages = true
  }
  return Object.keys(compat).length > 0 ? compat : undefined
}

function inferOpenAIResponsesCompat(hints: GatewayHints): OpenAIResponsesCompat | undefined {
  const compat: OpenAIResponsesCompat = {}
  if (hints.isCloudflare) compat.supportsLongCacheRetention = false
  return Object.keys(compat).length > 0 ? compat : undefined
}

function inferAnthropicCompat(hints: GatewayHints): AnthropicMessagesCompat | undefined {
  const compat: AnthropicMessagesCompat = {}
  if (hints.isCloudflare) {
    compat.sendSessionAffinityHeaders = true
    compat.supportsLongCacheRetention = false
  }
  if (hints.isFireworks) compat.sendSessionAffinityHeaders = true
  return Object.keys(compat).length > 0 ? compat : undefined
}

/**
 * 按已知网关推断该 API 形态下的缓存相关 compat；未命中任何网关时返回
 * undefined，交给 Pi 的 URL 自动探测。
 */
export function inferPiModelCompat(
  channel: PiQueryChannel,
  modelId: string,
  api: Api,
): PiModelCompat | undefined {
  const hints = detectGateways(channel, api)
  if (api === 'openai-completions') return inferOpenAICompletionsCompat(hints, modelId)
  if (api === 'anthropic-messages') return inferAnthropicCompat(hints)
  if (api === 'openai-responses' || api === 'azure-openai-responses' || api === 'openai-codex-responses') {
    return inferOpenAIResponsesCompat(hints)
  }
  // bedrock / google 等其余 API 无网关 compat 需求
  return undefined
}

/**
 * 网关推断 + 渠道显式覆盖合并为最终 Pi compat。
 *
 * `promptCacheRetention` 是 Kila 侧的请求档位（由 compaction stream 消费），
 * 不属于 Pi compat 字段，必须在合并前剥离，避免混入发给 SDK 的模型定义。
 * 用户覆盖无法静态知道对应哪个 api 分支，合并处保留单一显式 cast。
 */
export function resolvePiModelCompat(
  channel: PiQueryChannel,
  modelId: string,
  api: Api,
  override?: ModelCompatOverride,
): PiModelCompat | undefined {
  const inferred = inferPiModelCompat(channel, modelId, api)
  const { promptCacheRetention: _kilaRetention, ...piRelevantOverride } = override ?? {}
  if (!inferred && Object.keys(piRelevantOverride).length === 0) return undefined
  return { ...inferred, ...piRelevantOverride } as PiModelCompat
}
