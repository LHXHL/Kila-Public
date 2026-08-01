/**
 * Agent 相关类型定义
 *
 * 包含 Agent runtime 集成所需的事件类型、会话管理、消息持久化和 IPC 通道常量。
 */

import type { FileAttachment } from './attachment'
import type { SessionContextSnapshot } from '../utils/estimate-session-context'

// ===== Agent 工作区 =====

/** Agent 工作区 */
export interface AgentWorkspace {
  /** 工作区唯一标识 */
  id: string
  /** 显示名称 */
  name: string
  /** URL-safe 目录名（创建后不可变） */
  slug: string
  /** 创建时间戳 */
  createdAt: number
  /** 更新时间戳 */
  updatedAt: number
}

// ===== SDK 新增类型声明（0.2.52 ~ 0.2.63） =====

/**
 * 思考模式配置。控制 Claude 的推理/思考行为：
 * adaptive=Claude 自行决定何时及思考多少（Opus 4.6+ 默认）；enabled=固定思考 Token 预算（旧模型）；disabled=不使用扩展思考。
 */
export type ThinkingConfig =
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens: number }
  | { type: 'disabled' }

/**
 * 用户可见的统一思考等级
 *
 * - none: 关闭思考
 * - low / medium / high: 逐级增加推理深度
 * - xhigh: 极高推理深度
 */
export type ThinkingLevel = 'none' | 'low' | 'medium' | 'high' | 'xhigh'

/**
 * 推理深度等级，与 adaptive thinking 配合使用；兼容旧 Agent 设置存储（xhigh 在旧字段中对应 max）。
 * - low: 最少思考，最快响应
 * - medium: 适度思考
 * - high: 深度推理（默认）
 * - max: 最大深度（仅 Opus 4.6）
 */
export type AgentEffort = 'low' | 'medium' | 'high' | 'max'

/**
 * 自定义子代理定义
 *
 * 通过 SDK 的 agents 选项注册可被 Agent 工具调用的自定义子代理。
 */
export interface AgentDefinition {
  /** 自然语言描述，说明何时使用该代理 */
  description: string
  /** 允许使用的工具名称列表，省略则继承父级所有工具 */
  tools?: string[]
  /** 明确禁止使用的工具名称列表 */
  disallowedTools?: string[]
  /** 自定义系统提示词 */
  prompt?: string
  /** 使用的模型（覆盖父级） */
  model?: string
  /** 最大轮次（覆盖父级） */
  maxTurns?: number
}

/**
 * SDK 会话信息（listSessions 返回）
 *
 * SDK 0.2.53 新增，用于发现和列出历史会话。
 */
export interface SDKSessionInfo {
  /** 会话 ID */
  sessionId: string
  /** 项目路径 */
  projectPath?: string
  /** 会话标题（从 transcript 提取） */
  title?: string
  /** 创建时间 ISO 字符串 */
  createdAt?: string
  /** 最后更新时间 ISO 字符串 */
  lastUpdatedAt?: string
  /** 消息计数概要 */
  messageCount?: number
}

/**
 * SDK 会话消息（getSessionMessages 返回）
 *
 * SDK 0.2.59 新增，用于读取会话的完整对话历史。
 */
export interface SDKSessionMessage {
  /** 消息类型（SDK 原始类型标识） */
  type: string
  /** 消息角色 */
  role?: 'user' | 'assistant'
  /** 消息内容 */
  content?: unknown
  /** 时间戳 */
  timestamp?: string
}

/**
 * SDK Beta 特性标识
 *
 * 当前支持：
 * - context-1m-2025-08-07: 启用 1M token 上下文窗口（仅 Sonnet 4/4.5）
 */
export type SdkBeta = 'context-1m-2025-08-07'

/**
 * JSON Schema 输出格式
 *
 * 用于指定结构化输出，Agent 将返回符合 Schema 的 JSON 数据。
 */
export interface JsonSchemaOutputFormat {
  type: 'json_schema'
  /** JSON Schema 定义 */
  schema: Record<string, unknown>
  /** Schema 名称（可选） */
  name?: string
  /** Schema 描述（可选） */
  description?: string
}

// ===== Agent 事件类型 =====

/** 错误代码 */
export type ErrorCode =
  | 'invalid_api_key'
  | 'permission_denied'
  | 'region_restricted'
  | 'request_blocked'
  | 'protocol_mismatch'
  | 'invalid_credentials'
  | 'response_too_large'
  | 'expired_oauth_token'
  | 'token_expired'
  | 'rate_limited'
  | 'service_error'
  | 'service_unavailable'
  | 'network_error'
  | 'mcp_auth_required'
  | 'mcp_unreachable'
  | 'billing_error'
  | 'model_no_tool_support'
  | 'invalid_model'
  | 'data_policy_error'
  | 'invalid_request'
  | 'image_too_large'
  | 'image_not_supported'
  | 'prompt_too_long'
  | 'provider_error'
  | 'unknown_error'

/** 恢复操作 */
export interface RecoveryAction {
  /** 操作键（用于快捷键） */
  key: string
  /** 操作标签 */
  label: string
  /** 操作类型 */
  action: 'settings' | 'retry' | 'cancel' | 'compact' | string
}

