import type {
  AgentEffort,
  AgentMessage,
  AgentQueryInput,
  ModelCompatOverride,
  ModelCapabilitiesOverride,
  ModelMetadataOverride,
  ProviderDbModel,
  FileAttachment,
  ThinkingConfig,
  ThinkingLevel,
} from '@kila/shared'
import type {
  AgentTool,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from '@earendil-works/pi-agent-core'
import type { ImageContent, Model, Api } from '@earendil-works/pi-ai'
import type { PiQueryChannel } from './adapters/pi-model-builder'

/**
 * Utility Runtime 与主进程之间的查询数据合同。
 * 这里只保留类型，不创建或加载 Pi AgentSession。
 */
export interface PiAgentQueryOptions extends AgentQueryInput {
  runId?: string
  channel: PiQueryChannel
  apiKey: string
  systemPrompt: string
  tools: AgentTool[]
  historyMessages?: AgentMessage[]
  promptImages?: ImageContent[]
  /** 当前轮图片附件由 Remote adapter 写入 transfer bundle，禁止跨进程传 base64。 */
  promptImageAttachments?: FileAttachment[]
  rawPrompt?: string
  thinkingLevel?: ThinkingLevel
  thinking?: ThinkingConfig
  effort?: AgentEffort
  beforeToolCall?: (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<KilaBeforeToolCallResult | undefined>
  maxRetryDelayMs?: number
  modelCapabilities?: ModelCapabilitiesOverride
  modelMetadata?: ModelMetadataOverride
  modelProviderDbEntry?: ProviderDbModel
  modelCompat?: Model<Api>['compat'] & ModelCompatOverride
  runtimeContext?: string
  runtimeContextFingerprint?: string
}

/** Kila 权限层可在放行时修正工具参数；Pi SDK 本身只声明 block/reason。 */
export type KilaBeforeToolCallResult = BeforeToolCallResult & {
  updatedInput?: Record<string, unknown>
}
