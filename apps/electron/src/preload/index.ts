/**
 * Preload 脚本
 *
 * 通过 contextBridge 安全地将 API 暴露给渲染进程
 * 使用上下文隔离确保安全性
 */

import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, CHANNEL_IPC_CHANNELS, AGENT_IPC_CHANNELS, SESSION_IPC_CHANNELS, SESSION_BOARD_IPC_CHANNELS, ENVIRONMENT_IPC_CHANNELS, INSTALLER_IPC_CHANNELS, PROXY_IPC_CHANNELS, GITHUB_RELEASE_IPC_CHANNELS, PERSONALITY_IPC_CHANNELS, AGENT_TOOL_IPC_CHANNELS, FEISHU_BRIDGE_IPC_CHANNELS, IM_BRIDGE_IPC_CHANNELS, WECHAT_BRIDGE_IPC_CHANNELS, TOKEN_USAGE_IPC_CHANNELS, SCHEDULED_TASK_IPC_CHANNELS, SYSTEM_PROMPT_IPC_CHANNELS, CUA_DRIVER_IPC_CHANNELS, THEME_IPC_CHANNELS } from '@kila/shared/ipc'
import type { IpcResult } from '@kila/shared/ipc'
import { USER_PROFILE_IPC_CHANNELS, SETTINGS_IPC_CHANNELS, SETTINGS_TABS } from '../types'
import type {
  RuntimeStatus,
  GitRepoStatus,
  GitChangesSnapshot,
  GitDiffInput,
  GitDiffResult,
  GitHunkActionInput,
  GitFileActionInput,
  GitCommitInput,
  GitCommitResult,
  GitWorktreeCreateInput,
  GitWorktreeEntry,
  GitWorktreeRemoveInput,
  Channel,
  ChannelCreateInput,
  ChannelUpdateInput,
  ChannelTestResult,
  ChannelTestInput,
  ProviderDoctorInput,
  FetchModelsInput,
  FetchModelsResult,
  FileDialogResult,
  AgentSavedFile,
  AgentAttachDirectoryInput,
  GlobalSkillEntry,
  GlobalSkillDetail,
  GlobalSkillInstallInput,
  GlobalSkillInstallResult,
  WorkspaceAttachDirectoryInput,
  GetTaskOutputInput,
  GetTaskOutputResult,
  StopTaskInput,
  WorkspaceMcpConfig,
  WorkspaceCapabilities,
  FileEntry,
  FileSearchResult,
  EnvironmentCheckResult,
  InstallerDownloadRequest,
  InstallerDownloadResult,
  InstallerManifest,
  InstallerProgressPayload,
  ProxyConfig,
  SystemProxyDetectResult,
  GitHubRelease,
  GitHubReleaseListOptions,
  PermissionResponse,
  AskUserResponse,
  PersonalityState,
  PersonalityDocument,
  PersonalityDocKind,
  PersonalityUpdateInput,
  CustomSystemPrompt,
  SystemPromptState,
  CustomSystemPromptCreateInput,
  CustomSystemPromptUpdateInput,
  AgentToolInfo,
  AgentToolState,
  AgentToolMeta,
  BridgeBinding,
  BridgeBindingUpdateInput,
  BridgeConfig,
  BridgeConfigInput,
  BridgeStatus,
  BridgeTestResult,
  BridgeChannelType,
  FeishuBotConfig,
  FeishuBotConfigInput,
  FeishuMultiBridgeStatus,
  FeishuRegisterAppQRCode,
  FeishuRegisterAppResult,
  FeishuRegisterAppStatus,
  WeChatBridgeAccountEntry,
  WeChatBridgeAccountStatus,
  WeChatBridgeLoginState,
  WeChatBridgeStartLoginInput,
  InlineFilePreview,
  SessionHtmlPreviewResolution,
  SessionCreateInput,
  GenerateSuggestionsResult,
  SessionBranchComparison,
  SessionBranchFromMessageInput,
  SessionEditTurnInput,
  SessionExportInput,
  SessionExportResult,
  SessionImportInput,
  SessionImportResult,
  SessionMessage,
  SessionMeta,
  SessionMetaUpdates,
  SessionMessagesPageInput,
  SessionMessagesPageResult,
  SessionProjectFilesSaveInput,
  SessionRegenerateTurnInput,
  SessionRewindInput,
  SessionRecentMessagesResult,
  SessionSearchInput,
  SessionSearchResults,
  SessionSendInput,
  SessionStreamCompletePayload,
  SessionStreamErrorPayload,
  SessionStreamEvent,
  SessionTitleUpdatedPayload,
  SessionUpdatedPayload,
  SessionWebPreviewServerInfo,
  McpServerEntry,
  PinSessionWidgetInput,
  SessionPinnedWidget,
  TokenUsageStats,
  CuaDriverStatus,
  CuaDriverDetectResult,
  CuaDriverInstallResult,
  ProviderDbModel,
  ProviderDbProvider,
  ThemeCatalog,
  ThemeDefinition,
  ThemeImportResult,
  ThemeMutationResult,
} from '@kila/shared'
import type { UserProfile, AppSettings } from '../types'
import type { OpenSessionInMainWindowInput, SettingsTab, WindowContext, WindowMode } from '../types'
import type { DesktopNotificationInput } from '../types'
import { invoke } from './invoke'
import { createRuntimeApi } from './api/runtime-api'
import type { RuntimePreloadApi } from './api/runtime-api'
import { createGitApi } from './api/git-api'
import type { GitPreloadApi } from './api/git-api'
import { createScheduledApi } from './api/scheduled-api'
import type { ScheduledPreloadApi } from './api/scheduled-api'
import { createQuickTaskApi } from './api/quick-task-api'
import type { QuickTaskPreloadApi } from './api/quick-task-api'

function parseWindowContext(): WindowContext {
  const params = new URLSearchParams(window.location.search)
  const modeParam = params.get('window')
  const tabParam = params.get('tab')

  const mode: WindowMode = modeParam === 'settings'
    ? 'settings'
    : modeParam === 'quick-task'
      ? 'quick-task'
      : 'main'
  const settingsTab = SETTINGS_TABS.includes(tabParam as SettingsTab)
    ? (tabParam as SettingsTab)
    : null

  return { mode, settingsTab }
}

/**
 * 暴露给渲染进程的 API 接口定义
 */
export interface ElectronAPI extends RuntimePreloadApi, GitPreloadApi, ScheduledPreloadApi, QuickTaskPreloadApi {
  // ===== 通用工具 =====


  /** 在系统默认浏览器中打开外部链接 */
  openExternal: (url: string) => Promise<void>


  // ===== 渠道管理相关 =====

  /** 获取所有渠道列表（apiKey 保持加密态） */
  listChannels: () => Promise<Channel[]>

  /** 创建渠道（apiKey 为明文，主进程加密） */
  createChannel: (input: ChannelCreateInput) => Promise<Channel>

  /** 更新渠道 */
  updateChannel: (id: string, input: ChannelUpdateInput) => Promise<Channel>

  /** 删除渠道 */
  deleteChannel: (id: string) => Promise<void>

  /** 解密获取明文 API Key（仅在用户查看时调用） */
  decryptApiKey: (channelId: string) => Promise<string>

  /** 测试渠道连接 */
  testChannel: (input: ProviderDoctorInput) => Promise<ChannelTestResult>

  /** 直接测试连接（无需已保存渠道，传入明文凭证） */
  testChannelDirect: (input: ChannelTestInput) => Promise<ChannelTestResult>

  /** 从供应商拉取可用模型列表（直接传入凭证，无需已保存渠道） */
  fetchModels: (input: FetchModelsInput) => Promise<FetchModelsResult>

  /** 列出 Provider DB 摘要（用于预设页动态渲染） */
  listProviderDbSummaries: () => Promise<Array<{
    id: string
    name?: string
    displayName?: string
    api?: string
    doc?: string
    description?: string
    tags?: string[]
    modelCount: number
  }>>

  /** 按 providerId 查 Provider DB 详情 */
  lookupProviderDb: (providerId: string) => Promise<ProviderDbProvider | null>

  /** 跨 provider 全局搜模型 */
  findProviderDbModel: (modelId: string) => Promise<{ provider: ProviderDbProvider; model: ProviderDbModel } | null>

  // ===== 统一 Session 管理相关 =====

  /** 获取统一 Session 列表 */
  listSessions: () => Promise<SessionMeta[]>

  /** 创建统一 Session */
  createSession: (input?: SessionCreateInput) => Promise<SessionMeta>

  /** 获取统一 Session 消息 */
  getSessionMessages: (id: string) => Promise<SessionMessage[]>