/** 类型化错误 */
export interface TypedError {
  /** 错误代码，用于程序化处理 */
  code: ErrorCode
  /** 用户友好的标题 */
  title: string
  /** 详细的错误消息 */
  message: string
  /** 建议的恢复操作 */
  actions: RecoveryAction[]
  /** 是否可以自动重试 */
  canRetry: boolean
  /** 重试延迟（毫秒） */
  retryDelayMs?: number
  /** 诊断详情（用于调试） */
  details?: string[]
  /** 原始错误消息（用于调试） */
  originalError?: string
}

/** Agent 事件 Usage 信息 */
export interface AgentEventUsage {
  /** 本次 run 内所有模型调用的 input token 总和，用于成本统计。 */
  inputTokens: number
  /** 最后一次模型调用的上下文 input token，用于上下文校准，不参与成本累加。 */
  contextInputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  costUsd?: number
  contextWindow?: number
}

/** 供用户核对本轮召回来源的受限内容片段。 */
export interface MemoryRecallTraceItem {
  kind: 'memory' | 'thread' | 'notebook'
  /** 记忆 URI、会话线程 ID 或笔记 URI。 */
  id: string
  title: string
  /** 召回时内容的受限片段，避免把完整大型文档重复写入消息记录。 */
  content: string
  /** 内容是否因为长度限制被截断。 */
  truncated?: boolean
  /** local / nowledge 等来源标识。 */
  provider?: 'local' | 'nowledge'
  /** 线程原始来源或其他补充来源说明。 */
  source?: string
  category?: string
  tags?: string[]
  relevanceScore?: number
}

/** 单次 Agent 运行的记忆召回摘要。 */
export interface MemoryRunTrace {
  enabled: boolean
  provider?: 'local' | 'nowledge'
  recalledMemoryCount: number
  relatedThreadCount: number
  notebookCount: number
  /** 新版本会保存本轮实际召回项的受限片段；旧历史消息可能没有该字段。 */
  recallItems?: MemoryRecallTraceItem[]
  usedGlobalWorkingMemory: boolean
  usedProjectWorkingMemory: boolean
  /** 隐身模式只读召回，不触发运行后写入。 */
  incognito: boolean
  recallStatus: 'success' | 'cached' | 'disabled' | 'error'
  /** 运行后写入状态；queued 会在 flush 完成后更新为 written/failed。 */
  writeStatus?: 'skipped' | 'queued' | 'written' | 'failed'
  writtenMemoryCount?: number
  writeError?: string
}

/**
 * 重试尝试记录
 *
 * 记录每次重试尝试的详细信息，用于错误诊断和 UI 展示。
 */
export interface RetryAttempt {
  /** 第几次尝试 (1-based) */
  attempt: number
  /** 时间戳 */
  timestamp: number
  /** 错误原因（简短描述，如"SDK 响应超时"） */
  reason: string
  /** 完整错误消息 */
  errorMessage: string
  /** stderr 输出（可选） */
  stderr?: string
  /** 堆栈跟踪（可选） */
  stack?: string
  /** 运行环境信息（可选） */
  environment?: {
    /** 运行时，如 "Bun 1.0.0" */
    runtime: string
    /** 平台，如 "darwin arm64" */
    platform: string
    /** 模型，如 "claude-sonnet-4-5-20250929" */
    model: string
    /** 工作区名称 */
    workspace?: string
    /** 工作目录 */
    cwd?: string
  }
  /** 延迟秒数 */
  delaySeconds: number
}

/**
 * Agent 事件类型
 *
/** MCP 工具结果中的图片附件 */
export interface AgentToolResultImage {
  localPath: string
  filename: string
  mediaType: string
}

/**
 * Agent 事件流类型
 *
 * 从 SDK 消息转换而来的扁平事件流，用于驱动 UI 渲染。
 */
