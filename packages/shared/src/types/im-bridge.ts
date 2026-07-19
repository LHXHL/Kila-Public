/**
 * IM Bridge shared types
 *
 * Telegram / Discord 等远程 IM 桥接的跨进程共享协议。
 */

import type { DangerLevel, ThinkingLevel } from './agent'

export type BridgeChannelType = 'telegram' | 'discord' | 'feishu' | 'wechat'

export type BridgeConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'waiting_scan'
  | 'scanned'
  | 'token_expired'

export interface BridgeDefaultSessionConfig {
  channelId?: string
  modelId?: string
  projectPath?: string
  thinkingLevel?: ThinkingLevel
  historyTurns?: number | 'infinite'
  enabledToolIds?: string[]
}

export interface BridgeChannelSessionOverride {
  channelId?: string
  modelId?: string
  projectPath?: string
}

export interface BridgeProviderContext {
  wechat?: {
    accountId: string
    peerId: string
    contextToken?: string
    sessionId?: string
    typingTicket?: string
  }
}

export interface BridgeOutboundAttachment {
  remoteId: string
  filename: string
  mediaType: string
  size: number
  localPath?: string
  providerPayload?: {
    wechat?: {
      accountId: string
      aesKey?: string
      encryptQueryParam?: string
      cdnUrl?: string
      fileId?: string
      fileKey?: string
    }
  }
}

export interface BridgeAttachmentProviderPayload {
  wechat?: {
    accountId: string
    aesKey?: string
    encryptQueryParam?: string
    cdnUrl?: string
    fileId?: string
    fileKey?: string
    rawFilename?: string
  }
}

export interface TelegramBridgeConfig {
  enabled: boolean
  botToken: string
  allowedUserIds: string[]
  maxInboundFileBytes: number
  defaultSession?: BridgeChannelSessionOverride
}

export interface DiscordBridgeConfig {
  enabled: boolean
  botToken: string
  allowedUserIds: string[]
  allowedChannelIds: string[]
  allowedGuildIds: string[]
  requireMention: boolean
  maxInboundFileBytes: number
  defaultSession?: BridgeChannelSessionOverride
}

export interface FeishuBridgeConfig {
  enabled: boolean
  appId: string
  appSecret: string
  bots?: FeishuBotConfig[]
  sessionMirror?: FeishuSessionMirrorSettings
  allowP2P: boolean
  allowGroup: boolean
  requireMention: boolean
  /** 启用流式卡片（CardKit 2.0），实时展示 Agent 运行进度 */
  streamingCards?: boolean
  /** 消息聚合静默窗口（ms），群聊高频消息合并投递 */
  quietWindowMs?: number
  /** 全局最大并发运行数 */
  maxConcurrent?: number
  defaultSession?: BridgeChannelSessionOverride
}

export interface FeishuBotConfig {
  id: string
  name: string
  enabled: boolean
  appId: string
  appSecret: string
  defaultSession?: BridgeChannelSessionOverride
}

export interface FeishuBotConfigInput {
  id?: string
  name: string
  enabled: boolean
  appId: string
  appSecret: string
  defaultSession?: BridgeChannelSessionOverride
}

export interface FeishuBotBridgeStatus extends BridgeChannelStatus {
  botId: string
  botName: string
}

export interface FeishuMultiBridgeStatus {
  bots: Record<string, FeishuBotBridgeStatus>
}

export type FeishuSessionSyncMode = 'off' | 'stream'

export interface FeishuSessionMirrorSettings {
  mode: FeishuSessionSyncMode
  botId?: string
}

export interface FeishuRegisterAppQRCode {
  url: string
  dataUrl: string
  expireIn: number
}

export interface FeishuRegisterAppStatus {
  status: 'polling' | 'slow_down' | 'domain_switched'
  interval?: number
}

export interface FeishuRegisterAppResult {
  appId: string
  appSecret: string
  tenantBrand?: 'feishu' | 'lark'
  operatorOpenId?: string
}