  /** 获取统一 Session 最近 N 条消息 */
  getRecentSessionMessages: (id: string, limit: number) => Promise<SessionRecentMessagesResult>

  /** 获取统一 Session 分页消息 */
  getSessionMessagesPage: (input: SessionMessagesPageInput) => Promise<SessionMessagesPageResult>

  /** 同步当前可见 Session 的项目目录监听（最多 4 个分屏） */
  setActiveSessionProjectWatches: (sessionIds: string[]) => Promise<void>

  /** 搜索统一 Session 标题、项目与消息 */
  searchSessions: (input: SessionSearchInput) => Promise<SessionSearchResults>

  /** 导出统一 Session bundle */
  exportSession: (input: SessionExportInput) => Promise<SessionExportResult>

  /** 导入统一 Session bundle */
  importSession: (input?: SessionImportInput) => Promise<SessionImportResult>

  /** 更新统一 Session 元数据 */
  updateSessionMeta: (id: string, updates: SessionMetaUpdates) => Promise<SessionMeta>

  /** 更新统一 Session 标题 */
  updateSessionTitle: (id: string, title: string) => Promise<SessionMeta>

  /** 重新生成统一 Session 标题 */
  generateSessionTitle: (sessionId: string) => Promise<string | null>

  /** 生成会话快捷建议 */
  generateSuggestions: () => Promise<GenerateSuggestionsResult>

  /** 删除统一 Session */
  deleteSession: (id: string) => Promise<void>

  /** 切换统一 Session 置顶状态 */
  togglePinSession: (id: string) => Promise<SessionMeta>

  /** 更新会话项目目录 */
  updateSessionProject: (sessionId: string, projectPath: string) => Promise<SessionMeta>

  /** 发送统一 Session 消息 */
  sendSessionMessage: (input: SessionSendInput) => Promise<void>

  /** 原地重生某条助手回复所属 turn */
  regenerateSessionTurn: (input: SessionRegenerateTurnInput) => Promise<void>

  /** 截断会话到指定消息，不自动重新发送 */
  rewindSession: (input: SessionRewindInput) => Promise<SessionMessage[]>

  /** 编辑已发送用户消息并从该 turn 重新执行 */
  editSessionTurn: (input: SessionEditTurnInput) => Promise<void>

  /** 从指定消息创建分叉会话 */
  branchSessionFromMessage: (input: SessionBranchFromMessageInput) => Promise<SessionMeta>
  /** 比较分叉会话与父会话的消息差异 */
  compareSessionBranch: (sessionId: string) => Promise<SessionBranchComparison>

  /** 停止统一 Session 当前运行时 */
  stopSession: (sessionId: string) => Promise<void>

  /** 保存文件到会话项目目录 */
  saveFilesToSessionProject: (input: SessionProjectFilesSaveInput) => Promise<AgentSavedFile[]>

  /** 获取当前会话固定的 widgets */
  listSessionPinnedWidgets: (sessionId: string) => Promise<SessionPinnedWidget[]>

  /** 固定 transcript widget 到当前会话 board */
  pinSessionWidget: (input: PinSessionWidgetInput) => Promise<SessionPinnedWidget>

  /** 从当前会话 board 移除固定 widget */
  unpinSessionWidget: (sessionId: string, pinId: string) => Promise<void>

  /** 测试 MCP 连接 */
  testMcpServer: (name: string, entry: McpServerEntry) => Promise<{ success: boolean; message: string }>

  /** 获取全局 Agent 能力摘要 */
  getGlobalAgentCapabilities: () => Promise<WorkspaceCapabilities>

  /** 获取全局 MCP 配置 */
  getGlobalAgentMcpConfig: () => Promise<WorkspaceMcpConfig>

  /** 保存全局 MCP 配置 */
  saveGlobalAgentMcpConfig: (config: WorkspaceMcpConfig) => Promise<void>

  /** 获取全局 MCP 配置文件路径 */
  getGlobalAgentMcpPath: () => Promise<string>

  /** 获取全局 Skills / Plugins 能力库列表 */
  getGlobalAgentSkills: () => Promise<GlobalSkillEntry[]>

  /** 获取单个全局能力条目详情 */
  getGlobalAgentSkillDetail: (skillId: string) => Promise<GlobalSkillDetail>

  /** 获取全局 Skills 目录 */
  getGlobalAgentSkillsDir: () => Promise<string>

  /** 安装全局 Skill */
  installGlobalAgentSkill: (input: GlobalSkillInstallInput) => Promise<GlobalSkillInstallResult>

  /** 更新带来源锁的全局 Skill */
  updateGlobalAgentSkill: (skillSlug: string) => Promise<GlobalSkillInstallResult>

  /** 删除全局 Skill */
  deleteGlobalAgentSkill: (skillSlug: string) => Promise<void>

  /** 切换全局 Skill 启用状态 */
  toggleGlobalAgentSkill: (skillSlug: string, enabled: boolean) => Promise<void>

  /** 打开全局 Agent 配置路径 */
  openGlobalAgentPath: (filePath: string) => Promise<void>

  /** 订阅统一 Session 流式事件 */
  onSessionStreamEvent: (callback: (event: SessionStreamEvent) => void) => () => void

  /** 订阅统一 Session 流式完成事件 */
  onSessionStreamComplete: (callback: (event: SessionStreamCompletePayload) => void) => () => void

  /** 订阅统一 Session 流式错误事件 */
  onSessionStreamError: (callback: (event: SessionStreamErrorPayload) => void) => () => void

  /** 订阅统一 Session 标题更新事件 */
  onSessionTitleUpdated: (callback: (event: SessionTitleUpdatedPayload) => void) => () => void

  /** 订阅统一 Session 元数据更新事件 */
  onSessionUpdated: (callback: (event: SessionUpdatedPayload) => void) => () => void

  /** 读取文件内联预览数据 */
  readFilePreview: (filePath: string) => Promise<InlineFilePreview>

  /** 启动当前会话的网页预览服务 */
  startSessionWebPreviewServer: (sessionId: string) => Promise<SessionWebPreviewServerInfo>

  /** 停止当前会话的网页预览服务 */
  stopSessionWebPreviewServer: (sessionId: string) => Promise<void>

  /** 将 HTML 文件解析为当前会话的网页预览地址 */
  resolveSessionHtmlPreview: (sessionId: string, filePath: string) => Promise<SessionHtmlPreviewResolution>

    // ===== 附件管理相关 =====

  /** 读取附件（返回 base64 字符串） */
  readAttachment: (localPath: string) => Promise<string>

  /** 另存图片到用户选择的位置（原生 Save As 对话框） */
  saveImageAs: (localPath: string, defaultFilename: string) => Promise<boolean>

  /** 打开文件选择对话框 */
  openFileDialog: () => Promise<FileDialogResult>

  // ===== 用户档案相关 =====

  /** 获取用户档案 */
  getUserProfile: () => Promise<UserProfile>

  /** 更新用户档案 */
  updateUserProfile: (updates: Partial<UserProfile>) => Promise<UserProfile>

  /** 监听用户档案变更（跨窗口同步） */
  onUserProfileChanged: (callback: (profile: UserProfile) => void) => () => void

  // ===== 应用设置相关 =====

  /** 获取应用设置 */
  getSettings: () => Promise<AppSettings>

  /** 更新应用设置 */
  updateSettings: (updates: Partial<AppSettings>) => Promise<AppSettings>

  /** 发送原生桌面通知 */
  showDesktopNotification: (input: DesktopNotificationInput) => Promise<boolean>

  /** 获取内置与自定义主题目录 */
  listThemes: () => Promise<ThemeCatalog>

  /** 创建自定义主题 */
  createTheme: (theme: ThemeDefinition) => Promise<ThemeMutationResult>

  /** 更新自定义主题 */
  updateTheme: (themeId: string, theme: ThemeDefinition) => Promise<ThemeMutationResult>

  /** 删除自定义主题 */
  deleteTheme: (themeId: string) => Promise<ThemeCatalog>

  /** 从本地 JSON 文件导入主题 */
  importTheme: () => Promise<ThemeImportResult>

  /** 导出自定义主题 */
  exportTheme: (themeId: string) => Promise<boolean>

  /** 打开本地主题目录 */
  openThemesDirectory: () => Promise<void>

  /** 监听主题目录变化 */
  onThemesChanged: (callback: (catalog: ThemeCatalog) => void) => () => void

  /** 获取记忆后端状态 */
  getMemoryStatus: () => Promise<{
    mode: 'local' | 'nowledge'
    activeProvider: 'local' | 'nowledge'
    localReady: boolean
    memoryDirectory: string
    nowledgeEnabled: boolean
    nowledgeConfigured: boolean
    nowledgeHealthy: boolean
    nowledgeBackendVersion?: string
    checkedAt: number
    detail?: string
  }>