export type AgentEvent =
  // 上下文快照
  | { type: 'context_snapshot'; snapshot: SessionContextSnapshot }
  // 记忆召回摘要（不包含记忆正文）
  | { type: 'memory_trace'; trace: MemoryRunTrace }
  // 文本流式输出
  | { type: 'text_delta'; text: string; turnId?: string; parentToolUseId?: string }
  | { type: 'text_complete'; text: string; isIntermediate: boolean; turnId?: string; parentToolUseId?: string }
  // 思考流式输出
  | { type: 'thinking_start'; contentIndex: number; timestamp?: number; turnId?: string; parentToolUseId?: string }
  | { type: 'thinking_delta'; contentIndex: number; text: string; timestamp?: number; turnId?: string; parentToolUseId?: string }
  | { type: 'thinking_end'; contentIndex: number; text: string; timestamp?: number; turnId?: string; parentToolUseId?: string }
  // 工具执行
  | { type: 'tool_start'; toolName: string; toolUseId: string; input: Record<string, unknown>; intent?: string; displayName?: string; timestamp?: number; turnId?: string; parentToolUseId?: string }
  | { type: 'tool_update'; toolUseId: string; toolName?: string; partialText: string; timestamp?: number; turnId?: string; parentToolUseId?: string }
  | { type: 'tool_result'; toolUseId: string; toolName?: string; result: string; isError: boolean; input?: Record<string, unknown>; timestamp?: number; turnId?: string; parentToolUseId?: string; imageAttachments?: AgentToolResultImage[] }
  // 后台任务
  | { type: 'task_backgrounded'; toolUseId: string; taskId: string; intent?: string; turnId?: string }
  | { type: 'shell_backgrounded'; toolUseId: string; shellId: string; intent?: string; command?: string; turnId?: string }
  | { type: 'shell_killed'; shellId: string; turnId?: string }
  // 工具使用摘要
  | { type: 'tool_use_summary'; summary: string; precedingToolUseIds: string[] }
  // 控制流
  | { type: 'complete'; stopReason?: string; usage?: AgentEventUsage }
  | { type: 'error'; message: string }
  | { type: 'typed_error'; error: TypedError }
  | { type: 'turn_start'; timestamp?: number; turnId?: string }
  | { type: 'turn_end'; timestamp?: number; toolResultCount: number; turnId?: string }
  // 重试机制
  | { type: 'retrying'; attempt: number; maxAttempts: number; delaySeconds: number; reason: string }  // 保留向后兼容
  | { type: 'retry_attempt'; attemptData: RetryAttempt }  // 新增：记录详细尝试信息
  | { type: 'retry_cleared' }  // 新增：重试成功，清除状态
  | { type: 'retry_failed'; finalAttempt: RetryAttempt }  // 新增：重试失败
  // Usage 更新
  | { type: 'usage_update'; usage: { inputTokens: number; contextWindow?: number } }
  | {
      type: 'budget_warning'
      exceededUsd: boolean
      exceededTokens: boolean
      costUsd: number
      budgetUsd?: number
      totalTokens: number
      budgetTokens?: number
    }
  // 单次 runtime 资源边界（不同于应用级月度 Token budget）。
  | { type: 'runtime_limit_reached'; limit: AgentRuntimeLimitReached }
  // 上下文压缩
  | { type: 'compacting' }
  | {
      type: 'compact_complete'
      reason?: 'manual' | 'threshold' | 'overflow'
      summaryText?: string
      firstKeptEntryId?: string
      tokensBefore?: number
      details?: unknown
      willRetry?: boolean
      /** 生成摘要那次 LLM 调用的真实用量；压缩也要跑模型调用，不计会漏掉这部分计费。 */
      usage?: AgentEventUsage
      /** 压缩后的估算上下文 token，用于向用户展示"省了多少"。 */
      estimatedTokensAfter?: number
    }
  // Pi 手动压缩的良性空操作（会话过小或已经压缩），不能伪装成真正的压缩边界。
  | { type: 'compact_noop'; message: string }
  // 压缩失败（瞬时 / 可重试错误）。不是会话终态：Pi 的 willRetry 为真时会自动重试摘要
  // 或继续 agent 主循环；只有最终 agent_settled 失败才映射为 error 终态。映射成裸 error
  // 会让渲染层提前把会话打成 stopped，表现为「压缩中断会话」。
  | { type: 'compact_failed'; message: string; willRetry: boolean; reason?: 'manual' | 'threshold' | 'overflow' }
  // 摘要生成的重试进度（Pi 0.82 起）；压缩期间不给反馈，用户会面对十几秒的静默。
  | { type: 'summarization_retry'; attempt: number; delaySeconds?: number; phase: 'scheduled' | 'start' | 'finished' }
  // 权限请求
  | { type: 'permission_request'; request: PermissionRequest }
  | { type: 'permission_resolved'; requestId: string; behavior: 'allow' | 'deny'; resolution: 'user' | 'timeout' | 'session_end' }
  // AskUserQuestion 交互式问答
  | { type: 'ask_user_request'; request: AskUserRequest }
  | { type: 'ask_user_resolved'; requestId: string }
  // 提示建议
  | { type: 'prompt_suggestion'; suggestion: string }
  // 模型确认（SDK 确认实际使用的模型）
  | { type: 'model_resolved'; model: string }

// ===== Agent 会话管理 =====

/**
 * Agent 会话轻量索引项
 *
 * 旧 agent-session 索引兼容结构；当前活跃主链使用 unified session。
 */
export interface AgentSessionMeta {
  /** 会话唯一标识 */
  id: string
  /** 会话标题 */
  title: string
  /** 使用的渠道 ID */
  channelId?: string
  /** 所属工作区 ID */
  workspaceId?: string
  /** 兼容统一 Session 的项目路径 */
  projectPath?: string
  /** 兼容统一 Session 的项目 profile ID */
  projectProfileId?: string
  /** 项目锁定时间 */
  projectLockedAt?: number
  /** 是否置顶 */
  pinned?: boolean
  /** 附加的外部目录路径列表（绝对路径，作为 Agent 可访问目录传递） */
  attachedDirectories?: string[]
  /** 创建时间戳 */
  createdAt: number
  /** 更新时间戳 */
  updatedAt: number
}

