/**
 * IPC Contract — 统一 IPC 通道类型契约
 *
 * 定义所有 ipcMain.handle / ipcRenderer.invoke 的参数和返回值类型。
 * ipc.ts 和 preload/index.ts 都从这里推导类型，消除手动同步带来的漂移风险。
 *
 * 设计原则：
 * - 只定义 invoke/handle 类型（请求-响应模式）
 * - 不定义 push 事件（STREAM_EVENT 等），它们通过 on/send 单向推送
 * - 使用交叉引用已有类型，不重复定义
 */

import type {
  RuntimeStatus,
  GitRepoStatus,
  GitChangesSnapshot,
  ProjectRunChanges,
  GitDiffInput,
  GitDiffResult,
  GitHunkActionInput,
  GitFileActionInput,
  GitCommitInput,
  GitCommitResult,
  GitWorktreeCreateInput,
  GitWorktreeEntry,
  GitWorktreeRemoveInput,
} from './runtime'
import type {
  Channel,
  ChannelCreateInput,
  ChannelUpdateInput,
  ChannelTestResult,
  FetchModelsInput,
  FetchModelsResult,
} from './channel'
import type {
  ProviderDbModel,
  ProviderDbProvider,
} from '../model-catalog/provider-db'
import type { AttachmentSaveInput, AttachmentSaveResult, FileDialogResult } from './attachment'
import type {
  AgentSaveFilesInput,
  AgentSaveWorkspaceFilesInput,
  AgentSavedFile,
  AgentAttachDirectoryInput,
  WorkspaceAttachDirectoryInput,
  GetTaskOutputInput,
  GetTaskOutputResult,
  StopTaskInput,
  WorkspaceMcpConfig,
  McpServerEntry,
  GlobalSkillEntry,
  GlobalSkillDetail,
  GlobalSkillInstallInput,
  GlobalSkillInstallResult,
  SkillMeta,
  WorkspaceCapabilities,
  FileEntry,
  FileSearchResult,
  PermissionResponse,
  AskUserResponse,
} from './agent'
import type { EnvironmentCheckResult } from './environment'
import type {
  InstallerDownloadRequest,
  InstallerDownloadResult,
  InstallerManifest,
} from './installer'
import type { ProxyConfig, SystemProxyDetectResult } from './proxy'
import type { GitHubRelease, GitHubReleaseListOptions } from './github'
import type {
  PersonalityState,
  PersonalityDocument,
  PersonalityDocKind,
  PersonalityUpdateInput,
} from './personality'
import type {
  CustomSystemPrompt,
  SystemPromptState,
  CustomSystemPromptCreateInput,
  CustomSystemPromptUpdateInput,
} from './system-prompt'
import type { AgentToolInfo, AgentToolState, AgentToolMeta } from './agent-tool'
import type {
  BridgeBinding,
  BridgeBindingUpdateInput,
  BridgeChannelType,
  BridgeConfig,
  BridgeConfigInput,
  BridgeStatus,
  BridgeTestResult,
  FeishuBotConfig,
  FeishuBotConfigInput,
  FeishuMultiBridgeStatus,
  FeishuRegisterAppResult,
  WeChatBridgeAccountEntry,
  WeChatBridgeAccountStatus,
  WeChatBridgeLoginState,
  WeChatBridgeStartLoginInput,
} from './im-bridge'
import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskRuntimeStatus,
  ScheduledTaskRunRecord,
  ScheduledTaskUpdateInput,
} from './scheduled-task'
import type {
  SessionCreateInput,
  SessionExportInput,
  SessionExportResult,
  SessionImportInput,
  SessionImportResult,
  SessionMessage,
  SessionMeta,
  SessionMetaUpdates,
  SessionMessagesPageInput,
  SessionMessagesPageResult,
  SessionRecentMessagesResult,
  SessionSearchInput,
  SessionSearchResults,
  SessionSendInput,
  SessionRegenerateTurnInput,
  SessionRewindInput,
  SessionProjectFilesSaveInput,
  SessionEditTurnInput,
  SessionBranchComparison,
  SessionBranchFromMessageInput,
  GenerateSuggestionsResult,
} from './session'
import type { PinSessionWidgetInput, SessionPinnedWidget } from './session-board'
import type { SessionHtmlPreviewResolution, SessionWebPreviewServerInfo } from './file-preview'
import type { TokenUsageStats } from './token-usage'
import type {
  CreateKilaNotificationInput,
  KilaNotificationRecord,
  ListKilaNotificationsInput,
} from './notification'
import type { InlineFilePreview } from './file-preview'
import type { CuaDriverStatus, CuaDriverDetectResult, CuaDriverInstallResult } from './agent'
import type { ThemeCatalog, ThemeDefinition, ThemeImportResult, ThemeMutationResult } from '../theme'