export interface WeChatBridgeConfig {
  enabled: boolean
  baseUrl: string
  accountIds: string[]
  allowedUserIds: string[]
  aggregateWindowMs: number
  deferredOutboundTtlMs: number
  contextTtlMs: number
  defaultSession?: BridgeChannelSessionOverride
}

export interface BridgeConfig {
  enabled: boolean
  autoStart: boolean
  defaultSession: BridgeDefaultSessionConfig
  telegram: TelegramBridgeConfig
  discord: DiscordBridgeConfig
  feishu: FeishuBridgeConfig
  wechat: WeChatBridgeConfig
}

export interface BridgeConfigInput {
  enabled: boolean
  autoStart: boolean
  defaultSession?: BridgeDefaultSessionConfig
  telegram?: Partial<Omit<TelegramBridgeConfig, 'botToken'>> & { botToken?: string }
  discord?: Partial<Omit<DiscordBridgeConfig, 'botToken'>> & { botToken?: string }
  feishu?: Partial<Omit<FeishuBridgeConfig, 'appSecret' | 'bots'>> & {
    appSecret?: string
    bots?: FeishuBotConfigInput[]
  }
  wechat?: Partial<Omit<WeChatBridgeConfig, 'enabled' | 'accountIds' | 'allowedUserIds'>> & {
    enabled?: boolean
    accountIds?: string[]
    allowedUserIds?: string[]
  }
}

export interface BridgeBinding {
  channelType: BridgeChannelType
  endpointKey: string
  botId?: string
  accountId?: string
  peerId?: string
  peerType?: 'user' | 'group'
  chatId: string
  threadId?: string
  userId?: string
  sessionId: string
  projectPath?: string
  createdAt: number
  updatedAt: number
  displayName?: string
}

export interface BridgeBindingUpdateInput {
  endpointKey: string
  sessionId: string
  projectPath?: string
}

export interface TelegramBridgeRuntimeState {
  pollOffset?: number
  lastConnectedAt?: number
  lastError?: string
}

export interface DiscordBridgeRuntimeState {
  sessionId?: string
  resumeGatewayUrl?: string
  lastSequence?: number
  lastConnectedAt?: number
  lastError?: string
}

export interface FeishuBridgeRuntimeState {
  lastConnectedAt?: number
  lastError?: string
}

export interface WeChatAccountRuntimeState {
  accountId: string
  getUpdatesBuf?: string
  lastConnectedAt?: number
  lastError?: string
  lastContextByPeerId?: Record<string, {
    contextToken: string
    lastSeenAt: number
    sessionId?: string
    typingTicket?: string
  }>
}

export interface BridgeRuntimeState {
  telegram?: TelegramBridgeRuntimeState
  discord?: DiscordBridgeRuntimeState
  feishu?: FeishuBridgeRuntimeState
  wechat?: Record<string, WeChatAccountRuntimeState>
}

export interface BridgeChannelStatus {
  channel: BridgeChannelType
  enabled: boolean
  status: BridgeConnectionStatus
  connectedAt?: number
  lastConnectedAt?: number
  errorMessage?: string
  retryAttempt?: number
  nextRetryAt?: number
}

export interface BridgeStatus {
  enabled: boolean
  running: boolean
  startedAt?: number
  errorMessage?: string
  activeBindings: number
  channels: Record<BridgeChannelType, BridgeChannelStatus>
  lifecycle?: Array<{
    channel: BridgeChannelType
    enabled: boolean
    configured: boolean
    healthy: boolean
    status: BridgeConnectionStatus
    lastConnectedAt?: number
    errorMessage?: string
    retryAttempt?: number
    nextRetryAt?: number
  }>
}

export interface BridgeTestResult {
  channel: BridgeChannelType
  success: boolean
  message: string
  details?: string
}

export interface BridgePermissionPrompt {
  channelType: BridgeChannelType
  endpointKey: string
  sessionId: string
  requestId: string
  toolName: string
  description: string
  dangerLevel: DangerLevel
  callbackToken: string
  approvalCode?: string
  expiresAt: number
}

export interface WeChatBridgeAccountEntry {
  accountId: string
  label: string
  ilinkUserId: string
  ilinkBotId: string
  baseUrl: string
  enabled: boolean
  createdAt: number
  updatedAt: number
  lastLoginAt?: number
}