/**
 * Agent 持久化消息
 *
 * 存储在 ~/.kila/agent-sessions/{id}.jsonl 中。
 */
export interface AgentMessage {
  /** 消息唯一标识 */
  id: string
  /** 角色 */
  role: 'user' | 'assistant' | 'tool' | 'status'
  /** 消息内容 */
  content: string
  /** 创建时间戳 */
  createdAt: number
  /** 使用的模型 ID（assistant 消息） */
  model?: string
  /** 结构化附件（新格式，兼容旧 attached_files 文本块） */
  attachments?: FileAttachment[]
  /** 工具活动数据（agent 事件列表，用于回放工具调用） */
  events?: AgentEvent[]
  /** 错误代码（status 消息，role='status' 时使用） */
  errorCode?: ErrorCode
  /** 错误标题（status 消息） */
  errorTitle?: string
  /** 错误详细信息（status 消息） */
  errorDetails?: string[]
  /** 原始错误消息（status 消息） */
  errorOriginal?: string
  /** 是否可以重试（status 消息） */
  errorCanRetry?: boolean
  /** 错误恢复操作（status 消息） */
  errorActions?: RecoveryAction[]
  /** 消息来源（缺省视为 manual） */
  messageSource?: 'manual' | 'scheduled-task' | 'im-bridge'
  /** 消息来源展示标签 */
  messageSourceLabel?: string
  /** 关联的定时任务 ID */
  relatedTaskId?: string
}

// ===== Agent 标题生成输入 =====

/** Agent 标题生成输入 */
export interface AgentGenerateTitleInput {
  /** 用户第一条消息内容 */
  userMessage: string
  /** 渠道 ID（用于获取 API Key） */
  channelId: string
  /** 模型 ID */
  modelId: string
}

// ===== MCP 服务器配置 =====

/** MCP 传输类型 */
export type McpTransportType = 'stdio' | 'http' | 'sse'

/** MCP 服务器条目 */
export interface McpServerEntry {
  type: McpTransportType
  /** stdio: 可执行命令 */
  command?: string
  /** stdio: 命令参数 */
  args?: string[]
  /** stdio: 环境变量 */
  env?: Record<string, string>
  /** http/sse: 服务端 URL */
  url?: string
  /** http/sse: 请求头 */
  headers?: Record<string, string>
  /** 启动超时（秒），仅 stdio 类型有效，默认 30 */
  timeout?: number
  /** 是否启用 */
  enabled: boolean
  /** 是否为内置 MCP（不可删除，仅可配置 env） */
  isBuiltin?: boolean
  /** 最后一次测试结果 */
  lastTestResult?: {
    success: boolean
    message: string
    timestamp: number
  }
}

/** 工作区 MCP 配置文件 */
export interface WorkspaceMcpConfig {
  servers: Record<string, McpServerEntry>
}

// ===== Skill 元数据 =====

/** 工作区 Skill 元数据 */
export interface SkillMeta {
  slug: string
  name: string
  description?: string
  icon?: string
  enabled: boolean
}

export type GlobalSkillEntrySource = 'kila' | 'codex' | 'claude'

export type GlobalSkillEntryKind = 'skill' | 'plugin'

export type GlobalSkillContentType = 'markdown' | 'json'

export type GlobalSkillManagementMode = 'managed' | 'readonly'

/** 全局能力库条目摘要 */
export interface GlobalSkillEntry {
  /** 条目唯一 ID（用于详情加载和 UI 选中） */
  id: string
  slug: string
  name: string
  description?: string
  icon?: string
  enabled: boolean
  source: GlobalSkillEntrySource
  sourceLabel: string
  kind: GlobalSkillEntryKind
  managementMode: GlobalSkillManagementMode
}

/** 全局能力库条目详情 */
export interface GlobalSkillDetail extends GlobalSkillEntry {
  /** 条目所在目录绝对路径 */
  path: string
  /** 条目根目录或来源根目录（用于展示来源） */
  sourceRoot?: string
  /** SKILL.md / plugin.json 原始内容 */
  content: string
  /** 内容类型，决定右侧预览器渲染方式 */
  contentType: GlobalSkillContentType
  /** 原始内容文件绝对路径 */
  contentPath: string
}

export interface GlobalSkillInstallInput {
  repoUrl: string
  subdir?: string
  slug?: string
}

export interface GlobalSkillInstallResult {
  slug: string
  path: string
  sourceUrl: string
  installedAt: number
}

/** 工作区能力摘要（MCP + Skill 计数） */
export interface WorkspaceCapabilities {
  mcpServers: Array<{ name: string; enabled: boolean; type: McpTransportType }>
  skills: SkillMeta[]
}

// ===== Agent Runtime 运行边界 =====

/** 单次 Agent run 的可选资源上限；全部缺省时完全保持既有行为。 */
export interface AgentRunLimits {
  /** 最大 Pi turn 数；达到后不再开始下一 turn。 */
  maxTurns?: number
  /** 最大实际工具执行次数；达到后阻止后续工具调用。 */
  maxToolCalls?: number
  /** 最大运行墙钟时间（毫秒）。 */
  maxDurationMs?: number
  /** 最大运行内已知模型成本（USD）。 */
  maxBudgetUsd?: number
}