// ===== Utility types =====

/** IPC handler 签名：args 元组 + 返回类型 */
export interface IpcHandlerSpec {
  args: unknown[]
  result: unknown
}

// ===== 类型未从 @kila/shared 导出的，在此内联 =====

/** MCP 测试 / Agent 工具测试的通用结果类型 */
export interface TestResult {
  success: boolean
  message: string
}

// ===== IPC 契约定义 =====

/**
 * 全局 IPC 契约
 *
 * key = 通道名称字符串
 * value = { args: [参数元组]; result: 返回类型 }
 *
 * 注意：部分 handler 使用了 IpcMainInvokeEvent 参数（如 event.sender），
 * 在契约中不体现——event 由 Electron 自动注入，caller 不关心。
 */
export interface IpcContract {
  // ===== Runtime =====
  'runtime:get-status': { args: []; result: RuntimeStatus | null }
  'git:get-repo-status': { args: [dirPath: string]; result: GitRepoStatus | null }
  'git:get-changes': { args: [projectPath: string]; result: GitChangesSnapshot }
  'git:init': { args: [projectPath: string]; result: GitChangesSnapshot }
  'git:get-run-changes': { args: [sessionId: string]; result: ProjectRunChanges | null }
  'git:get-diff': { args: [input: GitDiffInput]; result: GitDiffResult }
  'git:stage': { args: [input: GitFileActionInput]; result: GitChangesSnapshot }
  'git:unstage': { args: [input: GitFileActionInput]; result: GitChangesSnapshot }
  'git:discard': { args: [input: GitFileActionInput]; result: GitChangesSnapshot }
  'git:commit': { args: [input: GitCommitInput]; result: GitCommitResult }
  'git:list-worktrees': { args: [projectPath: string]; result: GitWorktreeEntry[] }
  'git:apply-hunk': { args: [input: GitHunkActionInput]; result: GitChangesSnapshot }
  'git:create-worktree': { args: [input: GitWorktreeCreateInput]; result: GitWorktreeEntry[] }
  'git:remove-worktree': { args: [input: GitWorktreeRemoveInput]; result: GitWorktreeEntry[] }
  'shell:open-external': { args: [url: string]; result: void }

  // ===== Channel =====
  'channel:list': { args: []; result: Channel[] }
  'channel:create': { args: [input: ChannelCreateInput]; result: Channel }
  'channel:update': { args: [id: string, input: ChannelUpdateInput]; result: Channel }
  'channel:delete': { args: [id: string]; result: void }
  'channel:decrypt-key': { args: [channelId: string]; result: string }
  'channel:test': { args: [channelId: string]; result: ChannelTestResult }
  'channel:test-direct': { args: [input: FetchModelsInput]; result: ChannelTestResult }
  'channel:fetch-models': { args: [input: FetchModelsInput]; result: FetchModelsResult }

  // ===== Provider DB =====
  'provider-db:list': {
    args: []
    result: Array<{ id: string; name?: string; displayName?: string; api?: string; doc?: string; description?: string; tags?: string[]; modelCount: number }>
  }
  'provider-db:lookup': { args: [providerId: string]; result: ProviderDbProvider | null }
  'provider-db:find-model': {
    args: [modelId: string]
    result: { provider: ProviderDbProvider; model: ProviderDbModel } | null
  }

