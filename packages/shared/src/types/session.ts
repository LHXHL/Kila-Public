/**
 * Unified session types
 *
 * 单一 Session 协议只承载 Agent 模式。
 */

import type {
  AgentEvent,
  AgentRunLimits,
  ErrorCode,
  KilaPermissionMode,
  RecoveryAction,
  ThinkingLevel,
} from './agent'
import type { FileAttachment } from './attachment'

/** 会话项目目录来源 */
export type SessionProjectSource = 'temp' | 'user'

/** 会话绑定的项目目录 */
export interface SessionProject {
  /** 项目绝对路径 */
  path: string
  /** 项目显示名称 */
  name: string
  /** 项目来源 */
  source: SessionProjectSource
  /** 项目配置 profile ID */
  profileId: string
  /** 项目锁定时间戳 */
  lockedAt?: number
}

/** Session 消息角色 */
export type SessionMessageRole = 'user' | 'assistant' | 'system' | 'status' | 'tool'

/** 统一 Session 消息 */
export interface SessionMessage {
  /** 消息唯一标识 */
  id: string
  /** 消息角色 */
  role: SessionMessageRole
  /** 消息正文 */
  content: string
  /** 创建时间戳 */
  createdAt: number
  /** assistant 消息模型 ID */
  model?: string
  /** 附件 */
  attachments?: FileAttachment[]
  /** Agent 事件流 */
  events?: AgentEvent[]
  /** 状态消息错误码 */
  errorCode?: ErrorCode
  /** 状态消息错误标题 */
  errorTitle?: string
  /** 状态消息错误详细信息 */
  errorDetails?: string[]
  /** 状态消息原始错误 */
  errorOriginal?: string
  /** 状态消息是否可重试 */
  errorCanRetry?: boolean
  /** 状态消息恢复动作 */
  errorActions?: RecoveryAction[]
  /** 消息来源（缺省视为 manual） */
  messageSource?: 'manual' | 'scheduled-task' | 'im-bridge'
  /** 消息来源展示标签 */
  messageSourceLabel?: string
  /** 关联的定时任务 ID */
  relatedTaskId?: string
}

/** 统一 Session 元数据 */
export interface SessionMeta {
  /** Session 唯一标识 */
  id: string
  /** 标题 */
  title: string
  /** 会话来源（缺省视为 manual） */
  messageSource?: 'manual' | 'scheduled-task' | 'im-bridge'
  /** 会话来源展示标签 */
  messageSourceLabel?: string
  /** 关联的定时任务 ID */
  relatedTaskId?: string
  /** 是否置顶 */
  pinned?: boolean
  /** 分叉来源 Session；根会话为空 */
  parentSessionId?: string
  /** 分叉锚点消息 */
  branchPointMessageId?: string
  /** 分叉创建时间 */
  branchedAt?: number
  /** 当前会话绑定的项目目录 */
  project: SessionProject
  /** 附加目录 */
  attachedDirectories?: string[]
  /** 当前会话使用的渠道 */
  channelId?: string
  /** 当前会话使用的模型 */
  modelId?: string
  /** 当前会话使用的思考强度 */
  thinkingLevel?: ThinkingLevel
  /** 历史上下文轮数 */
  historyTurns?: number | 'infinite'
  /** 当前会话允许的工具白名单 */
  enabledToolIds?: string[]
  /** 当前会话覆盖的自定义 prompt ID（undefined = 全局默认） */
  systemPromptId?: string | null
  /** 创建时间戳 */
  createdAt: number
  /** 更新时间戳 */
  updatedAt: number
}

/** 创建 Session 的输入 */
export interface SessionCreateInput {
  title?: string
  messageSource?: 'manual' | 'scheduled-task' | 'im-bridge'
  messageSourceLabel?: string
  relatedTaskId?: string
  projectPath?: string
  channelId?: string
  modelId?: string
  thinkingLevel?: ThinkingLevel
  historyTurns?: number | 'infinite'
  enabledToolIds?: string[]
  systemPromptId?: string | null
  parentSessionId?: string
  branchPointMessageId?: string
  branchedAt?: number
}

/** 更新 Session 的输入 */
export type SessionMetaUpdates = Partial<Pick<
  SessionMeta,
  | 'title'
  | 'messageSource'
  | 'messageSourceLabel'
  | 'relatedTaskId'
  | 'pinned'
  | 'parentSessionId'
  | 'branchPointMessageId'
  | 'branchedAt'
  | 'project'
  | 'attachedDirectories'
  | 'channelId'
  | 'modelId'
  | 'thinkingLevel'
  | 'historyTurns'
  | 'enabledToolIds'
  | 'systemPromptId'
>>

/** 最近消息加载结果 */
export interface SessionRecentMessagesResult {
  messages: SessionMessage[]
  total: number
  hasMore: boolean
}

/** 会话快捷建议 */
export interface QuickSuggestion {
  /** 卡片标题（≤10 字） */
  title: string
  /** 卡片副标题（≤15 字） */
  detail: string
  /** 完整提示词 */
  prompt: string
}

/** 建议生成结果 */
export interface GenerateSuggestionsResult {
  suggestions: QuickSuggestion[]
}

export interface SessionMessagesPageInput {
  sessionId: string
  offset?: number
  limit?: number
}