export type AgentRunLimitKind = 'max_turns' | 'max_tool_calls' | 'max_duration_ms' | 'max_budget_usd'

/** Agent runtime 实际命中的运行边界。 */
export interface AgentRuntimeLimitReached {
  kind: AgentRunLimitKind
  limit: number
  observed: number
  message: string
}

// ===== Agent 发送输入 =====

/**
 * Agent 发送消息的输入参数
 */
export interface AgentSendInput {
  /** 会话 ID */
  sessionId: string
  /** 用户消息内容 */
  userMessage: string
  /** 隐身模式：跳过记忆写入（Agent 仍可读取已有记忆） */
  incognito?: boolean
  /** 结构化附件（持久化与 UI 展示使用） */
  attachments?: FileAttachment[]
  /** 渠道 ID（用于获取 API Key） */
  channelId: string
  /** 覆盖本次运行使用的渠道 base URL（网关转发等特殊场景） */
  channelBaseUrlOverride?: string
  /** 覆盖本次运行使用的渠道 API Key（网关转发等特殊场景） */
  channelApiKeyOverride?: string
  /** 模型 ID */
  modelId?: string
  /** 项目目录绝对路径（统一 Session 主链路） */
  projectPath?: string
  /** 项目 profile ID（统一 Session 主链路） */
  projectProfileId?: string
  /** 附加的外部目录（绝对路径，传递给 SDK additionalDirectories） */
  additionalDirectories?: string[]
  /** 动态注入的 MCP 服务器（仅在本次会话中生效，如飞书群聊工具） */
  customMcpServers?: Record<string, Record<string, unknown>>
  /** 本次消息的统一思考等级（优先于全局默认） */
  thinkingLevel?: ThinkingLevel
  /** 限制喂给 Agent 的历史轮数 */
  historyTurns?: number | 'infinite'
  /** 本次消息允许的工具白名单 */
  enabledToolIds?: string[]
  /** 覆盖本次消息的系统提示词 */
  systemMessage?: string
  /** 会话级覆盖的自定义 prompt ID（优先于全局 activePromptId） */
  systemPromptId?: string | null
  /** 强制覆盖权限模式（飞书等无 UI 交互场景下强制 'auto'） */
  permissionModeOverride?: KilaPermissionMode
  /** 用户通过 /skill:xxx 引用的 Skill mention 标识列表（兼容 plain slug 与 source:slug） */
  mentionedSkills?: string[]
  /** 用户通过 #mcp:xxx 引用的 MCP 服务器名称列表 */
  mentionedMcpServers?: string[]
  /** 单次 Agent runtime 的可选资源上限；缺省时不施加额外限制。 */
  runLimits?: AgentRunLimits
  /** 是否在 Agent runtime 内自动生成标题 */
  autoGenerateTitle?: boolean
  /** 消息来源（缺省视为 manual） */
  messageSource?: 'manual' | 'scheduled-task' | 'im-bridge'
  /** 消息来源展示标签 */
  messageSourceLabel?: string
  /** 关联定时任务 ID */
  relatedTaskId?: string
}

// ===== 后台任务管理 =====

/**
 * 获取任务输出请求
 */
export interface GetTaskOutputInput {
  /** 任务 ID */
  taskId: string
  /** 是否阻塞等待完成（默认 false） */
  block?: boolean
}

/**
 * 获取任务输出响应
 */
export interface GetTaskOutputResult {
  /** 任务输出内容 */
  output: string
  /** 任务是否已完成 */
  isComplete: boolean
  /** 主进程任务状态（兼容旧调用方时可缺省） */
  status?: 'running' | 'completed' | 'failed' | 'stopped'
  /** 任务开始时间戳 */
  startedAt?: number
  /** 任务结束时间戳 */
  endedAt?: number
  /** 进程退出码 */
  exitCode?: number | null
}

/**
 * 停止任务请求
 */
export interface StopTaskInput {
  /** 会话 ID */
  sessionId: string
  /** 任务 ID */
  taskId: string
  /** 任务类型 */
  type: 'agent' | 'shell'
}

// ===== Agent 流式事件载荷 =====

/**
 * Agent 流式事件（主进程 → 渲染进程推送）
 */
export interface AgentStreamEvent {
  /** 会话 ID */
  sessionId: string
  /** 事件数据 */
  event: AgentEvent
}

/**
 * Agent 流式完成事件载荷（主进程 → 渲染进程）
 * 包含已持久化的消息列表，避免异步重新加载的竞态窗口。
 */
export type AgentRunOutcome = 'success' | 'stopped' | 'error'

export interface AgentStreamCompletePayload {
  sessionId: string
  /** 终态结果；旧发送方缺失时按 success 兼容。 */
  outcome?: AgentRunOutcome
  /** 已持久化的完整消息列表 */
  messages?: AgentMessage[]
}

// ===== 文件浏览器 =====

