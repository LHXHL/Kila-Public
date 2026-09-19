import type { AgentEvent, AgentMessage, AgentEffort, ErrorCode, ThinkingConfig, ThinkingLevel, TypedError } from './agent'
import type { RuntimePromptImageReferenceV1 } from './agent-runtime-transfer'

/**
 * Pi Runtime 跨进程协议的纯数据类型。
 * 这里不引用 Electron、Pi SDK 或主进程实现，保证协议可以在 Utility 入口复用。
 */

export type RuntimeProtocolVersion = 1

export type RuntimeMessageChannel = 'command' | 'control' | 'event'

export interface RuntimeMessageEnvelopeV1<TPayload = unknown> {
  version: 1
  channel: RuntimeMessageChannel
  sequence: number
  type: string
  payload: TPayload
}

export interface RuntimeConfigV1 {
  configRevision: number
  configFingerprint: string
  credentialRevision: number
  channel: unknown
  model: Record<string, unknown>
  systemPrompt: string
  cwd: string
  toolDescriptorsHash: string
  thinkingLevel: string
}

export type RuntimeToolSource = 'kila-coding' | 'kila' | 'mcp' | 'runtime'
export type RuntimeToolPermission = 'read' | 'write' | 'execute' | 'interactive'
export type RuntimeToolResultKind = 'text' | 'image-ref' | 'resource' | 'structured' | 'mixed'

export interface RuntimeToolDescriptorV1 {
  version: 1
  toolId: string
  name: string
  label?: string
  description: string
  parameters: Record<string, unknown>
  source: RuntimeToolSource
  permission: RuntimeToolPermission
  resultKinds: RuntimeToolResultKind[]
  supportsStreaming: boolean
}

export interface RuntimeToolIdentityV1 {
  appBootId: string
  bootId: string
  sessionId: string
  generation: number
  runId: string
  toolId: string
  toolCallId: string
}

export interface RuntimeToolCallV1 extends RuntimeToolIdentityV1 {
  requestedArgs: Record<string, unknown>
  approvedArgs: Record<string, unknown>
  argsModified: boolean
}

export interface RuntimeToolResultV1 {
  text: string
  details?: Record<string, unknown>
  isError: boolean
}

export interface RuntimeToolUpdateV1 extends RuntimeToolIdentityV1 {
  updateSequence: number
  partialText: string
  cumulativeBytes: number
  truncated?: 'backpressure_limit'
}

export interface RuntimeToolUpdateAckV1 extends RuntimeToolIdentityV1 {
  updateSequence: number
  accepted: boolean
}

export interface RuntimeHandshakePayloadV1 {
  appBootId: string
  spawnNonce: string
}

export interface RuntimeReadyPayloadV1 {
  protocolVersion: RuntimeProtocolVersion
  appBootId: string
  spawnNonce: string
  bootId: string
  pid: number
  runtimeVersion: string
}

export interface RuntimeHeartbeatPayloadV1 {
  bootId: string
  pid: number
  activeSessionCount: number
  rssBytes?: number
}

export interface RuntimeShutdownPayloadV1 {
  reason: 'app-quit' | 'dispose' | 'crash-recovery'
}

export interface RuntimeShutdownAckPayloadV1 {
  bootId: string
  activeRunCount: number
}

export interface RuntimeResetSessionPayloadV1 {
  sessionId: string
}

export interface RuntimeResetAckPayloadV1 {
  bootId: string
  sessionId: string
  ok: boolean
  message?: string
}

export interface RuntimeFatalPayloadV1 {
  code:
    | 'runtime_handshake_failed'
    | 'runtime_crashed'
    | 'runtime_protocol_desync'
    | 'runtime_protocol_payload_too_large'
    | 'runtime_resource_exhausted'
  message: string
}

export interface RuntimeRunStartPayloadV1 {
  sessionId: string
  runId: string
  generation: number
  bundlePath: string
  manifestSha256: string
  configRevision: number
}

export interface RuntimeRunLifecyclePayloadV1 {
  sessionId: string
  runId: string
  generation: number
}

export interface RuntimeRunSettledPayloadV1 extends RuntimeRunLifecyclePayloadV1 {
  finalEventSequence: number
}

export interface RuntimeRunRejectedPayloadV1 extends RuntimeRunLifecyclePayloadV1 {
  error: Pick<TypedError, 'code' | 'message'> & { code: ErrorCode }
}

export interface RuntimeRunPersistedPayloadV1 extends RuntimeRunLifecyclePayloadV1 {
  lastMessageId?: string
}

export interface RuntimeRunEventPayloadV1 extends RuntimeRunLifecyclePayloadV1 {
  eventSequence: number
  event: AgentEvent
}

/**
 * Query 参数通过私有 transfer bundle 传递，函数和 AbortSignal 不进入 bundle。
 * `channel` / 模型能力字段保留为 JSON 对象，避免协议层依赖 Pi 或 Electron 类型。
 */
export interface RuntimeQueryBootstrapV1 {
  sessionId: string
  runId: string
  configRevision: number
  configFingerprint: string
  credentialRevision: number
  prompt: string
  rawPrompt?: string
  model: string
  cwd: string
  channel: Record<string, unknown>
  apiKey: string
  systemPrompt: string
  historyMessages: AgentMessage[]
  /** 只传 bundle 内的受控文件引用，禁止把图片 base64 放进 bootstrap。 */
  promptImages: RuntimePromptImageReferenceV1[]
  thinkingLevel?: ThinkingLevel
  thinking?: ThinkingConfig
  effort?: AgentEffort
  maxRetryDelayMs?: number
  modelCapabilities?: unknown
  modelMetadata?: unknown
  modelProviderDbEntry?: unknown
  modelCompat?: unknown
  runtimeContext?: string
  runtimeContextFingerprint?: string
}

export interface RuntimeRunAbortPayloadV1 extends RuntimeRunLifecyclePayloadV1 {
  reason?: string
}

export interface RuntimeRunControlPayloadV1 extends RuntimeRunLifecyclePayloadV1 {
  content: string
}

export interface RuntimeToolCallPayloadV1 extends RuntimeToolCallV1 {
  toolName: string
}

export interface RuntimeToolResultPayloadV1 extends RuntimeToolIdentityV1 {
  text: string
  details?: Record<string, unknown>
  approvedArgs?: Record<string, unknown>
  resultRef?: RuntimeToolResultReferenceV1
  isError: boolean
}

export interface RuntimeToolResultReferenceV1 {
  relativePath: string
  sha256: string
  size: number
}