  /** 获取已有记忆列表 */
  listMemories: (input?: { limit?: number; offset?: number; projectPath?: string }) => Promise<Array<{
    uri: string
    title?: string
    content: string
    category: string
    tags: string[]
    projectPath?: string
    updatedAt: number
  }>>

  /** 检测重复长期记忆 */
  listDuplicateMemories: (input?: { limit?: number }) => Promise<Array<{
    signature: string
    reason: string
    items: Array<{
      uri: string
      title?: string
      content: string
      category: string
      tags: string[]
      projectPath?: string
      updatedAt: number
    }>
  }>>

  /** 合并重复长期记忆 */
  mergeDuplicateMemories: (input: { primaryUri: string; duplicateUris: string[] }) => Promise<{
    uri: string
    title?: string
    content: string
    category: string
    tags: string[]
    projectPath?: string
    updatedAt: number
  } | null>

  /** 删除长期记忆 */
  forgetMemory: (uri: string) => Promise<boolean>

  /** 获取记忆调试状态（结构直接复用 IPC 契约，避免 Preload 与主进程各写一份） */
  getMemoryDebug: (input?: { sessionId?: string; projectPath?: string }) => Promise<IpcResult<'memory:get-debug'>>

  /** 检测本地 Nowledge */
  detectLocalNowledge: () => Promise<{
    found: boolean
    source: 'config' | 'probe' | 'none'
    baseUrl?: string
    apiKey?: string
    apiKeyFound: boolean
    nowledgeBackendVersion?: string
    detail: string
  }>

  /** 获取记忆系统产出的用户画像建议 */
  getMemoryImpression: () => Promise<{
    content?: string
    updatedAt?: number
  }>

  /** 订阅应用设置变化事件（返回清理函数） */
  onSettingsChanged: (callback: (settings: AppSettings) => void) => () => void

  /** 获取系统主题（是否深色模式） */
  getSystemTheme: () => Promise<boolean>

  /** 订阅系统主题变化事件（返回清理函数） */
  onSystemThemeChanged: (callback: (isDark: boolean) => void) => () => void

  /** 打开独立设置窗口 */
  openSettingsWindow: (tab?: SettingsTab) => Promise<void>

  /** 获取当前渲染窗口模式 */
  getWindowMode: () => WindowMode

  /** 获取当前渲染窗口上下文 */
  getWindowContext: () => WindowContext

  /** 订阅设置窗口内的 tab 导航请求 */
  onSettingsNavigate: (callback: (tab: SettingsTab) => void) => () => void

  /** 获取主窗口当前前台会话 */
  getForegroundSession: () => Promise<SessionMeta | null>

  /** 上报主窗口当前前台会话 */
  setForegroundSession: (sessionId: string | null) => Promise<void>

  /** 请求主窗口打开会话并注入配置 prompt */
  openSessionInMainWindow: (input: OpenSessionInMainWindowInput) => Promise<void>

  /** 订阅主窗口会话打开请求 */
  onOpenSessionInMainWindow: (callback: (input: OpenSessionInMainWindowInput) => void) => () => void

  // ===== 环境检测相关 =====

  /** 执行环境检测 */
  checkEnvironment: () => Promise<EnvironmentCheckResult>

  // ===== 安装器相关 =====

  /** 获取安装包清单 */
  fetchInstallerManifest: () => Promise<InstallerManifest>
  /** 下载安装包 */
  downloadInstaller: (req: InstallerDownloadRequest) => Promise<InstallerDownloadResult>
  /** 取消下载 */
  cancelInstallerDownload: (key: string) => Promise<boolean>
  /** 拉起安装程序 */
  launchInstaller: (filePath: string) => Promise<void>
  /** 安装进度监听 */
  onInstallerProgress: (callback: (payload: InstallerProgressPayload) => void) => () => void
  /** 重新检测运行时 */
  reinitRuntime: () => Promise<import('@kila/shared').RuntimeStatus>

  // ===== 代理配置相关 =====

  /** 获取代理配置 */
  getProxySettings: () => Promise<ProxyConfig>

  /** 更新代理配置 */
  updateProxySettings: (config: ProxyConfig) => Promise<void>

  /** 检测系统代理 */
  detectSystemProxy: () => Promise<SystemProxyDetectResult>

  // ===== Agent 后台任务管理 =====

  /** 获取任务输出 */
  getTaskOutput: (input: GetTaskOutputInput) => Promise<GetTaskOutputResult>

  /** 停止任务 */
  stopTask: (input: StopTaskInput) => Promise<void>

  // ===== Agent 权限系统 =====

  /** 响应权限请求 */
  respondPermission: (response: PermissionResponse) => Promise<void>

  // ===== Agent 工具管理 =====

  /** 获取所有工具信息 */
  getAgentTools: () => Promise<AgentToolInfo[]>

  /** 获取工具凭据 */
  getAgentToolCredentials: (toolId: string) => Promise<Record<string, string>>

  /** 更新工具开关状态 */
  updateAgentToolState: (toolId: string, state: AgentToolState) => Promise<void>

  /** 更新工具凭据 */
  updateAgentToolCredentials: (toolId: string, credentials: Record<string, string>) => Promise<void>

  /** 创建自定义工具 */
  createCustomAgentTool: (meta: AgentToolMeta) => Promise<void>

  /** 删除自定义工具 */
  deleteCustomAgentTool: (toolId: string) => Promise<void>

  /** 监听自定义工具配置变更 */
  onCustomToolChanged: (callback: () => void) => () => void

  /** 测试工具连接 */
  testAgentTool: (toolId: string) => Promise<{ success: boolean; message: string }>

  // ===== AskUserQuestion 交互式问答 =====

  /** 响应 AskUser 请求 */
  respondAskUser: (response: AskUserResponse) => Promise<void>

  // ===== Agent 附件 / 文件 =====

  /** 打开文件夹选择对话框 */
  openFolderDialog: () => Promise<{ path: string; name: string } | null>

  /** 附加外部目录到 Agent 会话 */
  attachDirectory: (input: AgentAttachDirectoryInput) => Promise<string[]>

  /** 移除会话的附加目录 */
  detachDirectory: (input: AgentAttachDirectoryInput) => Promise<string[]>

  // ===== Agent 文件系统操作 =====

  /** 列出目录内容 */
  listDirectory: (dirPath: string) => Promise<FileEntry[]>

  /** 删除文件/目录 */
  deleteFile: (filePath: string) => Promise<void>

  /** 用系统默认应用打开文件 */
  openFile: (filePath: string) => Promise<void>

  /** 在系统文件管理器中显示文件 */
  showInFolder: (filePath: string) => Promise<void>

  /** 在新窗口中预览文件 */
  previewFile: (filePath: string) => Promise<void>

  /** 重命名文件/目录 */
  renameFile: (filePath: string, newName: string) => Promise<void>

  /** 移动文件/目录到目标目录 */
  moveFile: (filePath: string, targetDir: string) => Promise<void>

  /** 列出附加目录内容（无工作区路径限制） */
  listAttachedDirectory: (dirPath: string) => Promise<FileEntry[]>

  /** 用系统默认应用打开附加目录文件（无工作区路径限制） */
  openAttachedFile: (filePath: string) => Promise<void>

  /** 在文件管理器中显示附加目录文件（无工作区路径限制） */
  showAttachedInFolder: (filePath: string) => Promise<void>

  /** 重命名附加目录文件/目录（无工作区路径限制） */
  renameAttachedFile: (filePath: string, newName: string) => Promise<void>

  /** 移动附加目录文件/目录（无工作区路径限制） */
  moveAttachedFile: (filePath: string, targetDir: string) => Promise<void>

  /** 搜索工作区文件（用于 @ 引用，支持附加目录） */
  searchWorkspaceFiles: (rootPath: string, query: string, limit?: number, additionalPaths?: string[]) => Promise<FileSearchResult>

  // ===== 全局 Personality =====

  /** 获取全局 personality 文件状态 */
  getPersonalityState: () => Promise<PersonalityState>

  /** 更新 personality 文档 */
  updatePersonality: (input: PersonalityUpdateInput) => Promise<PersonalityDocument>

  /** 恢复 personality 文档默认模板 */
  resetPersonality: (kind: PersonalityDocKind) => Promise<PersonalityDocument>

  /** 在系统文件管理器中打开 personality 文档 */
  openPersonalityPath: (kind: PersonalityDocKind) => Promise<void>

  // ===== 自定义 System Prompt =====