/** 文件/目录条目（用于文件浏览器树形视图） */
export interface FileEntry {
  /** 文件/目录名称 */
  name: string
  /** 完整路径 */
  path: string
  /** 是否为目录 */
  isDirectory: boolean
  /** 子条目（懒加载，仅目录展开时填充） */
  children?: FileEntry[]
}

/** 文件索引条目（用于 @ 引用搜索） */
export interface FileIndexEntry {
  /** 文件/目录名称 */
  name: string
  /** 相对于工作区的路径 */
  path: string
  /** 条目类型 */
  type: 'file' | 'dir'
}

/** 文件搜索结果 */
export interface FileSearchResult {
  entries: FileIndexEntry[]
  total: number
}

// ===== Agent 附件 =====

/** Agent 待发送文件（UI 侧暂存） */
export interface AgentPendingFile {
  id: string
  filename: string
  size: number
  mediaType: string
  /** 图片预览 URL（blob/data URL） */
  previewUrl?: string
}

/** Agent 文件保存到 session 的输入 */
export interface AgentSaveFilesInput {
  workspaceSlug: string
  sessionId: string
  files: Array<{ filename: string; data: string }>
}

/** Agent 已保存文件信息 */
export interface AgentSavedFile {
  filename: string
  targetPath: string
}

/** Agent 文件保存到工作区文件目录的输入 */
export interface AgentSaveWorkspaceFilesInput {
  workspaceSlug: string
  files: Array<{ filename: string; data: string }>
}

/** 附加/分离目录的输入参数 */
export interface AgentAttachDirectoryInput {
  /** 会话 ID */
  sessionId: string
  /** 目录的绝对路径 */
  directoryPath: string
}

/** 工作区级附加/分离目录的输入参数 */
export interface WorkspaceAttachDirectoryInput {
  /** 工作区 slug */
  workspaceSlug: string
  /** 目录的绝对路径 */
  directoryPath: string
}

// ===== AskUserQuestion 交互式问答类型 =====

/** AskUserQuestion 工具的选项定义 */
export interface AskUserQuestionOption {
  /** 选项显示文本 */
  label: string
  /** 选项说明 */
  description?: string
}

/** AskUserQuestion 工具的问题定义 */
export interface AskUserQuestion {
  /** 问题内容 */
  question: string
  /** 短标签（chip 显示） */
  header?: string
  /** 可选项列表 */
  options: AskUserQuestionOption[]
  /** 是否支持多选 */
  multiSelect?: boolean
}

/** AskUser 请求（主进程 → 渲染进程） */
export interface AskUserRequest {
  /** 请求唯一 ID */
  requestId: string
  /** 会话 ID */
  sessionId: string
  /** 请求创建时间 */
  createdAt: number
  /** 请求自动过期时间 */
  expiresAt: number
  /** 问题列表 */
  questions: AskUserQuestion[]
  /** 工具原始输入（用于构建 updatedInput） */
  toolInput: Record<string, unknown>
}

/** AskUser 响应（渲染进程 → 主进程） */
export interface AskUserResponse {
  /** 请求 ID */
  requestId: string
  /** 用户答案（问题索引字符串 → 答案文本） */
  answers: Record<string, string>
}

// ===== 权限系统类型 =====

/** Kila 权限模式 */
export type KilaPermissionMode = 'auto' | 'smart'

/** 权限模式定义顺序（用于循环切换） */
export const KILA_PERMISSION_MODE_ORDER: readonly KilaPermissionMode[] = ['auto', 'smart']

/** 危险等级 */
export type DangerLevel = 'safe' | 'normal' | 'dangerous'

/** 权限请求（主进程 → 渲染进程） */
export interface PermissionRequest {
  /** 请求唯一 ID */
  requestId: string
  /** 会话 ID */
  sessionId: string
  /** 请求创建时间 */
  createdAt: number
  /** 请求自动过期时间 */
  expiresAt: number
  /** 工具名称 */
  toolName: string
  /** 工具输入参数 */
  toolInput: Record<string, unknown>
  /** 操作描述（人类可读） */
  description: string
  /** 具体命令（Bash 工具时有值） */
  command?: string
  /** 危险等级 */
  dangerLevel: DangerLevel
  /** Bash 风险分数（0-100，Bash 工具时有值） */
  riskScore?: number
  /** Bash 风险原因（Bash 工具时有值） */
  riskReasons?: string[]
  /** SDK 提供的原因说明 */
  decisionReason?: string
}

/** 权限响应（渲染进程 → 主进程） */
export interface PermissionResponse {
  requestId: string
  behavior: 'allow' | 'deny'
  /** 是否记住选择（加入会话白名单） */
  alwaysAllow: boolean
}

// ===== IPC 通道常量 =====

/**
 * Agent 相关 IPC 通道常量
 */
