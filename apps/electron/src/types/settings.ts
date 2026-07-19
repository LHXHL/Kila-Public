/**
 * 应用设置类型
 *
 * 主题模式、IPC 通道等设置相关定义。
 */

import {
  DEFAULT_THEME_ID,
  type EnvironmentCheckResult,
  type KilaNotificationPreferenceMap,
  type KilaPermissionMode,
  type ThinkingConfig,
  type AgentEffort,
  type ThinkingLevel,
} from '@kila/shared'

/** 主题模式 */
export type ThemeMode = 'light' | 'dark' | 'system'

/** 默认主题模式 */
export const DEFAULT_THEME_MODE: ThemeMode = 'light'

/** 默认主题 ID */
export const DEFAULT_THEME_ID_SETTING = DEFAULT_THEME_ID

/** 设置窗口标签 */
export type SettingsTab =
  | 'general'
  | 'memory'
  | 'channels'
  | 'proxy'
  | 'appearance'
  | 'about'
  | 'mcp'
  | 'skills'
  | 'prompts'
  | 'token-usage'
  | 'context-compaction'
  | 'bridge'
  | 'scheduled-tasks'
  | 'computer-use'

export const SETTINGS_TABS: SettingsTab[] = [
  'general',
  'memory',
  'channels',
  'proxy',
  'appearance',
  'about',
  'mcp',
  'skills',
  'prompts',
  'token-usage',
  'context-compaction',
  'bridge',
  'scheduled-tasks',
  'computer-use',
]

/** 默认设置标签 */
export const DEFAULT_SETTINGS_TAB: SettingsTab = 'general'

/** 应用语言 */
export type AppLocale = 'zh-CN' | 'en'

/** 默认语言 */
export const DEFAULT_LOCALE: AppLocale = 'zh-CN'

/** 渲染窗口模式 */
export type WindowMode = 'main' | 'settings' | 'quick-task'

/** 渲染窗口上下文 */
export interface WindowContext {
  mode: WindowMode
  settingsTab: SettingsTab | null
}

/** 设置窗口发给主窗口的会话打开请求 */
export interface OpenSessionInMainWindowInput {
  sessionId: string
  title: string
  pendingPrompt?: string
}

export interface DesktopNotificationInput {
  title: string
  body: string
  sessionId?: string
  taskId?: string
}

/** 应用设置 */
export interface AppSettings {
  /** 主题模式 */
  themeMode: ThemeMode
  /** 配色主题 ID */
  themeId: string
  /** 全局字体族名（空串 = 系统默认） */
  fontFamily?: string
  /** 全局字体大小 px（10–32，默认 15） */
  fontSize?: number
  /** Agent 默认渠道 ID（任意已启用渠道） */
  agentChannelId?: string
  /** Agent 默认模型 ID */
  agentModelId?: string
  /** 内部工具渠道 ID（标题生成等后台轻任务） */
  utilityChannelId?: string
  /** 内部工具模型 ID（标题生成等后台轻任务） */
  utilityModelId?: string
  /** 是否启用 Nowledge 本地增强；本地 Markdown 记忆始终可用 */
  memoryNowledgeEnabled?: boolean
  /** Token 统计预算：月度 USD 软阈值 */
  tokenMonthlyBudgetUsd?: number
  /** Token 统计预算：月度 token 软阈值 */
  tokenMonthlyBudgetTokens?: number
  /** Nowledge Base URL */
  memoryNowledgeBaseUrl?: string
  /** Nowledge API Key */
  memoryNowledgeApiKey?: string
  /** Nowledge 请求超时（毫秒） */
  memoryNowledgeTimeoutMs?: number
  /** 是否启用 prompt-time session memory context */
  memorySessionContextEnabled?: boolean
  /** Agent 当前工作区 ID */
  agentWorkspaceId?: string
  /** 是否已完成 Onboarding 流程 */
  onboardingCompleted?: boolean
  /** 是否跳过了环境检测 */
  environmentCheckSkipped?: boolean
  /** 最后一次环境检测结果（缓存） */
  lastEnvironmentCheck?: EnvironmentCheckResult
  /** 是否启用桌面通知 */
  notificationsEnabled?: boolean
  /** 站内通知分类偏好 */
  notificationPreferences?: KilaNotificationPreferenceMap
  /** 应用语言 */
  locale?: AppLocale
  /** 标签页持久化状态（重启恢复） */
  tabState?: PersistedTabSettings
  /** Agent 权限模式（全局默认，可被单次发送/定时任务/桥接链路覆盖） */
  agentPermissionMode?: KilaPermissionMode
  /** Agent 默认思考等级 */
  agentThinkingLevel?: ThinkingLevel
  /** Agent 思考模式 */
  agentThinking?: ThinkingConfig
  /** Agent 推理深度 */
  agentEffort?: AgentEffort
  /** Agent 最大预算（美元/次） */
  agentMaxBudgetUsd?: number
  /** Agent 最大轮次（0 或 undefined = SDK 默认） */
  agentMaxTurns?: number
  /** 教程推荐横幅是否已关闭 */
  tutorialBannerDismissed?: boolean
  /** 单一 Session 存储是否已完成首启清理 */
  unifiedSessionsBootstrapped?: boolean
  /** 会话项目目录模型是否已完成首启清理 */
  sessionProjectModelBootstrapped?: boolean
}

/** 持久化的标签页状态 */
export interface PersistedTabSettings {
  tabs: Array<{
    id: string
    type: 'chat' | 'agent'
    sessionId: string
    title: string
  }>
  splitLayout: {
    mode: 'single' | 'horizontal-2' | 'vertical-2' | 'grid-4'
    panels: Array<{
      index: number
      activeTabId: string | null
    }>
    focusedPanelIndex: number
  }
}

/** 设置 IPC 通道 */
export const SETTINGS_IPC_CHANNELS = {
  GET: 'settings:get',
  UPDATE: 'settings:update',
  SHOW_DESKTOP_NOTIFICATION: 'settings:show-desktop-notification',
  ON_SETTINGS_CHANGED: 'settings:changed',
  GET_SYSTEM_THEME: 'settings:get-system-theme',
  ON_SYSTEM_THEME_CHANGED: 'settings:system-theme-changed',
  OPEN_WINDOW: 'settings:open-window',
  NAVIGATE: 'settings:navigate',
  GET_FOREGROUND_SESSION: 'settings:get-foreground-session',
  SET_FOREGROUND_SESSION: 'settings:set-foreground-session',
  OPEN_SESSION_IN_MAIN_WINDOW: 'settings:open-session-in-main-window',
  ON_OPEN_SESSION_IN_MAIN_WINDOW: 'settings:open-session-in-main-window:dispatch',
} as const