  // ===== Session =====
  'session:list-sessions': { args: []; result: SessionMeta[] }
  'session:create-session': { args: [input?: SessionCreateInput]; result: SessionMeta }
  'session:create-welcome-session': { args: []; result: SessionMeta | null }
  'session:get-messages': { args: [id: string]; result: SessionMessage[] }
  'session:get-recent-messages': { args: [id: string, limit: number]; result: SessionRecentMessagesResult }
  'session:get-messages-page': { args: [input: SessionMessagesPageInput]; result: SessionMessagesPageResult }
  'session:set-active-project-watches': { args: [sessionIds: string[]]; result: void }
  'session:search': { args: [input: SessionSearchInput]; result: SessionSearchResults }
  'session:export': { args: [input: SessionExportInput]; result: SessionExportResult }
  'session:import': { args: [input?: SessionImportInput]; result: SessionImportResult }
  'session:update-meta': { args: [id: string, updates: SessionMetaUpdates]; result: SessionMeta }
  'session:update-title': { args: [id: string, title: string]; result: SessionMeta }
  'session:delete-session': { args: [id: string]; result: void }
  'session:toggle-pin': { args: [id: string]; result: SessionMeta }
  'session:send-message': { args: [input: SessionSendInput]; result: void }
  'session:regenerate-turn': { args: [input: SessionRegenerateTurnInput]; result: void }
  'session:rewind': { args: [input: SessionRewindInput]; result: SessionMessage[] }
  'session:edit-turn': { args: [input: SessionEditTurnInput]; result: void }
  'session:branch-from-message': { args: [input: SessionBranchFromMessageInput]; result: SessionMeta }
  'session:compare-branch': { args: [sessionId: string]; result: SessionBranchComparison }
  'session:stop': { args: [sessionId: string]; result: void }
  'session:update-project': { args: [sessionId: string, projectPath: string]; result: SessionMeta }
  'session:save-project-files': { args: [input: SessionProjectFilesSaveInput]; result: AgentSavedFile[] }
  'session:generate-title': { args: [sessionId: string]; result: string | null }
  'session:generate-suggestions': { args: []; result: GenerateSuggestionsResult }

  // ===== Session Board =====
  'session-board:list': { args: [sessionId: string]; result: SessionPinnedWidget[] }
  'session-board:pin': { args: [input: PinSessionWidgetInput]; result: SessionPinnedWidget }
  'session-board:unpin': { args: [sessionId: string, pinId: string]; result: void }

  // ===== Scheduled Tasks =====
  'scheduled-task:list': { args: []; result: ScheduledTask[] }
  'scheduled-task:get': { args: [taskId: string]; result: ScheduledTask | null }
  'scheduled-task:create': { args: [input: ScheduledTaskCreateInput]; result: ScheduledTask }
  'scheduled-task:update': { args: [taskId: string, patch: ScheduledTaskUpdateInput]; result: ScheduledTask }
  'scheduled-task:delete': { args: [taskId: string]; result: void }
  'scheduled-task:start': { args: [taskId: string]; result: ScheduledTask }
  'scheduled-task:stop': { args: [taskId: string, reason?: string]; result: ScheduledTask }
  'scheduled-task:run-now': { args: [taskId: string]; result: void }
  'scheduled-task:list-runs': { args: [taskId: string, limit?: number]; result: ScheduledTaskRunRecord[] }
  'scheduled-task:get-runtime-status': { args: []; result: ScheduledTaskRuntimeStatus }
  'scheduled-task:recover-overdue': { args: []; result: ScheduledTaskRuntimeStatus }

  // ===== Token Usage =====
  'token-usage:get-stats': { args: [days: number]; result: TokenUsageStats }

  // ===== Notifications =====
  'notification:list': { args: [input?: ListKilaNotificationsInput]; result: KilaNotificationRecord[] }
  'notification:create': { args: [input: CreateKilaNotificationInput]; result: KilaNotificationRecord | null }
  'notification:mark-read': { args: [notificationId: string]; result: KilaNotificationRecord[] }
  'notification:mark-all-read': { args: []; result: KilaNotificationRecord[] }
  'notification:clear': { args: []; result: void }

  // ===== Tutorial =====
  'app:get-tutorial-content': { args: []; result: string | null }

  // ===== Attachments =====
  'app:save-attachment': { args: [input: AttachmentSaveInput]; result: AttachmentSaveResult }
  'app:read-attachment': { args: [localPath: string]; result: string }
  'app:save-image-as': { args: [localPath: string, defaultFilename: string]; result: boolean }
  'app:delete-attachment': { args: [localPath: string]; result: void }
  'app:open-file-dialog': { args: []; result: FileDialogResult }
  'app:extract-attachment-text': { args: [localPath: string]; result: string }