export const AGENT_IPC_CHANNELS = {
  // 会话管理
  /** 获取会话列表 */
  LIST_SESSIONS: 'agent:list-sessions',
  /** 创建会话 */
  CREATE_SESSION: 'agent:create-session',
  /** 获取会话消息 */
  GET_MESSAGES: 'agent:get-messages',
  /** 更新会话标题 */
  UPDATE_TITLE: 'agent:update-title',
  /** 删除会话 */
  DELETE_SESSION: 'agent:delete-session',
  /** 切换会话置顶状态 */
  TOGGLE_PIN: 'agent:toggle-pin',

  // 工作区管理
  /** 获取工作区列表 */
  LIST_WORKSPACES: 'agent:list-workspaces',
  /** 创建工作区 */
  CREATE_WORKSPACE: 'agent:create-workspace',
  /** 更新工作区 */
  UPDATE_WORKSPACE: 'agent:update-workspace',
  /** 删除工作区 */
  DELETE_WORKSPACE: 'agent:delete-workspace',

  // 标题生成
  /** 生成 Agent 会话标题 */
  GENERATE_TITLE: 'agent:generate-title',

  // 消息发送
  /** 发送消息（触发 Agent 流式响应） */
  SEND_MESSAGE: 'agent:send-message',
  /** 中止 Agent 执行 */
  STOP_AGENT: 'agent:stop',

  // 后台任务管理
  /** 获取任务输出 */
  GET_TASK_OUTPUT: 'agent:get-task-output',
  /** 停止任务 */
  STOP_TASK: 'agent:stop-task',

  // 工作区能力（MCP + Skill）
  /** 获取工作区能力摘要 */
  GET_CAPABILITIES: 'agent:get-capabilities',
  /** 获取工作区 MCP 配置 */
  GET_MCP_CONFIG: 'agent:get-mcp-config',
  /** 保存工作区 MCP 配置 */
  SAVE_MCP_CONFIG: 'agent:save-mcp-config',
  /** 测试 MCP 服务器连接 */
  TEST_MCP_SERVER: 'agent:test-mcp-server',
  /** 获取工作区 Skill 列表 */
  GET_SKILLS: 'agent:get-skills',
  /** 获取工作区 Skills 目录绝对路径 */
  GET_SKILLS_DIR: 'agent:get-skills-dir',
  /** 删除工作区 Skill */
  DELETE_SKILL: 'agent:delete-skill',
  /** 切换工作区 Skill 启用/禁用 */
  TOGGLE_SKILL: 'agent:toggle-skill',

  // 全局 Agent 配置（MCP + Skill）
  /** 获取全局能力摘要 */
  GET_GLOBAL_CAPABILITIES: 'agent:get-global-capabilities',
  /** 获取全局 MCP 配置 */
  GET_GLOBAL_MCP_CONFIG: 'agent:get-global-mcp-config',
  /** 保存全局 MCP 配置 */
  SAVE_GLOBAL_MCP_CONFIG: 'agent:save-global-mcp-config',
  /** 获取全局 MCP 配置文件路径 */
  GET_GLOBAL_MCP_PATH: 'agent:get-global-mcp-path',
  /** 获取全局 Skill 列表 */
  GET_GLOBAL_SKILLS: 'agent:get-global-skills',
  /** 获取全局 Skill 详情 */
  GET_GLOBAL_SKILL_DETAIL: 'agent:get-global-skill-detail',
  /** 获取全局 Skills 目录 */
  GET_GLOBAL_SKILLS_DIR: 'agent:get-global-skills-dir',
  /** 从 GitHub 安装全局 Skill */
  INSTALL_GLOBAL_SKILL: 'agent:install-global-skill',
  /** 更新带来源锁的全局 Skill */
  UPDATE_GLOBAL_SKILL: 'agent:update-global-skill',
  /** 删除全局 Skill */
  DELETE_GLOBAL_SKILL: 'agent:delete-global-skill',
  /** 切换全局 Skill 启用/禁用 */
  TOGGLE_GLOBAL_SKILL: 'agent:toggle-global-skill',
  /** 用系统默认应用打开全局 Agent 配置路径 */
  OPEN_GLOBAL_PATH: 'agent:open-global-path',

  // 流式事件（主进程 → 渲染进程推送）
  /** Agent 流式事件 */
  STREAM_EVENT: 'agent:stream:event',
  /** Agent 流式完成 */
  STREAM_COMPLETE: 'agent:stream:complete',
  /** Agent 流式错误 */
  STREAM_ERROR: 'agent:stream:error',

  // 附件
  /** 保存文件到 Agent session 工作目录 */
  SAVE_FILES_TO_SESSION: 'agent:save-files-to-session',
  /** 保存文件到工作区文件目录 */
  SAVE_FILES_TO_WORKSPACE: 'agent:save-files-to-workspace',
  /** 获取工作区文件目录路径 */
  GET_WORKSPACE_FILES_PATH: 'agent:get-workspace-files-path',
  /** 打开文件夹选择对话框 */
  OPEN_FOLDER_DIALOG: 'agent:open-folder-dialog',
  /** 附加外部目录到 Agent 会话 */
  ATTACH_DIRECTORY: 'agent:attach-directory',
  /** 移除会话的附加目录 */
  DETACH_DIRECTORY: 'agent:detach-directory',
  /** 附加外部目录到工作区（所有会话共享） */
  ATTACH_WORKSPACE_DIRECTORY: 'agent:attach-workspace-directory',
  /** 移除工作区的附加目录 */
  DETACH_WORKSPACE_DIRECTORY: 'agent:detach-workspace-directory',
  /** 获取工作区附加目录列表 */
  GET_WORKSPACE_DIRECTORIES: 'agent:get-workspace-directories',

  // 文件系统操作
  /** 获取 session 工作路径 */
  GET_SESSION_PATH: 'agent:get-session-path',
  /** 列出目录内容 */
  LIST_DIRECTORY: 'agent:list-directory',
  /** 删除文件/空目录 */
  DELETE_FILE: 'agent:delete-file',
  /** 用系统默认应用打开文件 */
  OPEN_FILE: 'agent:open-file',
  /** 在系统文件管理器中显示文件 */
  SHOW_IN_FOLDER: 'agent:show-in-folder',
  /** 在新窗口中预览文件 */
  PREVIEW_FILE: 'agent:preview-file',
  /** 读取文件内联预览数据 */
  READ_FILE_PREVIEW: 'agent:read-file-preview',
  /** 启动当前会话的本地网页预览服务 */
  START_SESSION_WEB_PREVIEW_SERVER: 'agent:start-session-web-preview-server',
  /** 停止当前会话的本地网页预览服务 */
  STOP_SESSION_WEB_PREVIEW_SERVER: 'agent:stop-session-web-preview-server',
  /** 将 HTML 文件解析为当前会话的本地网页预览地址 */
  RESOLVE_SESSION_HTML_PREVIEW: 'agent:resolve-session-html-preview',
  /** 重命名文件/目录 */
  RENAME_FILE: 'agent:rename-file',
  /** 移动文件/目录到目标目录 */
  MOVE_FILE: 'agent:move-file',
  /** 列出附加目录内容（无工作区路径限制） */
  LIST_ATTACHED_DIRECTORY: 'agent:list-attached-directory',
  /** 用系统默认应用打开附加目录文件（无工作区路径限制） */
  OPEN_ATTACHED_FILE: 'agent:open-attached-file',
  /** 在文件管理器中显示附加目录文件（无工作区路径限制） */
  SHOW_ATTACHED_IN_FOLDER: 'agent:show-attached-in-folder',
  /** 重命名附加目录文件/目录（无工作区路径限制） */
  RENAME_ATTACHED_FILE: 'agent:rename-attached-file',
  /** 移动附加目录文件/目录（无工作区路径限制） */
  MOVE_ATTACHED_FILE: 'agent:move-attached-file',
  /** 搜索工作区文件（用于 @ 引用） */
  SEARCH_WORKSPACE_FILES: 'agent:search-workspace-files',

  // 标题自动生成通知（主进程 → 渲染进程推送）
  /** 标题已更新（首次对话完成后自动生成） */
  TITLE_UPDATED: 'agent:title-updated',

  // Agent 配置变化通知（主进程 → 渲染进程推送）
  /** Agent 能力变化（全局 Agent 配置或 legacy workspace 监听触发） */
  CAPABILITIES_CHANGED: 'agent:capabilities-changed',
  /** 工作区文件变化（session 目录文件监听触发，用于文件浏览器刷新） */
  WORKSPACE_FILES_CHANGED: 'agent:workspace-files-changed',

  // 权限系统
  /** 权限响应（渲染进程 → 主进程） */
  PERMISSION_RESPOND: 'agent:permission:respond',

  // AskUserQuestion 交互式问答
  /** AskUser 响应（渲染进程 → 主进程） */
  ASK_USER_RESPOND: 'agent:ask-user:respond',

} as const