  /** 获取自定义 system prompt 状态 */
  getSystemPromptState: () => Promise<SystemPromptState>

  /** 新建自定义 system prompt */
  addSystemPrompt: (input: CustomSystemPromptCreateInput) => Promise<CustomSystemPrompt>

  /** 更新自定义 system prompt */
  updateSystemPrompt: (input: CustomSystemPromptUpdateInput) => Promise<CustomSystemPrompt>

  /** 删除自定义 system prompt */
  deleteSystemPrompt: (id: string) => Promise<void>

  /** 设为激活 prompt */
  setActiveSystemPrompt: (id: string) => Promise<SystemPromptState>

  /** 取消激活 prompt */
  clearActiveSystemPrompt: () => Promise<SystemPromptState>

  /** 获取 token usage 聚合统计 */
  getTokenUsageStats: (days: number) => Promise<TokenUsageStats>

  // ===== 版本检测相关（仅检测，不自动下载/安装） =====

  /** 更新 API */
  updater?: {
    checkForUpdates: () => Promise<void>
    getStatus: () => Promise<{
      status: 'idle' | 'checking' | 'available' | 'not-available' | 'error'
      version?: string
      releaseNotes?: string
      error?: string
    }>
    onStatusChanged: (callback: (status: {
      status: 'idle' | 'checking' | 'available' | 'not-available' | 'error'
      version?: string
      releaseNotes?: string
      error?: string
    }) => void) => () => void
  }

  // GitHub Release
  getLatestRelease: () => Promise<GitHubRelease | null>
  listReleases: (options?: GitHubReleaseListOptions) => Promise<GitHubRelease[]>
  getReleaseByTag: (tag: string) => Promise<GitHubRelease | null>

  // 工作区文件变化通知
  onCapabilitiesChanged: (callback: () => void) => () => void
  onWorkspaceFilesChanged: (callback: () => void) => () => void

  // ===== 字体 =====

  /** 获取系统已安装字体列表 */
  getSystemFonts: () => Promise<string[]>


  // ===== IM Bridge =====

  getBridgeConfig: () => Promise<BridgeConfig>
  saveBridgeConfig: (input: BridgeConfigInput) => Promise<BridgeConfig>
  getBridgeSecret: (channel: BridgeChannelType) => Promise<string>
  testBridgeChannel: (channel: BridgeChannelType, input?: BridgeConfigInput) => Promise<BridgeTestResult>
  startBridge: () => Promise<void>
  stopBridge: () => Promise<void>
  restartBridge: () => Promise<void>
  getBridgeStatus: () => Promise<BridgeStatus>
  listBridgeBindings: () => Promise<BridgeBinding[]>
  updateBridgeBinding: (input: BridgeBindingUpdateInput) => Promise<BridgeBinding | null>
  updateBridgeBindingProjectPath: (endpointKey: string, projectPath: string) => Promise<{ binding: BridgeBinding; sessionReplaced: boolean }>
  removeBridgeBinding: (endpointKey: string) => Promise<boolean>
  onBridgeStatusChanged: (callback: (status: BridgeStatus) => void) => () => void
  listFeishuBridgeBots: () => Promise<FeishuBotConfig[]>
  saveFeishuBridgeBot: (input: FeishuBotConfigInput) => Promise<FeishuBotConfig>
  removeFeishuBridgeBot: (botId: string) => Promise<boolean>
  getFeishuBridgeBotSecret: (botId: string) => Promise<string>
  testFeishuBridgeBot: (botId: string) => Promise<BridgeTestResult>
  startFeishuBridgeBot: (botId: string) => Promise<void>
  stopFeishuBridgeBot: (botId: string) => Promise<void>
  getFeishuBridgeMultiStatus: () => Promise<FeishuMultiBridgeStatus>
  registerFeishuBridgeApp: () => Promise<FeishuRegisterAppResult>
  cancelFeishuBridgeRegistration: () => Promise<void>
  onFeishuBridgeRegisterQrcode: (callback: (payload: FeishuRegisterAppQRCode) => void) => () => void
  onFeishuBridgeRegisterStatus: (callback: (payload: FeishuRegisterAppStatus) => void) => () => void
  onFeishuBridgeMultiStatusChanged: (callback: (status: FeishuMultiBridgeStatus) => void) => () => void
  listWeChatBridgeAccounts: () => Promise<WeChatBridgeAccountEntry[]>
  startWeChatBridgeLogin: (input?: WeChatBridgeStartLoginInput) => Promise<WeChatBridgeLoginState>
  refreshWeChatBridgeLogin: (accountId: string) => Promise<WeChatBridgeLoginState>
  cancelWeChatBridgeLogin: (accountId: string) => Promise<void>
  removeWeChatBridgeAccount: (accountId: string) => Promise<void>
  startWeChatBridgeAccount: (accountId: string) => Promise<WeChatBridgeAccountStatus>
  stopWeChatBridgeAccount: (accountId: string) => Promise<WeChatBridgeAccountStatus>
  reloginWeChatBridgeAccount: (accountId: string) => Promise<WeChatBridgeLoginState>
  getWeChatBridgeLoginState: (accountId: string) => Promise<WeChatBridgeLoginState | null>
  onWeChatBridgeLoginStateChanged: (callback: (state: WeChatBridgeLoginState) => void) => () => void
  onWeChatBridgeAccountStatusChanged: (callback: (status: WeChatBridgeAccountStatus) => void) => () => void

  // ===== Native-feel: 多格式剪贴板 =====

  /** 将纯文本写入系统剪贴板 */
  copyText: (text: string) => Promise<void>
  /** 同时写入纯文本 + HTML 到系统剪贴板 */
  copyRichText: (text: string, html: string) => Promise<void>

  // ===== Cua Driver (Computer Use) =====

  /** 获取 Cua Driver 状态 */
  getCuaDriverStatus: () => Promise<CuaDriverStatus>
  /** 检测本地 cua-driver 安装 */
  detectCuaDriver: () => Promise<CuaDriverDetectResult>
  /** 安装 cua-driver */
  installCuaDriver: () => Promise<CuaDriverInstallResult>
  /** 启用/禁用 cua-driver */
  toggleCuaDriver: (enabled: boolean) => Promise<CuaDriverStatus>
  /** 测试 cua-driver 连接 */
  testCuaDriver: () => Promise<{ success: boolean; message: string }>
}

/**
 * 实现 ElectronAPI 接口
 */