  // ===== User Profile =====
  'user-profile:get': { args: []; result: unknown }
  'user-profile:update': { args: [updates: Record<string, unknown>]; result: unknown }

  // ===== Settings =====
  'settings:get': { args: []; result: unknown }
  'settings:update': { args: [updates: Record<string, unknown>]; result: unknown }
  'settings:get-system-theme': { args: []; result: boolean }
  'theme:list': { args: []; result: ThemeCatalog }
  'theme:create': { args: [theme: ThemeDefinition]; result: ThemeMutationResult }
  'theme:update': { args: [themeId: string, theme: ThemeDefinition]; result: ThemeMutationResult }
  'theme:delete': { args: [themeId: string]; result: ThemeCatalog }
  'theme:import': { args: []; result: ThemeImportResult }
  'theme:export': { args: [themeId: string]; result: boolean }
  'theme:open-directory': { args: []; result: void }
  'settings:open-window': { args: [tab?: string]; result: void }
  'settings:get-foreground-session': { args: []; result: SessionMeta | null }
  'settings:set-foreground-session': { args: [sessionId: string | null]; result: void }
  'settings:open-session-in-main-window': { args: [input: unknown]; result: void }

  // ===== Memory =====
  'memory:get-status': {
    args: []
    result: {
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
    }
  }
  'memory:list': {
    args: [input?: {
      limit?: number
      offset?: number
      projectPath?: string
    }]
    result: Array<{
      uri: string
      title?: string
      content: string
      category: string
      tags: string[]
      projectPath?: string
      updatedAt: number
    }>
  }
  'memory:open-directory': {
    args: []
    result: void
  }
  'memory:get-debug': {
    args: [input?: { sessionId?: string; projectPath?: string }]
    result: {
      sessionId?: string
      projectPath?: string
      threadState: null | {
        sessionId: string
        threadId: string
        threadTitle?: string
        projectPath?: string
        lastAppendedMessageSeq: number
        lastDistilledMessageSeq: number
        lastDistilledAt?: number
        lastTriageAt?: number
        lastTriageResultJson?: string
        lastError?: string
        updatedAt: number
      }
      snapshot: null | {
        scopeType: 'global' | 'project' | 'session'
        scopeKey: string
        snapshotText: string
        snapshotSourceJson?: string
        updatedAt: number
      }
      runtimeEvents: Array<{
        id: string
        sessionId?: string
        threadId?: string
        eventType: string
        status: 'info' | 'success' | 'warn' | 'error'
        detail: string
        createdAt: number
      }>
      lastWorkingMemoryFetchAt?: number
      config: {
        nowledgeEnabled: boolean
        sessionContextEnabled: boolean
      }
    }
  }
  'memory:list-duplicates': {
    args: [input?: { limit?: number }]
    result: Array<{
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
    }>
  }
  'memory:merge-duplicates': {
    args: [input: { primaryUri: string; duplicateUris: string[] }]
    result: {
      uri: string
      title?: string
      content: string
      category: string
      tags: string[]
      projectPath?: string
      updatedAt: number
    } | null
  }
  'memory:forget': {
    args: [uri: string]
    result: boolean
  }
  'memory:list-pending-writes': {
    args: [input?: { sessionId?: string }]
    result: Array<{
      content: string
      title?: string
      tags?: string[]
      category?: 'general' | 'decision' | 'preference' | 'fact' | 'task' | 'insight'
      key?: string
      sourceSessionId: string
      projectPath?: string
    }>
  }
  'memory:clear-pending-writes': {
    args: [input?: { sessionId?: string }]
    result: { cleared: number }
  }
  'memory:list-notebook': {
    args: [input?: {
      limit?: number
      offset?: number
      projectPath?: string
    }]
    result: Array<{
      uri: string
      key?: string
      title?: string
      content: string
      tags: string[]
      sourceSessionId?: string
      projectPath?: string
      createdAt: number
      updatedAt: number
    }>
  }
  'memory:write-notebook': {
    args: [input: {
      key?: string
      title?: string
      content: string
      tags?: string[]
      sourceSessionId?: string
      projectPath?: string
    }]
    result: {
      uri: string
      key?: string
      title?: string
      content: string
      tags: string[]
      sourceSessionId?: string
      projectPath?: string
      createdAt: number
      updatedAt: number
    }
  }
  'memory:edit-notebook': {
    args: [input: {
      uri: string
      key?: string
      title?: string
      content?: string
      tags?: string[]
      projectPath?: string
    }]
    result: {
      uri: string
      key?: string
      title?: string
      content: string
      tags: string[]
      sourceSessionId?: string
      projectPath?: string
      createdAt: number
      updatedAt: number
    } | null
  }
  'memory:forget-notebook': {
    args: [uri: string]
    result: boolean
  }
  'memory:detect-nowledge': {
    args: []
    result: {
      found: boolean
      source: 'config' | 'probe' | 'none'
      baseUrl?: string
      apiKey?: string
      apiKeyFound: boolean
      nowledgeBackendVersion?: string
      detail: string
    }
  }
  'memory:get-impression': {
    args: []
    result: {
      content?: string
      updatedAt?: number
    }
  }