// ===== Cua Driver（Computer Use） =====

/** Cua Driver 安装状态 */
export type CuaDriverInstallStatus = 'not-installed' | 'installed' | 'unknown'

/** Cua Driver 运行时状态 */
export interface CuaDriverStatus {
  /** 是否已在 MCP 配置中注册 */
  registered: boolean
  /** 是否已启用 */
  enabled: boolean
  /** 安装状态 */
  installStatus: CuaDriverInstallStatus
  /** 检测到的二进制路径（空字符串 = 未找到） */
  binaryPath: string
  /** 检测到的版本（空字符串 = 未知） */
  version: string
  /** 最后一次检测时间 */
  lastCheckedAt: number
  /** 当前平台 */
  platform: 'macos' | 'windows' | 'linux'
}

/** Cua Driver 检测结果 */
export interface CuaDriverDetectResult {
  found: boolean
  binaryPath: string
  version: string
}

/** Cua Driver 安装结果 */
export interface CuaDriverInstallResult {
  success: boolean
  message: string
  binaryPath?: string
  version?: string
}

/** Cua Driver IPC 通道 */
export const CUA_DRIVER_IPC_CHANNELS = {
  /** 获取 Cua Driver 状态 */
  GET_STATUS: 'cua-driver:get-status',
  /** 检测本地安装 */
  DETECT: 'cua-driver:detect',
  /** 安装 Cua Driver */
  INSTALL: 'cua-driver:install',
  /** 启用/禁用 Cua Driver */
  TOGGLE: 'cua-driver:toggle',
  /** 测试 Cua Driver 连接 */
  TEST: 'cua-driver:test',
} as const