export interface WeChatBridgeStartLoginInput {
  accountId?: string
  label?: string
  botType?: string
}

export interface WeChatBridgeCredentialEntry {
  accountId: string
  botToken: string
  ilinkUserId: string
  ilinkBotId: string
  baseUrl: string
  updatedAt: number
}

export interface WeChatBridgeLoginState {
  accountId: string
  status: 'idle' | 'waiting_scan' | 'scanned' | 'confirmed' | 'expired' | 'redirected' | 'error'
  qrCodeDataUrl?: string
  message?: string
  errorMessage?: string
  updatedAt: number
}

export interface WeChatBridgeAccountStatus {
  accountId: string
  enabled: boolean
  status: BridgeConnectionStatus
  connectedAt?: number
  lastConnectedAt?: number
  errorMessage?: string
}

export interface BridgeAdapterCapabilities {
  approvalMode: 'interactive' | 'text_code' | 'desktop_only'
  supportsTyping: boolean
  supportsDeferredOutbound: boolean
  supportsMediaUpload: boolean
  outboundTextLimit: number
}

export const IM_BRIDGE_IPC_CHANNELS = {
  GET_CONFIG: 'im-bridge:get-config',
  SAVE_CONFIG: 'im-bridge:save-config',
  GET_SECRET: 'im-bridge:get-secret',
  TEST_CHANNEL: 'im-bridge:test-channel',
  START: 'im-bridge:start',
  STOP: 'im-bridge:stop',
  RESTART: 'im-bridge:restart',
  GET_STATUS: 'im-bridge:get-status',
  STATUS_CHANGED: 'im-bridge:status-changed',
  LIST_BINDINGS: 'im-bridge:list-bindings',
  UPDATE_BINDING: 'im-bridge:update-binding',
  UPDATE_BINDING_PROJECT_PATH: 'im-bridge:update-binding-project-path',
  REMOVE_BINDING: 'im-bridge:remove-binding',
} as const

export const FEISHU_BRIDGE_IPC_CHANNELS = {
  GET_BOTS: 'im-bridge:feishu:get-bots',
  SAVE_BOT: 'im-bridge:feishu:save-bot',
  REMOVE_BOT: 'im-bridge:feishu:remove-bot',
  GET_BOT_SECRET: 'im-bridge:feishu:get-bot-secret',
  TEST_BOT: 'im-bridge:feishu:test-bot',
  START_BOT: 'im-bridge:feishu:start-bot',
  STOP_BOT: 'im-bridge:feishu:stop-bot',
  GET_MULTI_STATUS: 'im-bridge:feishu:get-multi-status',
  MULTI_STATUS_CHANGED: 'im-bridge:feishu:multi-status-changed',
  REGISTER_APP_START: 'im-bridge:feishu:register-app-start',
  REGISTER_APP_QRCODE: 'im-bridge:feishu:register-app-qrcode',
  REGISTER_APP_STATUS: 'im-bridge:feishu:register-app-status',
  REGISTER_APP_CANCEL: 'im-bridge:feishu:register-app-cancel',
} as const

export const WECHAT_BRIDGE_IPC_CHANNELS = {
  LIST_ACCOUNTS: 'im-bridge:wechat:list-accounts',
  START_LOGIN: 'im-bridge:wechat:start-login',
  REFRESH_LOGIN: 'im-bridge:wechat:refresh-login',
  CANCEL_LOGIN: 'im-bridge:wechat:cancel-login',
  REMOVE_ACCOUNT: 'im-bridge:wechat:remove-account',
  START_ACCOUNT: 'im-bridge:wechat:start-account',
  STOP_ACCOUNT: 'im-bridge:wechat:stop-account',
  RELOGIN_ACCOUNT: 'im-bridge:wechat:relogin-account',
  GET_LOGIN_STATE: 'im-bridge:wechat:get-login-state',
  LOGIN_STATE_CHANGED: 'im-bridge:wechat:login-state-changed',
  ACCOUNT_STATUS_CHANGED: 'im-bridge:wechat:account-status-changed',
} as const