  // ===== Font =====
  'font:list-system': { args: []; result: string[] }

  // ===== Environment =====
  'environment:check': { args: []; result: EnvironmentCheckResult }

  // ===== Installer =====
  'installer:fetch-manifest': { args: []; result: InstallerManifest }
  'installer:download': { args: [req: InstallerDownloadRequest]; result: InstallerDownloadResult }
  'installer:cancel': { args: [key: string]; result: boolean }
  'installer:launch': { args: [filePath: string]; result: void }
  'installer:reinit-runtime': { args: []; result: RuntimeStatus }

  // ===== Proxy =====
  'proxy:get-settings': { args: []; result: ProxyConfig }
  'proxy:update-settings': { args: [config: ProxyConfig]; result: void }
  'proxy:detect-system': { args: []; result: SystemProxyDetectResult }

  // ===== Agent: Workspace capabilities (MCP + Skill) =====
  'agent:get-capabilities': { args: [workspaceSlug: string]; result: WorkspaceCapabilities }
  'agent:get-mcp-config': { args: [workspaceSlug: string]; result: WorkspaceMcpConfig }
  'agent:save-mcp-config': { args: [workspaceSlug: string, config: WorkspaceMcpConfig]; result: void }
  'agent:test-mcp-server': { args: [name: string, entry: McpServerEntry]; result: TestResult }
  'agent:get-skills': { args: [workspaceSlug: string]; result: SkillMeta[] }
  'agent:get-skills-dir': { args: [workspaceSlug: string]; result: string }
  'agent:delete-skill': { args: [workspaceSlug: string, skillSlug: string]; result: void }
  'agent:toggle-skill': { args: [workspaceSlug: string, skillSlug: string, enabled: boolean]; result: void }

  // ===== Agent: Global config (MCP + Skill) =====
  'agent:get-global-capabilities': { args: []; result: WorkspaceCapabilities }
  'agent:get-global-mcp-config': { args: []; result: WorkspaceMcpConfig }
  'agent:save-global-mcp-config': { args: [config: WorkspaceMcpConfig]; result: void }
  'agent:get-global-mcp-path': { args: []; result: string }
  'agent:get-global-skills': { args: []; result: GlobalSkillEntry[] }
  'agent:get-global-skill-detail': { args: [skillId: string]; result: GlobalSkillDetail }
  'agent:get-global-skills-dir': { args: []; result: string }
  'agent:install-global-skill': { args: [input: GlobalSkillInstallInput]; result: GlobalSkillInstallResult }
  'agent:update-global-skill': { args: [skillSlug: string]; result: GlobalSkillInstallResult }
  'agent:delete-global-skill': { args: [skillSlug: string]; result: void }
  'agent:toggle-global-skill': { args: [skillSlug: string, enabled: boolean]; result: void }
  'agent:open-global-path': { args: [filePath: string]; result: void }

  // ===== Cua Driver (Computer Use) =====
  'cua-driver:get-status': { args: []; result: CuaDriverStatus }
  'cua-driver:detect': { args: []; result: CuaDriverDetectResult }
  'cua-driver:install': { args: []; result: CuaDriverInstallResult }
  'cua-driver:toggle': { args: [enabled: boolean]; result: CuaDriverStatus }
  'cua-driver:test': { args: []; result: { success: boolean; message: string } }