export interface SessionMessagesPageResult {
  messages: SessionMessage[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
}

export type SessionSearchResultType = 'session' | 'project' | 'message'

export interface SessionSearchInput {
  query: string
  limitPerType?: number
}

export interface SessionSearchResult {
  type: SessionSearchResultType
  sessionId: string
  title: string
  subtitle?: string
  messageId?: string
  role?: SessionMessageRole
  snippet: string
  score: number
  createdAt?: number
  updatedAt: number
}

export interface SessionSearchResults {
  query: string
  results: SessionSearchResult[]
}

export interface SessionExportInput {
  sessionId: string
  targetDir?: string
  includeAttachments?: boolean
}

export interface SessionExportResult {
  canceled: boolean
  exportDir?: string
  sessionId?: string
  messageCount?: number
  attachmentCount?: number
  boardWidgetCount?: number
}

export interface SessionImportInput {
  sourceDir?: string
  dryRun?: boolean
}

export interface SessionImportResult {
  canceled: boolean
  dryRun: boolean
  sourceDir?: string
  sessionId?: string
  title?: string
  messageCount?: number
  attachmentCount?: number
  boardWidgetCount?: number
  sourceVersion?: number
}

export interface SessionProjectFilesSaveInput {
  sessionId: string
  files: Array<{ filename: string; data: string }>
}

export interface SessionRegenerateTurnInput {
  sessionId: string
  messageId: string
}

/** 将会话历史截断到指定消息，不自动重新发送。 */
export interface SessionRewindInput {
  sessionId: string
  messageId: string
}

export interface SessionEditTurnInput {
  sessionId: string
  messageId: string
  userMessage: string
  attachments?: FileAttachment[]
}

export interface SessionBranchFromMessageInput {
  sessionId: string
  messageId: string
}

export interface SessionBranchComparison {
  parentSessionId: string
  branchSessionId: string
  branchPointMessageId: string
  sharedMessageCount: number
  parentOnlyMessageCount: number
  branchOnlyMessageCount: number
  parentLatestMessageId?: string
  branchLatestMessageId?: string
}

/** 统一 Session 发送输入 */
export interface SessionSendInput {
  sessionId: string
  userMessage: string
  /** 隐身模式：本条消息不加入记忆（Agent 仍可读取已有记忆） */
  incognito?: boolean
  systemMessage?: string
  attachments?: FileAttachment[]
  thinkingLevel?: ThinkingLevel
  enabledToolIds?: string[]
  historyTurns?: number | 'infinite'
  channelId?: string
  modelId?: string
  /**
   * Renderer-observed session meta timestamp. Main uses this to avoid
   * persisting stale model/channel selections after out-of-band session updates.
   */
  sessionUpdatedAt?: number
  skipAutoTitle?: boolean
  thinkingEnabled?: boolean
  additionalDirectories?: string[]
  customMcpServers?: Record<string, Record<string, unknown>>
  permissionModeOverride?: KilaPermissionMode
  /** 单次 Agent runtime 的可选资源上限；缺省时保持原有无限制运行。 */
  runLimits?: AgentRunLimits
  /** /skill mention 标识列表（兼容 plain slug 与 source:slug） */
  mentionedSkills?: string[]
  mentionedMcpServers?: string[]
  messageSource?: 'manual' | 'scheduled-task' | 'im-bridge'
  messageSourceLabel?: string
  relatedTaskId?: string
}

/** 统一 Session 流式事件 */
export type SessionStreamEvent =
  | { type: 'agent_event'; sessionId: string; event: AgentEvent }

/** 统一完成事件 */
export interface SessionStreamCompletePayload {
  sessionId: string
  /** 终态结果；旧发送方缺失时按 success 兼容。 */
  outcome?: 'success' | 'stopped' | 'error'
}

/** 统一错误事件 */
export interface SessionStreamErrorPayload {
  sessionId: string
  error: string
}

/** 标题更新事件 */
export interface SessionTitleUpdatedPayload {
  sessionId: string
  title: string
}

/** Session 元数据发生变化 */
export interface SessionUpdatedPayload {
  sessionId: string
  reason: 'created' | 'updated' | 'deleted'
}

/** Session IPC 常量 */
export const SESSION_IPC_CHANNELS = {
  LIST_SESSIONS: 'session:list-sessions',
  CREATE_SESSION: 'session:create-session',
  GET_MESSAGES: 'session:get-messages',
  GET_RECENT_MESSAGES: 'session:get-recent-messages',
  GET_MESSAGES_PAGE: 'session:get-messages-page',
  SET_ACTIVE_PROJECT_WATCHES: 'session:set-active-project-watches',
  SEARCH: 'session:search',
  EXPORT: 'session:export',
  IMPORT: 'session:import',
  UPDATE_META: 'session:update-meta',
  UPDATE_TITLE: 'session:update-title',
  DELETE_SESSION: 'session:delete-session',
  TOGGLE_PIN: 'session:toggle-pin',
  SEND_MESSAGE: 'session:send-message',
  REGENERATE_TURN: 'session:regenerate-turn',
  REWIND: 'session:rewind',
  EDIT_TURN: 'session:edit-turn',
  BRANCH_FROM_MESSAGE: 'session:branch-from-message',
  COMPARE_BRANCH: 'session:compare-branch',
  STOP: 'session:stop',
  UPDATE_PROJECT: 'session:update-project',
  SAVE_PROJECT_FILES: 'session:save-project-files',
  GENERATE_TITLE: 'session:generate-title',
  GENERATE_SUGGESTIONS: 'session:generate-suggestions',
  STREAM_EVENT: 'session:stream:event',
  STREAM_COMPLETE: 'session:stream:complete',
  STREAM_ERROR: 'session:stream:error',
  TITLE_UPDATED: 'session:title-updated',
  UPDATED: 'session:updated',
} as const
