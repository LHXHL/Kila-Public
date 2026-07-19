import type { ChannelModel, ProviderType } from './channel'
import type {
  AskUserResponse,
  KilaPermissionMode,
  McpTransportType,
  SkillMeta,
  WorkspaceCapabilities,
} from './agent'
import type { PersonalityDocument } from './personality'
import type {
  SessionMessage,
  SessionStreamEvent,
  SessionTitleUpdatedPayload,
  SessionUpdatedPayload,
} from './session'
import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskRunRecord,
  ScheduledTaskRuntimeStatus,
  ScheduledTaskUpdateInput,
} from './scheduled-task'
import type { ThinkingLevel } from './agent'

export const CLI_BRIDGE_VERSION = 1 as const

export interface CliBridgeDiscovery {
  version: 1
  transport: 'http'
  host: '127.0.0.1'
  port: number
  token: string
  pid: number
  startedAt: number
  appVersion: string
  bridgeVersion: typeof CLI_BRIDGE_VERSION
}

export interface CliBridgeHealthResponse {
  ok: true
  pid: number
  appVersion: string
  bridgeVersion: typeof CLI_BRIDGE_VERSION
}

export interface CliBridgeDefaultSelectionStatus {
  channelId?: string
  channelName?: string
  channelExists: boolean
  channelEnabled?: boolean
  modelId?: string
  modelExists: boolean
  modelEnabled?: boolean
}

export interface CliBridgeStatusResponse extends CliBridgeHealthResponse {
  defaults: CliBridgeDefaultSelectionStatus
}

export interface CliChannelSummary {
  id: string
  name: string
  provider: ProviderType
  enabled: boolean
  models: ChannelModel[]
  createdAt: number
  updatedAt: number
}

export interface CliBridgeChannelsResponse {
  channels: CliChannelSummary[]
}

export interface CliBridgeChannelResponse {
  channel: CliChannelSummary & {
    baseUrl: string
    enabledModelCount: number
  }
}

export interface CliBridgeChannelModelsResponse {
  channelId: string
  channelName: string
  provider: ProviderType
  models: ChannelModel[]
}

export interface CliBridgeProvidersResponse {
  providers: Array<{
    provider: ProviderType
    label: string
    channelCount: number
    enabledChannelCount: number
    modelCount: number
    enabledModelCount: number
  }>
}

export interface CliBridgeCapabilitiesResponse extends WorkspaceCapabilities {}

export interface CliSessionSummary {
  id: string
  title: string
  projectPath: string
  channelId?: string
  modelId?: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

export interface CliBridgeSessionsResponse {
  sessions: CliSessionSummary[]
}

export interface CliBridgeSessionResponse {
  session: CliSessionSummary & {
    pinned?: boolean
    attachedDirectories?: string[]
    thinkingLevel?: ThinkingLevel
    historyTurns?: number | 'infinite'
    enabledToolIds?: string[]
  }
}

export interface CliBridgeSessionMessagesResponse {
  sessionId: string
  messages: SessionMessage[]
  total: number
  hasMore: boolean
}

export interface CliBridgeSessionCreateRequest {
  title?: string
  projectPath?: string
  channelId?: string
  modelId?: string
}

export interface CliBridgeSessionUpdateRequest {
  title?: string
  pinned?: boolean
  projectPath?: string
  channelId?: string
  modelId?: string
  thinkingLevel?: ThinkingLevel
  historyTurns?: number | 'infinite'
  enabledToolIds?: string[]
}

export type CliConfigValue =
  | null
  | boolean
  | number
  | string
  | CliConfigValue[]
  | { [key: string]: CliConfigValue }

export interface CliBridgeConfigListResponse {
  config: CliConfigValue
}

export interface CliBridgeConfigValueResponse {
  path: string
  exists: boolean
  value?: CliConfigValue
}

export interface CliBridgeConfigSetRequest {
  path: string
  value: CliConfigValue
}

export interface CliBridgeTaskListResponse {
  tasks: ScheduledTask[]
}

export interface CliBridgeTaskResponse {
  task: ScheduledTask
}

export interface CliBridgeTaskRunsResponse {
  taskId: string
  runs: ScheduledTaskRunRecord[]
}

export interface CliBridgeTaskRuntimeResponse {
  runtime: ScheduledTaskRuntimeStatus
}

export interface CliBridgeTaskCreateRequest extends ScheduledTaskCreateInput {}

export interface CliBridgeTaskUpdateRequest extends ScheduledTaskUpdateInput {}

export interface CliBridgeDailyReportResponse {
  date: string
  rangeStart: number
  rangeEnd: number
  sessions: {
    activeCount: number
    createdCount: number
    userMessageCount: number
    assistantMessageCount: number
    scheduledMessageCount: number
  }
  tasks: {
    totalRuns: number
    successCount: number
    errorCount: number
    skippedCount: number
    stoppedByAiCount: number
  }
}

export interface CliBridgePersonalityResponse {
  document: PersonalityDocument
}

export interface CliBridgePersonalityUpdateRequest {
  content: string
}

export interface CliBridgeMcpServerResponse {
  server: {
    name: string
    enabled: boolean
    type: McpTransportType
  }
}

export interface CliBridgeSkillResponse {
  skill: SkillMeta
}

export interface CliRunRequest {
  message: string
  sessionId?: string
  projectPath?: string
  channelId?: string
  modelId?: string
  permissionModeOverride?: KilaPermissionMode
}

export interface CliPermissionResponseRequest {
  requestId: string
  behavior: 'allow' | 'deny'
  alwaysAllow: boolean
}

export interface CliAskUserResponseRequest extends AskUserResponse {}

export type CliRunCompleteReason = 'completed' | 'stopped' | 'error'

export interface CliRunSessionCreatedEvent {
  session: CliSessionSummary
}

export type CliRunSessionStreamEvent = SessionStreamEvent

export interface CliRunSessionCompleteEvent {
  sessionId: string
  reason: CliRunCompleteReason
}

export interface CliRunSessionErrorEvent {
  sessionId: string
  error: string
}

export type CliRunSseEvent =
  | { event: 'session_created'; data: CliRunSessionCreatedEvent }
  | { event: 'session_stream'; data: CliRunSessionStreamEvent }
  | { event: 'session_complete'; data: CliRunSessionCompleteEvent }
  | { event: 'session_error'; data: CliRunSessionErrorEvent }
  | { event: 'title_updated'; data: SessionTitleUpdatedPayload }
  | { event: 'session_updated'; data: SessionUpdatedPayload }

export interface CliBridgeErrorResponse {
  error: string
}

export function isCliBridgeSseEventName(
  value: string,
): value is CliRunSseEvent['event'] {
  return value === 'session_created'
    || value === 'session_stream'
    || value === 'session_complete'
    || value === 'session_error'
    || value === 'title_updated'
    || value === 'session_updated'
}

export function toCliCapabilitiesSummary(
  capabilities: WorkspaceCapabilities,
): CliBridgeCapabilitiesResponse {
  return {
    mcpServers: capabilities.mcpServers,
    skills: capabilities.skills as SkillMeta[],
  }
}