  // ===== Agent: Background tasks =====
  'agent:get-task-output': { args: [input: GetTaskOutputInput]; result: GetTaskOutputResult }
  'agent:stop-task': { args: [input: StopTaskInput]; result: void }

  // ===== Agent: Permission =====
  'agent:permission:respond': { args: [response: PermissionResponse]; result: void }

  // ===== Agent: AskUser =====
  'agent:ask-user:respond': { args: [response: AskUserResponse]; result: void }

  // ===== Agent: Files =====
  'agent:save-files-to-session': { args: [input: AgentSaveFilesInput]; result: AgentSavedFile[] }
  'agent:save-files-to-workspace': { args: [input: AgentSaveWorkspaceFilesInput]; result: AgentSavedFile[] }
  'agent:get-workspace-files-path': { args: [workspaceSlug: string]; result: string }
  'agent:open-folder-dialog': { args: []; result: { path: string; name: string } | null }
  'agent:attach-directory': { args: [input: AgentAttachDirectoryInput]; result: string[] }
  'agent:detach-directory': { args: [input: AgentAttachDirectoryInput]; result: string[] }
  'agent:attach-workspace-directory': { args: [input: WorkspaceAttachDirectoryInput]; result: string[] }
  'agent:detach-workspace-directory': { args: [input: WorkspaceAttachDirectoryInput]; result: string[] }
  'agent:get-workspace-directories': { args: [workspaceSlug: string]; result: string[] }

  // ===== Agent: File system operations =====
  'agent:list-directory': { args: [dirPath: string]; result: FileEntry[] }
  'agent:delete-file': { args: [filePath: string]; result: void }
  'agent:open-file': { args: [filePath: string]; result: void }
  'agent:show-in-folder': { args: [filePath: string]; result: void }
  'agent:preview-file': { args: [filePath: string]; result: void }
  'agent:read-file-preview': { args: [filePath: string]; result: InlineFilePreview }
  'agent:start-session-web-preview-server': { args: [sessionId: string]; result: SessionWebPreviewServerInfo }
  'agent:stop-session-web-preview-server': { args: [sessionId: string]; result: void }
  'agent:resolve-session-html-preview': { args: [sessionId: string, filePath: string]; result: SessionHtmlPreviewResolution }
  'agent:rename-file': { args: [filePath: string, newName: string]; result: void }
  'agent:move-file': { args: [filePath: string, targetDir: string]; result: void }

  // ===== Agent: Attached directory operations =====
  'agent:list-attached-directory': { args: [dirPath: string]; result: FileEntry[] }
  'agent:open-attached-file': { args: [filePath: string]; result: void }
  'agent:show-attached-in-folder': { args: [filePath: string]; result: void }
  'agent:rename-attached-file': { args: [filePath: string, newName: string]; result: void }
  'agent:move-attached-file': { args: [filePath: string, targetDir: string]; result: void }

  // ===== Agent: Workspace file search =====
  'agent:search-workspace-files': { args: [rootPath: string, query: string, limit?: number, additionalPaths?: string[]]; result: FileSearchResult }

  // ===== Personality =====
  'personality:get-state': { args: []; result: PersonalityState }
  'personality:update': { args: [input: PersonalityUpdateInput]; result: PersonalityDocument }
  'personality:reset': { args: [kind: PersonalityDocKind]; result: PersonalityDocument }
  'personality:open-path': { args: [kind: PersonalityDocKind]; result: void }

  // ===== System Prompt =====
  'system-prompt:get-state': { args: []; result: SystemPromptState }
  'system-prompt:add': { args: [input: CustomSystemPromptCreateInput]; result: CustomSystemPrompt }
  'system-prompt:update': { args: [input: CustomSystemPromptUpdateInput]; result: CustomSystemPrompt }
  'system-prompt:delete': { args: [id: string]; result: void }
  'system-prompt:set-active': { args: [id: string]; result: SystemPromptState }
  'system-prompt:clear-active': { args: []; result: SystemPromptState }