const electronAPI: ElectronAPI = {
  ...createRuntimeApi(),
  ...createGitApi(),
  ...createScheduledApi(),
  ...createQuickTaskApi(),

  // 通用工具
  openExternal: (url: string) => {
    return invoke(IPC_CHANNELS.OPEN_EXTERNAL, url)
  },


  // 渠道管理
  listChannels: () => {
    return invoke(CHANNEL_IPC_CHANNELS.LIST)
  },

  createChannel: (input: ChannelCreateInput) => {
    return invoke(CHANNEL_IPC_CHANNELS.CREATE, input)
  },

  updateChannel: (id: string, input: ChannelUpdateInput) => {
    return invoke(CHANNEL_IPC_CHANNELS.UPDATE, id, input)
  },

  deleteChannel: (id: string) => {
    return invoke(CHANNEL_IPC_CHANNELS.DELETE, id)
  },

  decryptApiKey: (channelId: string) => {
    return invoke(CHANNEL_IPC_CHANNELS.DECRYPT_KEY, channelId)
  },

  testChannel: (input: ProviderDoctorInput) => {
    return invoke(CHANNEL_IPC_CHANNELS.TEST, input)
  },

  testChannelDirect: (input: ChannelTestInput) => {
    return invoke(CHANNEL_IPC_CHANNELS.TEST_DIRECT, input)
  },

  fetchModels: (input: FetchModelsInput) => {
    return invoke(CHANNEL_IPC_CHANNELS.FETCH_MODELS, input)
  },

  // Provider DB（预设页用）
  listProviderDbSummaries: () => {
    return invoke(CHANNEL_IPC_CHANNELS.PROVIDER_DB_LIST)
  },

  lookupProviderDb: (providerId: string) => {
    return invoke(CHANNEL_IPC_CHANNELS.PROVIDER_DB_LOOKUP, providerId)
  },

  findProviderDbModel: (modelId: string) => {
    return invoke(CHANNEL_IPC_CHANNELS.PROVIDER_DB_FIND_MODEL, modelId)
  },

  // 统一 Session 管理
  listSessions: () => {
    return invoke(SESSION_IPC_CHANNELS.LIST_SESSIONS)
  },

  createSession: (input?: SessionCreateInput) => {
    return invoke(SESSION_IPC_CHANNELS.CREATE_SESSION, input)
  },

  getSessionMessages: (id: string) => {
    return invoke(SESSION_IPC_CHANNELS.GET_MESSAGES, id)
  },

  getRecentSessionMessages: (id: string, limit: number) => {
    return invoke(SESSION_IPC_CHANNELS.GET_RECENT_MESSAGES, id, limit)
  },

  getSessionMessagesPage: (input: SessionMessagesPageInput) => {
    return invoke(SESSION_IPC_CHANNELS.GET_MESSAGES_PAGE, input)
  },

  setActiveSessionProjectWatches: (sessionIds: string[]) => {
    return invoke(SESSION_IPC_CHANNELS.SET_ACTIVE_PROJECT_WATCHES, sessionIds)
  },

  searchSessions: (input: SessionSearchInput) => {
    return invoke(SESSION_IPC_CHANNELS.SEARCH, input)
  },

  exportSession: (input: SessionExportInput) => {
    return invoke(SESSION_IPC_CHANNELS.EXPORT, input)
  },

  importSession: (input?: SessionImportInput) => {
    return invoke(SESSION_IPC_CHANNELS.IMPORT, input)
  },

  updateSessionMeta: (id: string, updates: SessionMetaUpdates) => {
    return invoke(SESSION_IPC_CHANNELS.UPDATE_META, id, updates)
  },

  updateSessionTitle: (id: string, title: string) => {
    return invoke(SESSION_IPC_CHANNELS.UPDATE_TITLE, id, title)
  },

  generateSessionTitle: (sessionId: string) => {
    return invoke(SESSION_IPC_CHANNELS.GENERATE_TITLE, sessionId)
  },

  generateSuggestions: () => {
    return invoke(SESSION_IPC_CHANNELS.GENERATE_SUGGESTIONS)
  },

  deleteSession: (id: string) => {
    return invoke(SESSION_IPC_CHANNELS.DELETE_SESSION, id)
  },

  togglePinSession: (id: string) => {
    return invoke(SESSION_IPC_CHANNELS.TOGGLE_PIN, id)
  },

  updateSessionProject: (sessionId: string, projectPath: string) => {
    return invoke(SESSION_IPC_CHANNELS.UPDATE_PROJECT, sessionId, projectPath)
  },

  sendSessionMessage: (input: SessionSendInput) => {
    return invoke(SESSION_IPC_CHANNELS.SEND_MESSAGE, input)
  },

  regenerateSessionTurn: (input: SessionRegenerateTurnInput) => {
    return invoke(SESSION_IPC_CHANNELS.REGENERATE_TURN, input)
  },

  rewindSession: (input: SessionRewindInput) => {
    return invoke(SESSION_IPC_CHANNELS.REWIND, input)
  },

  editSessionTurn: (input: SessionEditTurnInput) => {
    return invoke(SESSION_IPC_CHANNELS.EDIT_TURN, input)
  },

  branchSessionFromMessage: (input: SessionBranchFromMessageInput) => {
    return invoke(SESSION_IPC_CHANNELS.BRANCH_FROM_MESSAGE, input)
  },
  compareSessionBranch: (sessionId: string) => invoke(SESSION_IPC_CHANNELS.COMPARE_BRANCH, sessionId),

  stopSession: (sessionId: string) => {
    return invoke(SESSION_IPC_CHANNELS.STOP, sessionId)
  },

  saveFilesToSessionProject: (input: SessionProjectFilesSaveInput) => {
    return invoke(SESSION_IPC_CHANNELS.SAVE_PROJECT_FILES, input)
  },

  listSessionPinnedWidgets: (sessionId: string) => {
    return invoke(SESSION_BOARD_IPC_CHANNELS.LIST, sessionId)
  },

  pinSessionWidget: (input: PinSessionWidgetInput) => {
    return invoke(SESSION_BOARD_IPC_CHANNELS.PIN, input)
  },

  unpinSessionWidget: (sessionId: string, pinId: string) => {
    return invoke(SESSION_BOARD_IPC_CHANNELS.UNPIN, sessionId, pinId)
  },

  testMcpServer: (name: string, entry: McpServerEntry) => {
    return invoke(AGENT_IPC_CHANNELS.TEST_MCP_SERVER, name, entry)
  },

  getGlobalAgentCapabilities: () => {
    return invoke(AGENT_IPC_CHANNELS.GET_GLOBAL_CAPABILITIES)
  },

  getGlobalAgentMcpConfig: () => {
    return invoke(AGENT_IPC_CHANNELS.GET_GLOBAL_MCP_CONFIG)
  },

  saveGlobalAgentMcpConfig: (config: WorkspaceMcpConfig) => {
    return invoke(AGENT_IPC_CHANNELS.SAVE_GLOBAL_MCP_CONFIG, config)
  },

  getGlobalAgentMcpPath: () => {
    return invoke(AGENT_IPC_CHANNELS.GET_GLOBAL_MCP_PATH)
  },

  getGlobalAgentSkills: () => {
    return invoke(AGENT_IPC_CHANNELS.GET_GLOBAL_SKILLS)
  },

  getGlobalAgentSkillDetail: (skillId: string) => {
    return invoke(AGENT_IPC_CHANNELS.GET_GLOBAL_SKILL_DETAIL, skillId)
  },

  getGlobalAgentSkillsDir: () => {
    return invoke(AGENT_IPC_CHANNELS.GET_GLOBAL_SKILLS_DIR)
  },

  installGlobalAgentSkill: (input: GlobalSkillInstallInput) => {
    return invoke(AGENT_IPC_CHANNELS.INSTALL_GLOBAL_SKILL, input)
  },

  updateGlobalAgentSkill: (skillSlug: string) => {
    return invoke(AGENT_IPC_CHANNELS.UPDATE_GLOBAL_SKILL, skillSlug)
  },

  deleteGlobalAgentSkill: (skillSlug: string) => {
    return invoke(AGENT_IPC_CHANNELS.DELETE_GLOBAL_SKILL, skillSlug)
  },

  toggleGlobalAgentSkill: (skillSlug: string, enabled: boolean) => {
    return invoke(AGENT_IPC_CHANNELS.TOGGLE_GLOBAL_SKILL, skillSlug, enabled)
  },

  openGlobalAgentPath: (filePath: string) => {
    return invoke(AGENT_IPC_CHANNELS.OPEN_GLOBAL_PATH, filePath)
  },

  readFilePreview: (filePath: string) => {
    return invoke(AGENT_IPC_CHANNELS.READ_FILE_PREVIEW, filePath)
  },

  startSessionWebPreviewServer: (sessionId: string) => {
    return invoke(AGENT_IPC_CHANNELS.START_SESSION_WEB_PREVIEW_SERVER, sessionId)
  },

  stopSessionWebPreviewServer: (sessionId: string) => {
    return invoke(AGENT_IPC_CHANNELS.STOP_SESSION_WEB_PREVIEW_SERVER, sessionId)
  },

  resolveSessionHtmlPreview: (sessionId: string, filePath: string) => {
    return invoke(AGENT_IPC_CHANNELS.RESOLVE_SESSION_HTML_PREVIEW, sessionId, filePath)
  },

  // 附件管理
  readAttachment: (localPath: string) => {
    return invoke(IPC_CHANNELS.READ_ATTACHMENT, localPath)
  },

  saveImageAs: (localPath: string, defaultFilename: string) => {
    return invoke(IPC_CHANNELS.SAVE_IMAGE_AS, localPath, defaultFilename)
  },

  openFileDialog: () => {
    return invoke(IPC_CHANNELS.OPEN_FILE_DIALOG)
  },

  // 用户档案（contract 使用 unknown 类型，直接用 ipcRenderer.invoke 保持 ElectronAPI 精确类型）
  getUserProfile: () => {
    return ipcRenderer.invoke(USER_PROFILE_IPC_CHANNELS.GET)
  },

  updateUserProfile: (updates: Partial<UserProfile>) => {
    return ipcRenderer.invoke(USER_PROFILE_IPC_CHANNELS.UPDATE, updates)
  },

  onUserProfileChanged: (callback: (profile: UserProfile) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, profile: UserProfile) => { callback(profile) }
    ipcRenderer.on(USER_PROFILE_IPC_CHANNELS.ON_CHANGED, listener)
    return () => { ipcRenderer.removeListener(USER_PROFILE_IPC_CHANNELS.ON_CHANGED, listener) }
  },

  // 应用设置
  getSettings: () => {
    return ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.GET)
  },

  updateSettings: (updates: Partial<AppSettings>) => {
    return ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.UPDATE, updates)
  },

  showDesktopNotification: (input: DesktopNotificationInput) => {
    return ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.SHOW_DESKTOP_NOTIFICATION, input)
  },


  listThemes: () => invoke(THEME_IPC_CHANNELS.LIST),
  createTheme: (theme: ThemeDefinition) => invoke(THEME_IPC_CHANNELS.CREATE, theme),
  updateTheme: (themeId: string, theme: ThemeDefinition) => invoke(THEME_IPC_CHANNELS.UPDATE, themeId, theme),
  deleteTheme: (themeId: string) => invoke(THEME_IPC_CHANNELS.DELETE, themeId),
  importTheme: () => invoke(THEME_IPC_CHANNELS.IMPORT),
  exportTheme: (themeId: string) => invoke(THEME_IPC_CHANNELS.EXPORT, themeId),
  openThemesDirectory: () => invoke(THEME_IPC_CHANNELS.OPEN_DIRECTORY),
  onThemesChanged: (callback: (catalog: ThemeCatalog) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, catalog: ThemeCatalog): void => callback(catalog)
    ipcRenderer.on(THEME_IPC_CHANNELS.ON_CHANGED, listener)
    return () => { ipcRenderer.removeListener(THEME_IPC_CHANNELS.ON_CHANGED, listener) }
  },

  getMemoryStatus: () => {
    return invoke('memory:get-status')
  },

  listMemories: (input?: { limit?: number; offset?: number; projectPath?: string }) => {
    return invoke('memory:list', input)
  },

  listDuplicateMemories: (input?: { limit?: number }) => {
    return invoke('memory:list-duplicates', input)
  },

  mergeDuplicateMemories: (input: { primaryUri: string; duplicateUris: string[] }) => {
    return invoke('memory:merge-duplicates', input)
  },

  forgetMemory: (uri: string) => {
    return invoke('memory:forget', uri)
  },

  getMemoryDebug: (input?: { sessionId?: string; projectPath?: string }) => {
    return invoke('memory:get-debug', input)
  },

  detectLocalNowledge: () => {
    return invoke('memory:detect-nowledge')
  },

  getMemoryImpression: () => {
    return invoke('memory:get-impression')
  },

  onSettingsChanged: (callback: (settings: AppSettings) => void) => {
    const listener = (_: unknown, settings: AppSettings): void => callback(settings)
    ipcRenderer.on(SETTINGS_IPC_CHANNELS.ON_SETTINGS_CHANGED, listener)
    return () => { ipcRenderer.removeListener(SETTINGS_IPC_CHANNELS.ON_SETTINGS_CHANGED, listener) }
  },

  getSystemTheme: () => {
    return invoke(SETTINGS_IPC_CHANNELS.GET_SYSTEM_THEME)
  },

  getSystemFonts: () => {
    return invoke('font:list-system')
  },

  onSystemThemeChanged: (callback: (isDark: boolean) => void) => {
    const listener = (_: unknown, isDark: boolean): void => callback(isDark)
    ipcRenderer.on(SETTINGS_IPC_CHANNELS.ON_SYSTEM_THEME_CHANGED, listener)
    return () => { ipcRenderer.removeListener(SETTINGS_IPC_CHANNELS.ON_SYSTEM_THEME_CHANGED, listener) }
  },

  openSettingsWindow: (tab?: SettingsTab) => {
    return invoke(SETTINGS_IPC_CHANNELS.OPEN_WINDOW, tab)
  },

  getWindowMode: () => {
    return parseWindowContext().mode
  },

  getWindowContext: () => {
    return parseWindowContext()
  },

  onSettingsNavigate: (callback: (tab: SettingsTab) => void) => {
    const listener = (_: unknown, tab: SettingsTab): void => callback(tab)
    ipcRenderer.on(SETTINGS_IPC_CHANNELS.NAVIGATE, listener)
    return () => { ipcRenderer.removeListener(SETTINGS_IPC_CHANNELS.NAVIGATE, listener) }
  },

  getForegroundSession: () => {
    return invoke(SETTINGS_IPC_CHANNELS.GET_FOREGROUND_SESSION)
  },

  setForegroundSession: (sessionId: string | null) => {
    return invoke(SETTINGS_IPC_CHANNELS.SET_FOREGROUND_SESSION, sessionId)
  },

  openSessionInMainWindow: (input: OpenSessionInMainWindowInput) => {
    return invoke(SETTINGS_IPC_CHANNELS.OPEN_SESSION_IN_MAIN_WINDOW, input)
  },

  onOpenSessionInMainWindow: (callback: (input: OpenSessionInMainWindowInput) => void) => {
    const listener = (_: unknown, input: OpenSessionInMainWindowInput): void => callback(input)
    ipcRenderer.on(SETTINGS_IPC_CHANNELS.ON_OPEN_SESSION_IN_MAIN_WINDOW, listener)
    return () => { ipcRenderer.removeListener(SETTINGS_IPC_CHANNELS.ON_OPEN_SESSION_IN_MAIN_WINDOW, listener) }
  },

  // 环境检测
  checkEnvironment: () => {
    return invoke(ENVIRONMENT_IPC_CHANNELS.CHECK)
  },

  fetchInstallerManifest: () => {
    return invoke(INSTALLER_IPC_CHANNELS.FETCH_MANIFEST)
  },

  downloadInstaller: (req: InstallerDownloadRequest) => {
    return invoke(INSTALLER_IPC_CHANNELS.DOWNLOAD, req)
  },

  cancelInstallerDownload: (key: string) => {
    return invoke(INSTALLER_IPC_CHANNELS.CANCEL, key)
  },

  launchInstaller: (filePath: string) => {
    return invoke(INSTALLER_IPC_CHANNELS.LAUNCH, filePath)
  },

  onInstallerProgress: (callback: (payload: InstallerProgressPayload) => void) => {
    const listener = (_: unknown, payload: InstallerProgressPayload): void => callback(payload)
    ipcRenderer.on(INSTALLER_IPC_CHANNELS.PROGRESS, listener)
    return () => { ipcRenderer.removeListener(INSTALLER_IPC_CHANNELS.PROGRESS, listener) }
  },

  reinitRuntime: () => {
    return invoke(INSTALLER_IPC_CHANNELS.REINIT_RUNTIME)
  },

  // 代理配置
  getProxySettings: () => {
    return invoke(PROXY_IPC_CHANNELS.GET_SETTINGS)
  },

  updateProxySettings: (config: ProxyConfig) => {
    return invoke(PROXY_IPC_CHANNELS.UPDATE_SETTINGS, config)
  },

  detectSystemProxy: () => {
    return invoke(PROXY_IPC_CHANNELS.DETECT_SYSTEM)
  },

  onSessionStreamEvent: (callback: (event: SessionStreamEvent) => void) => {
    const listener = (_: unknown, event: SessionStreamEvent): void => callback(event)
    ipcRenderer.on(SESSION_IPC_CHANNELS.STREAM_EVENT, listener)
    return () => { ipcRenderer.removeListener(SESSION_IPC_CHANNELS.STREAM_EVENT, listener) }
  },

  onSessionStreamComplete: (callback: (event: SessionStreamCompletePayload) => void) => {
    const listener = (_: unknown, event: SessionStreamCompletePayload): void => callback(event)
    ipcRenderer.on(SESSION_IPC_CHANNELS.STREAM_COMPLETE, listener)
    return () => { ipcRenderer.removeListener(SESSION_IPC_CHANNELS.STREAM_COMPLETE, listener) }
  },

  onSessionStreamError: (callback: (event: SessionStreamErrorPayload) => void) => {
    const listener = (_: unknown, event: SessionStreamErrorPayload): void => callback(event)
    ipcRenderer.on(SESSION_IPC_CHANNELS.STREAM_ERROR, listener)
    return () => { ipcRenderer.removeListener(SESSION_IPC_CHANNELS.STREAM_ERROR, listener) }
  },

  onSessionTitleUpdated: (callback: (event: SessionTitleUpdatedPayload) => void) => {
    const listener = (_: unknown, event: SessionTitleUpdatedPayload): void => callback(event)
    ipcRenderer.on(SESSION_IPC_CHANNELS.TITLE_UPDATED, listener)
    return () => { ipcRenderer.removeListener(SESSION_IPC_CHANNELS.TITLE_UPDATED, listener) }
  },

  onSessionUpdated: (callback: (event: SessionUpdatedPayload) => void) => {
    const listener = (_: unknown, event: SessionUpdatedPayload): void => callback(event)
    ipcRenderer.on(SESSION_IPC_CHANNELS.UPDATED, listener)
    return () => { ipcRenderer.removeListener(SESSION_IPC_CHANNELS.UPDATED, listener) }
  },


  // Agent 后台任务管理
  getTaskOutput: (input: GetTaskOutputInput) => {
    return invoke(AGENT_IPC_CHANNELS.GET_TASK_OUTPUT, input)
  },

  stopTask: (input: StopTaskInput) => {
    return invoke(AGENT_IPC_CHANNELS.STOP_TASK, input)
  },

  // Agent 权限系统
  respondPermission: (response: PermissionResponse) => {
    return invoke(AGENT_IPC_CHANNELS.PERMISSION_RESPOND, response)
  },

  // Agent 工具管理
  getAgentTools: () => {
    return invoke(AGENT_TOOL_IPC_CHANNELS.GET_ALL_TOOLS)
  },

  getAgentToolCredentials: (toolId: string) => {
    return invoke(AGENT_TOOL_IPC_CHANNELS.GET_TOOL_CREDENTIALS, toolId)
  },

  updateAgentToolState: (toolId: string, state: AgentToolState) => {
    return invoke(AGENT_TOOL_IPC_CHANNELS.UPDATE_TOOL_STATE, toolId, state)
  },

  updateAgentToolCredentials: (toolId: string, credentials: Record<string, string>) => {
    return invoke(AGENT_TOOL_IPC_CHANNELS.UPDATE_TOOL_CREDENTIALS, toolId, credentials)
  },

  createCustomAgentTool: (meta: AgentToolMeta) => {
    return invoke(AGENT_TOOL_IPC_CHANNELS.CREATE_CUSTOM_TOOL, meta)
  },

  deleteCustomAgentTool: (toolId: string) => {
    return invoke(AGENT_TOOL_IPC_CHANNELS.DELETE_CUSTOM_TOOL, toolId)
  },

  onCustomToolChanged: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(AGENT_TOOL_IPC_CHANNELS.CUSTOM_TOOL_CHANGED, listener)
    return () => { ipcRenderer.removeListener(AGENT_TOOL_IPC_CHANNELS.CUSTOM_TOOL_CHANGED, listener) }
  },

  testAgentTool: (toolId: string) => {
    return invoke(AGENT_TOOL_IPC_CHANNELS.TEST_TOOL, toolId)
  },

  // AskUserQuestion 交互式问答
  respondAskUser: (response: AskUserResponse) => {
    return invoke(AGENT_IPC_CHANNELS.ASK_USER_RESPOND, response)
  },

  // 工作区文件变化通知
  onCapabilitiesChanged: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(AGENT_IPC_CHANNELS.CAPABILITIES_CHANGED, listener)
    return () => { ipcRenderer.removeListener(AGENT_IPC_CHANNELS.CAPABILITIES_CHANGED, listener) }
  },

  onWorkspaceFilesChanged: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED, listener)
    return () => { ipcRenderer.removeListener(AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED, listener) }
  },

  openFolderDialog: () => {
    return invoke(AGENT_IPC_CHANNELS.OPEN_FOLDER_DIALOG)
  },

  attachDirectory: (input: AgentAttachDirectoryInput) => {
    return invoke(AGENT_IPC_CHANNELS.ATTACH_DIRECTORY, input)
  },

  detachDirectory: (input: AgentAttachDirectoryInput) => {
    return invoke(AGENT_IPC_CHANNELS.DETACH_DIRECTORY, input)
  },

  // Agent 文件系统操作
  listDirectory: (dirPath: string) => {
    return invoke(AGENT_IPC_CHANNELS.LIST_DIRECTORY, dirPath)
  },

  deleteFile: (filePath: string) => {
    return invoke(AGENT_IPC_CHANNELS.DELETE_FILE, filePath)
  },

  openFile: (filePath: string) => {
    return invoke(AGENT_IPC_CHANNELS.OPEN_FILE, filePath)
  },

  showInFolder: (filePath: string) => {
    return invoke(AGENT_IPC_CHANNELS.SHOW_IN_FOLDER, filePath)
  },

  previewFile: (filePath: string) => {
    return invoke(AGENT_IPC_CHANNELS.PREVIEW_FILE, filePath)
  },

  renameFile: (filePath: string, newName: string) => {
    return invoke(AGENT_IPC_CHANNELS.RENAME_FILE, filePath, newName)
  },

  moveFile: (filePath: string, targetDir: string) => {
    return invoke(AGENT_IPC_CHANNELS.MOVE_FILE, filePath, targetDir)
  },

  listAttachedDirectory: (dirPath: string) => {
    return invoke(AGENT_IPC_CHANNELS.LIST_ATTACHED_DIRECTORY, dirPath)
  },

  openAttachedFile: (filePath: string) => {
    return invoke(AGENT_IPC_CHANNELS.OPEN_ATTACHED_FILE, filePath)
  },

  showAttachedInFolder: (filePath: string) => {
    return invoke(AGENT_IPC_CHANNELS.SHOW_ATTACHED_IN_FOLDER, filePath)
  },

  renameAttachedFile: (filePath: string, newName: string) => {
    return invoke(AGENT_IPC_CHANNELS.RENAME_ATTACHED_FILE, filePath, newName)
  },

  moveAttachedFile: (filePath: string, targetDir: string) => {
    return invoke(AGENT_IPC_CHANNELS.MOVE_ATTACHED_FILE, filePath, targetDir)
  },

  searchWorkspaceFiles: (rootPath: string, query: string, limit = 20, additionalPaths?: string[]) => {
    return invoke(AGENT_IPC_CHANNELS.SEARCH_WORKSPACE_FILES, rootPath, query, limit, additionalPaths)
  },

  // 全局 Personality
  getPersonalityState: () => {
    return invoke(PERSONALITY_IPC_CHANNELS.GET_STATE)
  },

  updatePersonality: (input: PersonalityUpdateInput) => {
    return invoke(PERSONALITY_IPC_CHANNELS.UPDATE, input)
  },

  resetPersonality: (kind: PersonalityDocKind) => {
    return invoke(PERSONALITY_IPC_CHANNELS.RESET, kind)
  },

  openPersonalityPath: (kind: PersonalityDocKind) => {
    return invoke(PERSONALITY_IPC_CHANNELS.OPEN_PATH, kind)
  },

  // 自定义 System Prompt
  getSystemPromptState: () => {
    return invoke(SYSTEM_PROMPT_IPC_CHANNELS.GET_STATE)
  },

  addSystemPrompt: (input: CustomSystemPromptCreateInput) => {
    return invoke(SYSTEM_PROMPT_IPC_CHANNELS.ADD, input)
  },

  updateSystemPrompt: (input: CustomSystemPromptUpdateInput) => {
    return invoke(SYSTEM_PROMPT_IPC_CHANNELS.UPDATE, input)
  },

  deleteSystemPrompt: (id: string) => {
    return invoke(SYSTEM_PROMPT_IPC_CHANNELS.DELETE, id)
  },

  setActiveSystemPrompt: (id: string) => {
    return invoke(SYSTEM_PROMPT_IPC_CHANNELS.SET_ACTIVE, id)
  },

  clearActiveSystemPrompt: () => {
    return invoke(SYSTEM_PROMPT_IPC_CHANNELS.CLEAR_ACTIVE)
  },

  getTokenUsageStats: (days: number) => {
    return invoke(TOKEN_USAGE_IPC_CHANNELS.GET_STATS, days)
  },

  // 自动更新（updater 通道不在 IpcContract 中，由 registerUpdaterIpc 独立注册）
  updater: {
    checkForUpdates: () => ipcRenderer.invoke('updater:check'),
    getStatus: () => ipcRenderer.invoke('updater:get-status'),
    onStatusChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, status: Parameters<typeof callback>[0]): void => callback(status)
      ipcRenderer.on('updater:status-changed', listener)
      return () => { ipcRenderer.removeListener('updater:status-changed', listener) }
    },
  },

  // GitHub Release
  getLatestRelease: () => {
    return invoke(GITHUB_RELEASE_IPC_CHANNELS.GET_LATEST_RELEASE)
  },

  listReleases: (options) => {
    return invoke(GITHUB_RELEASE_IPC_CHANNELS.LIST_RELEASES, options)
  },

  getReleaseByTag: (tag) => {
    return invoke(GITHUB_RELEASE_IPC_CHANNELS.GET_RELEASE_BY_TAG, tag)
  },


  getBridgeConfig: () => {
    return invoke(IM_BRIDGE_IPC_CHANNELS.GET_CONFIG)
  },

  saveBridgeConfig: (input: BridgeConfigInput) => {
    return invoke(IM_BRIDGE_IPC_CHANNELS.SAVE_CONFIG, input)
  },

  getBridgeSecret: (channel: BridgeChannelType) => {
    return invoke(IM_BRIDGE_IPC_CHANNELS.GET_SECRET, channel)
  },

  testBridgeChannel: (channel: BridgeChannelType, input?: BridgeConfigInput) => {
    return invoke(IM_BRIDGE_IPC_CHANNELS.TEST_CHANNEL, channel, input)
  },

  startBridge: () => {
    return invoke(IM_BRIDGE_IPC_CHANNELS.START)
  },

  stopBridge: () => {
    return invoke(IM_BRIDGE_IPC_CHANNELS.STOP)
  },

  restartBridge: () => {
    return invoke(IM_BRIDGE_IPC_CHANNELS.RESTART)
  },

  getBridgeStatus: () => {
    return invoke(IM_BRIDGE_IPC_CHANNELS.GET_STATUS)
  },

  listBridgeBindings: () => {
    return invoke(IM_BRIDGE_IPC_CHANNELS.LIST_BINDINGS)
  },

  updateBridgeBinding: (input: BridgeBindingUpdateInput) => {
    return invoke(IM_BRIDGE_IPC_CHANNELS.UPDATE_BINDING, input)
  },

  updateBridgeBindingProjectPath: (endpointKey: string, projectPath: string) => {
    return invoke(IM_BRIDGE_IPC_CHANNELS.UPDATE_BINDING_PROJECT_PATH, endpointKey, projectPath)
  },

  removeBridgeBinding: (endpointKey: string) => {
    return invoke(IM_BRIDGE_IPC_CHANNELS.REMOVE_BINDING, endpointKey)
  },

  onBridgeStatusChanged: (callback: (status: BridgeStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: BridgeStatus): void => callback(status)
    ipcRenderer.on(IM_BRIDGE_IPC_CHANNELS.STATUS_CHANGED, listener)
    return () => { ipcRenderer.removeListener(IM_BRIDGE_IPC_CHANNELS.STATUS_CHANGED, listener) }
  },

  listFeishuBridgeBots: () => {
    return invoke(FEISHU_BRIDGE_IPC_CHANNELS.GET_BOTS)
  },

  saveFeishuBridgeBot: (input: FeishuBotConfigInput) => {
    return invoke(FEISHU_BRIDGE_IPC_CHANNELS.SAVE_BOT, input)
  },

  removeFeishuBridgeBot: (botId: string) => {
    return invoke(FEISHU_BRIDGE_IPC_CHANNELS.REMOVE_BOT, botId)
  },

  getFeishuBridgeBotSecret: (botId: string) => {
    return invoke(FEISHU_BRIDGE_IPC_CHANNELS.GET_BOT_SECRET, botId)
  },

  testFeishuBridgeBot: (botId: string) => {
    return invoke(FEISHU_BRIDGE_IPC_CHANNELS.TEST_BOT, botId)
  },

  startFeishuBridgeBot: (botId: string) => {
    return invoke(FEISHU_BRIDGE_IPC_CHANNELS.START_BOT, botId)
  },

  stopFeishuBridgeBot: (botId: string) => {
    return invoke(FEISHU_BRIDGE_IPC_CHANNELS.STOP_BOT, botId)
  },

  getFeishuBridgeMultiStatus: () => {
    return invoke(FEISHU_BRIDGE_IPC_CHANNELS.GET_MULTI_STATUS)
  },

  registerFeishuBridgeApp: () => {
    return invoke(FEISHU_BRIDGE_IPC_CHANNELS.REGISTER_APP_START)
  },

  cancelFeishuBridgeRegistration: () => {
    return invoke(FEISHU_BRIDGE_IPC_CHANNELS.REGISTER_APP_CANCEL)
  },

  onFeishuBridgeRegisterQrcode: (callback: (payload: FeishuRegisterAppQRCode) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: FeishuRegisterAppQRCode): void => callback(payload)
    ipcRenderer.on(FEISHU_BRIDGE_IPC_CHANNELS.REGISTER_APP_QRCODE, listener)
    return () => { ipcRenderer.removeListener(FEISHU_BRIDGE_IPC_CHANNELS.REGISTER_APP_QRCODE, listener) }
  },

  onFeishuBridgeRegisterStatus: (callback: (payload: FeishuRegisterAppStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: FeishuRegisterAppStatus): void => callback(payload)
    ipcRenderer.on(FEISHU_BRIDGE_IPC_CHANNELS.REGISTER_APP_STATUS, listener)
    return () => { ipcRenderer.removeListener(FEISHU_BRIDGE_IPC_CHANNELS.REGISTER_APP_STATUS, listener) }
  },

  onFeishuBridgeMultiStatusChanged: (callback: (status: FeishuMultiBridgeStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: FeishuMultiBridgeStatus): void => callback(status)
    ipcRenderer.on(FEISHU_BRIDGE_IPC_CHANNELS.MULTI_STATUS_CHANGED, listener)
    return () => { ipcRenderer.removeListener(FEISHU_BRIDGE_IPC_CHANNELS.MULTI_STATUS_CHANGED, listener) }
  },

  listWeChatBridgeAccounts: () => {
    return invoke(WECHAT_BRIDGE_IPC_CHANNELS.LIST_ACCOUNTS)
  },

  startWeChatBridgeLogin: (input?: WeChatBridgeStartLoginInput) => {
    return invoke(WECHAT_BRIDGE_IPC_CHANNELS.START_LOGIN, input)
  },

  refreshWeChatBridgeLogin: (accountId: string) => {
    return invoke(WECHAT_BRIDGE_IPC_CHANNELS.REFRESH_LOGIN, accountId)
  },

  cancelWeChatBridgeLogin: (accountId: string) => {
    return invoke(WECHAT_BRIDGE_IPC_CHANNELS.CANCEL_LOGIN, accountId)
  },

  removeWeChatBridgeAccount: (accountId: string) => {
    return invoke(WECHAT_BRIDGE_IPC_CHANNELS.REMOVE_ACCOUNT, accountId)
  },

  startWeChatBridgeAccount: (accountId: string) => {
    return invoke(WECHAT_BRIDGE_IPC_CHANNELS.START_ACCOUNT, accountId)
  },

  stopWeChatBridgeAccount: (accountId: string) => {
    return invoke(WECHAT_BRIDGE_IPC_CHANNELS.STOP_ACCOUNT, accountId)
  },

  reloginWeChatBridgeAccount: (accountId: string) => {
    return invoke(WECHAT_BRIDGE_IPC_CHANNELS.RELOGIN_ACCOUNT, accountId)
  },

  getWeChatBridgeLoginState: (accountId: string) => {
    return invoke(WECHAT_BRIDGE_IPC_CHANNELS.GET_LOGIN_STATE, accountId)
  },

  onWeChatBridgeLoginStateChanged: (callback: (state: WeChatBridgeLoginState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: WeChatBridgeLoginState): void => callback(state)
    ipcRenderer.on(WECHAT_BRIDGE_IPC_CHANNELS.LOGIN_STATE_CHANGED, listener)
    return () => { ipcRenderer.removeListener(WECHAT_BRIDGE_IPC_CHANNELS.LOGIN_STATE_CHANGED, listener) }
  },

  onWeChatBridgeAccountStatusChanged: (callback: (status: WeChatBridgeAccountStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: WeChatBridgeAccountStatus): void => callback(status)
    ipcRenderer.on(WECHAT_BRIDGE_IPC_CHANNELS.ACCOUNT_STATUS_CHANGED, listener)
    return () => { ipcRenderer.removeListener(WECHAT_BRIDGE_IPC_CHANNELS.ACCOUNT_STATUS_CHANGED, listener) }
  },

  // Native-feel: 系统剪贴板
  copyText: (text: string) => {
    return ipcRenderer.invoke('native-feel:copy-text', text)
  },
  copyRichText: (text: string, html: string) => {
    return ipcRenderer.invoke('native-feel:copy-rich-text', text, html)
  },

  // ===== Cua Driver (Computer Use) =====

  getCuaDriverStatus: () => invoke(CUA_DRIVER_IPC_CHANNELS.GET_STATUS),
  detectCuaDriver: () => invoke(CUA_DRIVER_IPC_CHANNELS.DETECT),
  installCuaDriver: () => invoke(CUA_DRIVER_IPC_CHANNELS.INSTALL),
  toggleCuaDriver: (enabled: boolean) => invoke(CUA_DRIVER_IPC_CHANNELS.TOGGLE, enabled),
  testCuaDriver: () => invoke(CUA_DRIVER_IPC_CHANNELS.TEST),
}

// 将 API 暴露到渲染进程的 window 对象上
contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// 扩展 Window 接口的类型定义
declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