  // ===== Agent Tools =====
  'agent-tool:get-all-tools': { args: []; result: AgentToolInfo[] }
  'agent-tool:get-credentials': { args: [toolId: string]; result: Record<string, string> }
  'agent-tool:update-state': { args: [toolId: string, state: AgentToolState]; result: void }
  'agent-tool:update-credentials': { args: [toolId: string, credentials: Record<string, string>]; result: void }
  'agent-tool:test': { args: [toolId: string]; result: TestResult }
  'agent-tool:create-custom': { args: [meta: AgentToolMeta]; result: void }
  'agent-tool:delete-custom': { args: [toolId: string]; result: void }

  // ===== GitHub Release =====
  'github-release:get-latest': { args: []; result: GitHubRelease | null }
  'github-release:list': { args: [options?: GitHubReleaseListOptions]; result: GitHubRelease[] }
  'github-release:get-by-tag': { args: [tag: string]; result: GitHubRelease | null }

  // ===== IM Bridge =====
  'im-bridge:get-config': { args: []; result: BridgeConfig }
  'im-bridge:save-config': { args: [input: BridgeConfigInput]; result: BridgeConfig }
  'im-bridge:get-secret': { args: [channel: BridgeChannelType]; result: string }
  'im-bridge:test-channel': { args: [channel: BridgeChannelType, input?: BridgeConfigInput]; result: BridgeTestResult }
  'im-bridge:start': { args: []; result: void }
  'im-bridge:stop': { args: []; result: void }
  'im-bridge:restart': { args: []; result: void }
  'im-bridge:get-status': { args: []; result: BridgeStatus }
  'im-bridge:list-bindings': { args: []; result: BridgeBinding[] }
  'im-bridge:update-binding': { args: [input: BridgeBindingUpdateInput]; result: BridgeBinding | null }
  'im-bridge:update-binding-project-path': { args: [endpointKey: string, projectPath: string]; result: { binding: BridgeBinding; sessionReplaced: boolean } }
  'im-bridge:remove-binding': { args: [endpointKey: string]; result: boolean }
  'im-bridge:feishu:get-bots': { args: []; result: FeishuBotConfig[] }
  'im-bridge:feishu:save-bot': { args: [input: FeishuBotConfigInput]; result: FeishuBotConfig }
  'im-bridge:feishu:remove-bot': { args: [botId: string]; result: boolean }
  'im-bridge:feishu:get-bot-secret': { args: [botId: string]; result: string }
  'im-bridge:feishu:test-bot': { args: [botId: string]; result: BridgeTestResult }
  'im-bridge:feishu:start-bot': { args: [botId: string]; result: void }
  'im-bridge:feishu:stop-bot': { args: [botId: string]; result: void }
  'im-bridge:feishu:get-multi-status': { args: []; result: FeishuMultiBridgeStatus }
  'im-bridge:feishu:register-app-start': { args: []; result: FeishuRegisterAppResult }
  'im-bridge:feishu:register-app-cancel': { args: []; result: void }
  'im-bridge:wechat:list-accounts': { args: []; result: WeChatBridgeAccountEntry[] }
  'im-bridge:wechat:start-login': { args: [input?: WeChatBridgeStartLoginInput]; result: WeChatBridgeLoginState }
  'im-bridge:wechat:refresh-login': { args: [accountId: string]; result: WeChatBridgeLoginState }
  'im-bridge:wechat:cancel-login': { args: [accountId: string]; result: void }
  'im-bridge:wechat:remove-account': { args: [accountId: string]; result: void }
  'im-bridge:wechat:start-account': { args: [accountId: string]; result: WeChatBridgeAccountStatus }
  'im-bridge:wechat:stop-account': { args: [accountId: string]; result: WeChatBridgeAccountStatus }
  'im-bridge:wechat:relogin-account': { args: [accountId: string]; result: WeChatBridgeLoginState }
  'im-bridge:wechat:get-login-state': { args: [accountId: string]; result: WeChatBridgeLoginState | null }
}

// ===== Utility types for typed IPC =====

/** 所有已知的 IPC 通道名 */
export type IpcContractChannel = keyof IpcContract

/** 获取指定通道的参数类型元组 */
export type IpcArgs<K extends IpcContractChannel> = IpcContract[K]['args']

/** 获取指定通道的返回类型 */
export type IpcResult<K extends IpcContractChannel> = IpcContract[K]['result']
