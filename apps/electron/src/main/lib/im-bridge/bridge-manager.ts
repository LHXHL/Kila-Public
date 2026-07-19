import { SESSION_IPC_CHANNELS } from '@kila/shared'
import type {
  BridgeBinding,
  BridgeBindingUpdateInput,
  BridgeChannelSessionOverride,
  BridgeChannelType,
  BridgeConfig,
  BridgeConfigInput,
  BridgeProviderContext,
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
  SessionMeta,
} from '@kila/shared'
import {
  createSession,
  getSessionMeta,
  updateSessionMeta,
} from '../session-manager'
import { listChannels } from '../channel-manager'
import { createHeadlessSessionService } from '../session-service'
import { watchSessionProject } from '../workspace-watcher'
import { isAgentSessionActive } from '../agent-service'
import { getSettings } from '../settings-service'
import { broadcastSessionChannel } from '../cli-bridge/broadcaster'
import { registerSessionRuntimeObserver } from '../session-runtime-observers'
import { createLogger } from '../logger'
import { imBridgeConfigManager, ImBridgeConfigManager } from './config-manager'
import { ChannelRouter } from './channel-router'
import { chunkOutboundMessage, renderTelegramOutbound } from './delivery-layer'
import { HeadlessSessionBridge } from './headless-session-bridge'
import { PermissionBridge } from './permission-bridge'
import {
  computeBridgeSessionDefaultsSyncUpdates,
  resolveBridgeProjectPath,
  resolveEffectiveBridgeSessionDefaults,
  resolveInboundBridgeSessionPlan,
} from './bridge-session-defaults'
import { BridgeRateLimiter } from './security/rate-limiter'
import { buildInboundUserMessage, hasUsableInboundContent } from './security/validators'
import type { BridgeAdapter, BridgeAdapterEvent, BridgeInboundMessage } from './adapters/base-adapter'
import { DiscordAdapter, FeishuAdapter, FeishuMultiAdapter, TelegramAdapter } from './adapters'
import type { AgentEvent } from '@kila/shared'
import { createInitialState, reduce as reduceRunState, finalizeIfRunning } from './feishu/card-run-state'
import type { RunState } from './feishu/card-run-state'
import { WeChatAdapterGroup } from './wechat'
import { parseWeChatTextApproval } from './wechat/parser'
import { imBridgeAuditLog, ImBridgeAuditLog } from './audit-log'
import { BridgeLifecycleRegistry, type BridgeSecretState } from './bridge-lifecycle-registry'
import { FeishuSessionMirrorService } from './feishu/session-mirror'
import { syncFeishuMirrorSleepBlocker } from './feishu-sleep-blocker'

const log = createLogger('IM Bridge')

interface BridgeManagerDeps {
  configManager?: ImBridgeConfigManager
  telegramAdapter?: BridgeAdapter
  discordAdapter?: BridgeAdapter
  feishuAdapter?: BridgeAdapter
  wechatAdapter?: WeChatAdapterGroup
  auditLog?: ImBridgeAuditLog
}

function createEmptyChannelStatus(channel: BridgeChannelType, enabled: boolean): BridgeStatus['channels'][BridgeChannelType] {
  return {
    channel,
    enabled,
    status: 'disconnected',
  }
}

function mergeConfig(current: BridgeConfig, input?: BridgeConfigInput): BridgeConfig {
  if (!input) return current

  return {
    enabled: input.enabled,
    autoStart: input.autoStart,
    defaultSession: {
      ...current.defaultSession,
      ...input.defaultSession,
    },
    telegram: {
      ...current.telegram,
      ...input.telegram,
      defaultSession: {
        ...current.telegram.defaultSession,
        ...input.telegram?.defaultSession,
      },
      botToken: input.telegram?.botToken?.trim() || current.telegram.botToken,
    },
    discord: {
      ...current.discord,
      ...input.discord,
      defaultSession: {
        ...current.discord.defaultSession,
        ...input.discord?.defaultSession,
      },
      botToken: input.discord?.botToken?.trim() || current.discord.botToken,
    },
    feishu: {
      ...current.feishu,
      ...(() => {
        const { bots: _bots, ...feishuInput } = input.feishu ?? {}
        return feishuInput
      })(),
      defaultSession: {
        ...current.feishu.defaultSession,
        ...input.feishu?.defaultSession,
      },
      appSecret: input.feishu?.appSecret?.trim() || current.feishu.appSecret,
    },
    wechat: {
      ...current.wechat,
      ...input.wechat,
      defaultSession: {
        ...current.wechat.defaultSession,
        ...input.wechat?.defaultSession,
      },
      accountIds: input.wechat?.accountIds ?? current.wechat.accountIds,
      allowedUserIds: input.wechat?.allowedUserIds ?? current.wechat.allowedUserIds,
    },
  }
}

export class BridgeManager {
  private readonly configManager: ImBridgeConfigManager
  private readonly rateLimiter = new BridgeRateLimiter()
  private readonly statusHandlers = new Set<(status: BridgeStatus) => void>()
  private readonly wechatLoginStateHandlers = new Set<(state: WeChatBridgeLoginState) => void>()
  private readonly wechatAccountStatusHandlers = new Set<(status: WeChatBridgeAccountStatus) => void>()
  private readonly adapters: Record<BridgeChannelType, BridgeAdapter>
  private running = false

  private readonly channelRouter: ChannelRouter
  private readonly permissionBridge: PermissionBridge
  private readonly headlessBridge: HeadlessSessionBridge
  private readonly auditLog: ImBridgeAuditLog
  private readonly lifecycleRegistry = new BridgeLifecycleRegistry()
  private readonly feishuSessionMirror: FeishuSessionMirrorService

  constructor(deps?: BridgeManagerDeps) {
    this.configManager = deps?.configManager ?? imBridgeConfigManager
    this.auditLog = deps?.auditLog ?? imBridgeAuditLog
    this.adapters = {
      telegram: deps?.telegramAdapter ?? new TelegramAdapter({
        getConfig: () => this.resolveTelegramConfig(),
        getPollOffset: () => this.configManager.getRuntimeState().telegram?.pollOffset,
        setPollOffset: (pollOffset) => {
          const current = this.configManager.getRuntimeState()
          this.configManager.saveRuntimeState({
            ...current,
            telegram: {
              ...current.telegram,
              pollOffset,
              lastConnectedAt: Date.now(),
            },
          })
        },
      }),
      discord: deps?.discordAdapter ?? new DiscordAdapter({
        getConfig: () => this.resolveDiscordConfig(),
        getRuntimeState: () => this.configManager.getRuntimeState(),
        saveRuntimeState: (nextState) => {
          this.configManager.saveRuntimeState(nextState)
        },
      }),
      feishu: deps?.feishuAdapter ?? new FeishuMultiAdapter({
        getConfig: () => this.resolveFeishuConfig(),
        getBotSecret: (botId) => this.configManager.getDecryptedFeishuBotSecret(botId),
      }),
      wechat: deps?.wechatAdapter ?? new WeChatAdapterGroup({
        getConfig: () => this.resolveLiveConfig().wechat,
        getRuntimeState: () => this.configManager.getRuntimeState(),
        saveRuntimeState: (nextState) => {
          this.configManager.saveRuntimeState(nextState)
        },
        onLoginStateChanged: (state) => {
          for (const handler of this.wechatLoginStateHandlers) handler(state)
        },
        onAccountStatusChanged: (status) => {
          for (const handler of this.wechatAccountStatusHandlers) handler(status)
        },
        onAccountsChanged: (accountId) => {
          this.syncWechatAccountIds()
          if (accountId && this.running && this.resolveLiveConfig().wechat.enabled) {
            void this.wechatAdapter.startAccount(accountId).catch(() => {})
          }
          this.emitStatus()
        },
      }),
    }

    this.channelRouter = new ChannelRouter({
      listBindings: () => this.configManager.listBindings(),
      saveBindings: (bindings) => {
        this.configManager.saveBindings(bindings)
        this.emitStatus()
      },
      getSessionMeta,
      createSession,
      updateSessionProject: (sessionId, projectPath) => {
        const session = getSessionMeta(sessionId)
        if (!session) return
        const { replaceSessionProject } = require('../session-project-manager') as typeof import('../session-project-manager')
        const { nextProject } = replaceSessionProject(session, projectPath)
        updateSessionMeta(sessionId, { project: nextProject })
        broadcastSessionChannel(SESSION_IPC_CHANNELS.UPDATED, {
          sessionId,
          reason: 'updated',
        })
      },
      watchSessionProject,
      getDefaultSessionCreateInput: () => ({
        ...this.resolveLiveConfig().defaultSession,
      }),
      resolveProjectPath: (_endpointKey, channelType) => {
        return resolveBridgeProjectPath({
          channelType,
          config: this.resolveLiveConfig(),
        }) ?? undefined
      },
    })
    this.feishuSessionMirror = new FeishuSessionMirrorService(this.feishuAdapter)
    registerSessionRuntimeObserver({
      onRunStart: async (session, input) => {
        if (input.messageSource === 'im-bridge') return
        await this.feishuSessionMirror.start(session)
      },
      onStream: (channel, payload) => {
        this.feishuSessionMirror.onStream(channel, payload)
      },
    })

    this.permissionBridge = new PermissionBridge({
      respondToPermission: (requestId, behavior, alwaysAllow) => {
        const { permissionService } = require('../agent-permission-service') as typeof import('../agent-permission-service')
        return permissionService.respondToPermission(requestId, behavior, alwaysAllow)
      },
      dispatchPrompt: async (prompt) => {
        const binding = this.channelRouter.listBindings().find((item) => item.endpointKey === prompt.endpointKey)
        if (!binding) {
          throw new Error(`找不到权限请求对应绑定: ${prompt.endpointKey}`)
        }

        await this.adapters[prompt.channelType].sendPermissionPrompt({
          ...prompt,
          chatId: binding.chatId,
          threadId: binding.threadId,
          endpointKey: binding.endpointKey,
          providerContext: this.buildProviderContext(binding),
          promptText: this.buildPermissionPromptText(prompt),
        })
      },
    })

    this.headlessBridge = new HeadlessSessionBridge({
      createSessionService: () => createHeadlessSessionService(),
      getSessionMeta,
      getSessionMessages: (sessionId) => {
        const { getSessionMessages } = require('../session-manager') as typeof import('../session-manager')
        return getSessionMessages(sessionId)
      },
      onPermissionRequest: async (context, request) => {
        await this.permissionBridge.handlePermissionRequest({
          channelType: context.channelType,
          endpointKey: context.endpointKey,
          request,
        })
        this.auditLog.appendPermissionPrompt({
          channelType: context.channelType,
          endpointKey: context.endpointKey,
          sessionId: context.sessionId,
          requestId: request.requestId,
          toolName: request.toolName,
          dangerLevel: request.dangerLevel,
          reason: 'prompt_dispatched',
        })
      },
      onAgentEvent: (context, event) => {
        // 飞书渠道：驱动流式卡片更新
        if (context.channelType !== 'feishu') return
        this.handleFeishuStreamEvent(context, event)
      },
      onStreamEvent: (context, channel, payload) => {
        if (context.channelType !== 'feishu') return
        this.feishuSessionMirror.onStream(channel, payload)
      },
    })

    for (const adapter of Object.values(this.adapters)) {
      adapter.onEvent((event) => {
        void this.handleAdapterEvent(event).catch((error) => {
          this.handleAdapterEventError(event, error)
        })
      })
      adapter.onStatusChanged((status) => {
        this.recordChannelRuntime(status.channel, status)
        if (status.errorMessage) {
          this.auditLog.appendChannelError({
            channelType: status.channel,
            errorMessage: status.errorMessage,
          })
        }
        if (this.running) {
          this.lifecycleRegistry.handleStatusChanged(status.channel, this.resolveLiveConfig(), this.getBridgeSecrets())
        }
        this.emitStatus()
      })
    }

    this.lifecycleRegistry.register({
      channel: 'telegram',
      adapter: this.adapters.telegram,
      isEnabled: (config) => config.telegram.enabled,
      isConfigured: (_config, secrets) => Boolean(secrets.telegram),
    })
    this.lifecycleRegistry.register({
      channel: 'discord',
      adapter: this.adapters.discord,
      isEnabled: (config) => config.discord.enabled,
      isConfigured: (_config, secrets) => Boolean(secrets.discord),
    })
    this.lifecycleRegistry.register({
      channel: 'feishu',
      adapter: this.adapters.feishu,
      isEnabled: (config) => config.feishu.enabled,
      isConfigured: (config) => Boolean((config.feishu.bots ?? []).some((bot) => bot.enabled && bot.appId && bot.appSecret)),
    })
    this.lifecycleRegistry.register({
      channel: 'wechat',
      adapter: this.adapters.wechat,
      isEnabled: (config) => config.wechat.enabled,
      isConfigured: () => true,
    })
  }

  private getBridgeSecrets(): BridgeSecretState {
    return {
      telegram: this.configManager.getDecryptedSecret('telegram'),
      discord: this.configManager.getDecryptedSecret('discord'),
      feishu: this.configManager.getDecryptedSecret('feishu'),
    }
  }

  private get feishuAdapter(): FeishuMultiAdapter {
    return this.adapters.feishu as FeishuMultiAdapter
  }

  private resolveLiveConfig(): BridgeConfig {
    return this.configManager.getConfig()
  }

  private resolveTelegramConfig(): BridgeConfig['telegram'] {
    const config = this.resolveLiveConfig()
    return {
      ...config.telegram,
      botToken: this.configManager.getDecryptedSecret('telegram'),
    }
  }

  private resolveDiscordConfig(): BridgeConfig['discord'] {
    const config = this.resolveLiveConfig()
    return {
      ...config.discord,
      botToken: this.configManager.getDecryptedSecret('discord'),
    }
  }

  private resolveFeishuConfig(): BridgeConfig['feishu'] {
    const config = this.resolveLiveConfig()
    return {
      ...config.feishu,
      appSecret: this.configManager.getDecryptedSecret('feishu'),
    }
  }

  private resolveEffectiveSessionDefaults(
    channelType: BridgeChannelType,
    config: BridgeConfig = this.resolveLiveConfig(),
    session?: SessionMeta,
  ) {
    return resolveEffectiveBridgeSessionDefaults({
      channelType,
      config,
      channels: listChannels(),
      appSettings: getSettings(),
      session,
    })
  }

  private resolveInboundSessionPlan(
    channelType: BridgeChannelType,
    session?: SessionMeta,
    config: BridgeConfig = this.resolveLiveConfig(),
    options?: {
      ignoreSessionSelection?: boolean
    },
  ) {
    return resolveInboundBridgeSessionPlan({
      channelType,
      config,
      channels: listChannels(),
      appSettings: getSettings(),
      session: options?.ignoreSessionSelection ? undefined : session,
      ignoreSessionSelection: options?.ignoreSessionSelection,
    })
  }

  private resolveFeishuBotSessionOverride(botId?: string): BridgeChannelSessionOverride | undefined {
    if (!botId) return undefined
    return this.resolveLiveConfig().feishu.bots?.find((bot) => bot.id === botId)?.defaultSession
  }

  private recordChannelRuntime(channel: BridgeChannelType, status: { lastConnectedAt?: number; errorMessage?: string }): void {
    if (channel === 'wechat') {
      return
    }

    const current = this.configManager.getRuntimeState()
    this.configManager.saveRuntimeState({
      ...current,
      [channel]: {
        ...current[channel],
        lastConnectedAt: status.lastConnectedAt ?? current[channel]?.lastConnectedAt,
        lastError: status.errorMessage,
      },
    })
  }

  private emitStatus(): void {
    const status = this.getStatus()
    for (const handler of this.statusHandlers) {
      handler(status)
    }
  }

  onStatusChanged(handler: (status: BridgeStatus) => void): () => void {
    this.statusHandlers.add(handler)
    return () => {
      this.statusHandlers.delete(handler)
    }
  }

  onWeChatLoginStateChanged(handler: (state: WeChatBridgeLoginState) => void): () => void {
    this.wechatLoginStateHandlers.add(handler)
    return () => {
      this.wechatLoginStateHandlers.delete(handler)
    }
  }

  onWeChatAccountStatusChanged(handler: (status: WeChatBridgeAccountStatus) => void): () => void {
    this.wechatAccountStatusHandlers.add(handler)
    return () => {
      this.wechatAccountStatusHandlers.delete(handler)
    }
  }

  getConfig(): BridgeConfig {
    return this.resolveLiveConfig()
  }

  getSecret(channel: BridgeChannelType): string {
    return this.configManager.getDecryptedSecret(channel)
  }

  listFeishuBots(): FeishuBotConfig[] {
    return this.configManager.listFeishuBots()
  }

  saveFeishuBot(input: FeishuBotConfigInput): FeishuBotConfig {
    const saved = this.configManager.saveFeishuBot(input)
    if (this.running) {
      if (saved.enabled) {
        void this.feishuAdapter.startBot(saved.id).catch(() => {})
      } else {
        this.feishuAdapter.stopBot(saved.id)
      }
    }
    this.emitStatus()
    return saved
  }

  removeFeishuBot(botId: string): boolean {
    this.feishuAdapter.stopBot(botId)
    const removed = this.configManager.removeFeishuBot(botId)
    this.emitStatus()
    return removed
  }

  getFeishuBotSecret(botId: string): string {
    return this.configManager.getDecryptedFeishuBotSecret(botId)
  }

  async testFeishuBot(botId: string): Promise<BridgeTestResult> {
    const bot = this.configManager.listFeishuBots().find((item) => item.id === botId)
    if (!bot) return { channel: 'feishu', success: false, message: '飞书机器人不存在' }
    const secret = this.configManager.getDecryptedFeishuBotSecret(botId)
    return this.feishuAdapter.testBot(bot, secret)
  }

  async startFeishuBot(botId: string): Promise<void> {
    await this.feishuAdapter.startBot(botId)
    this.running = true
    this.emitStatus()
  }

  stopFeishuBot(botId: string): void {
    this.feishuAdapter.stopBot(botId)
    this.emitStatus()
  }

  getFeishuMultiStatus(): FeishuMultiBridgeStatus {
    return this.feishuAdapter.getBotStates()
  }

  listWeChatAccounts(): WeChatBridgeAccountEntry[] {
    return this.wechatAdapter.listAccounts()
  }

  startWeChatLogin(input?: WeChatBridgeStartLoginInput): Promise<WeChatBridgeLoginState> {
    return this.wechatAdapter.startLogin(input)
  }

  refreshWeChatLogin(accountId: string): Promise<WeChatBridgeLoginState> {
    return this.wechatAdapter.refreshLogin(accountId)
  }

  cancelWeChatLogin(accountId: string): void {
    this.wechatAdapter.cancelLogin(accountId)
  }

  removeWeChatAccount(accountId: string): void {
    this.wechatAdapter.removeAccount(accountId)
    this.syncWechatAccountIds()
    this.emitStatus()
  }

  async startWeChatAccount(accountId: string): Promise<WeChatBridgeAccountStatus> {
    const status = await this.wechatAdapter.startAccount(accountId)
    this.emitStatus()
    return status
  }

  stopWeChatAccount(accountId: string): WeChatBridgeAccountStatus {
    const status = this.wechatAdapter.stopAccount(accountId)
    this.emitStatus()
    return status
  }

  reloginWeChatAccount(accountId: string): Promise<WeChatBridgeLoginState> {
    return this.wechatAdapter.reloginAccount(accountId)
  }

  getWeChatLoginState(accountId: string): WeChatBridgeLoginState | null {
    return this.wechatAdapter.getLoginState(accountId)
  }

  private get wechatAdapter(): WeChatAdapterGroup {
    return this.adapters.wechat as WeChatAdapterGroup
  }

  private buildProviderContext(binding: BridgeBinding, fallback?: BridgeProviderContext): BridgeProviderContext | undefined {
    if (binding.channelType !== 'wechat') return undefined
    const accountId = binding.accountId || fallback?.wechat?.accountId
    const peerId = binding.peerId || fallback?.wechat?.peerId || binding.chatId
    if (!accountId || !peerId) return fallback

    return {
      ...fallback,
      wechat: {
        ...fallback?.wechat,
        accountId,
        peerId,
        sessionId: binding.sessionId,
      },
    }
  }

  private buildPermissionPromptText(prompt: {
    channelType: BridgeChannelType
    toolName: string
    description: string
    approvalCode?: string
  }): string {
    if (prompt.channelType === 'wechat') {
      const code = prompt.approvalCode ?? 'CODE'
      return [
        `权限请求：${prompt.toolName}`,
        prompt.description,
        `审批码：${code}`,
        `回复 /allow ${code} 允许一次`,
        `回复 /allow-always ${code} 总是允许`,
        `回复 /deny ${code} 拒绝`,
      ].join('\n')
    }

    return [
      `权限请求：${prompt.toolName}`,
      prompt.description,
      '请选择允许一次 / 总是允许 / 拒绝',
    ].join('\n')
  }

  private syncWechatAccountIds(): void {
    const current = this.resolveLiveConfig()
    this.configManager.saveConfig({
      enabled: current.enabled,
      autoStart: current.autoStart,
      defaultSession: current.defaultSession,
      telegram: { ...current.telegram, botToken: '' },
      discord: { ...current.discord, botToken: '' },
      feishu: { ...current.feishu, appSecret: '' },
      wechat: {
        ...current.wechat,
        accountIds: this.wechatAdapter.listAccounts().map((account) => account.accountId),
      },
    })
  }

  private syncBindingSessionSources(): void {
    for (const binding of this.channelRouter.listBindings()) {
      const session = getSessionMeta(binding.sessionId)
      if (!session) continue

      const label = binding.channelType.toUpperCase()
      if (
        session.messageSource === 'im-bridge'
        && session.messageSourceLabel === label
      ) {
        continue
      }

      updateSessionMeta(binding.sessionId, {
        messageSource: 'im-bridge',
        messageSourceLabel: label,
      })
      broadcastSessionChannel(SESSION_IPC_CHANNELS.UPDATED, {
        sessionId: binding.sessionId,
        reason: 'updated',
      })
    }
  }

  private syncBoundSessionDefaults(previousConfig: BridgeConfig, nextConfig: BridgeConfig): void {
    const bindings = this.channelRouter.listBindings()
    if (bindings.length === 0) {
      return
    }

    const sessions = bindings
      .map((binding) => getSessionMeta(binding.sessionId))
      .filter((session): session is SessionMeta => Boolean(session))

    if (sessions.length === 0) {
      return
    }

    const updates = computeBridgeSessionDefaultsSyncUpdates({
      bindings,
      sessions,
      previousConfig,
      nextConfig,
      channels: listChannels(),
      appSettings: getSettings(),
    })

    for (const update of updates) {
      updateSessionMeta(update.sessionId, {
        channelId: update.channelId,
        modelId: update.modelId,
      })
      broadcastSessionChannel(SESSION_IPC_CHANNELS.UPDATED, {
        sessionId: update.sessionId,
        reason: 'updated',
      })
    }
  }

  async saveConfig(input: BridgeConfigInput): Promise<BridgeConfig> {
    const current = this.resolveLiveConfig()
    const saved = this.configManager.saveConfig(input)
    syncFeishuMirrorSleepBlocker()
    this.syncBoundSessionDefaults(current, saved)
    if (this.running) {
      await this.restart()
    } else if (saved.enabled && saved.autoStart) {
      await this.start()
    } else {
      this.emitStatus()
    }
    return saved
  }

  async testChannel(channel: BridgeChannelType, input?: BridgeConfigInput): Promise<BridgeTestResult> {
    const current = this.resolveLiveConfig()
    const merged = mergeConfig(current, input)
    let connectionResult: BridgeTestResult

    if (channel === 'telegram') {
      const adapter = new TelegramAdapter({
        getConfig: () => ({
          ...merged.telegram,
          botToken: input?.telegram?.botToken?.trim() || this.configManager.getDecryptedSecret('telegram'),
        }),
      })
      connectionResult = await adapter.testConnection()
    } else if (channel === 'discord') {
      const adapter = new DiscordAdapter({
        getConfig: () => ({
          ...merged.discord,
          botToken: input?.discord?.botToken?.trim() || this.configManager.getDecryptedSecret('discord'),
        }),
      })
      connectionResult = await adapter.testConnection()
    } else if (channel === 'feishu') {
      const adapter = new FeishuAdapter({
        getConfig: () => ({
          ...merged.feishu,
          appSecret: input?.feishu?.appSecret?.trim() || this.configManager.getDecryptedSecret('feishu'),
        }),
      })
      connectionResult = await adapter.testConnection()
    } else {
      connectionResult = await this.wechatAdapter.testConnection()
    }

    if (!connectionResult.success) {
      return connectionResult
    }

    const defaultsResult = this.resolveEffectiveSessionDefaults(channel, merged)
    if (!defaultsResult.ok) {
      return {
        channel,
        success: false,
        message: `${connectionResult.message}，但 ${defaultsResult.error}`,
      }
    }

    return {
      channel,
      success: true,
      message: connectionResult.message,
      details: `默认模型：${defaultsResult.channelId} / ${defaultsResult.modelId}`,
    }
  }

  async start(): Promise<void> {
    const config = this.resolveLiveConfig()
    if (!config.enabled) {
      this.running = false
      this.emitStatus()
      return
    }

    this.syncBindingSessionSources()
    this.running = true
    const startedCount = await this.lifecycleRegistry.startEnabled(config, this.getBridgeSecrets())
    this.running = startedCount > 0
    this.emitStatus()
  }

  stop(): void {
    this.running = false
    this.lifecycleRegistry.stopAll()
    this.emitStatus()
  }

  async restart(): Promise<void> {
    this.stop()
    await this.start()
  }

  getStatus(): BridgeStatus {
    const config = this.resolveLiveConfig()
    const lifecycleChannels = this.lifecycleRegistry.getChannelStatuses(config)
    const channels = {
      telegram: { ...createEmptyChannelStatus('telegram', config.telegram.enabled), ...lifecycleChannels.telegram },
      discord: { ...createEmptyChannelStatus('discord', config.discord.enabled), ...lifecycleChannels.discord },
      feishu: { ...createEmptyChannelStatus('feishu', config.feishu.enabled), ...lifecycleChannels.feishu },
      wechat: { ...createEmptyChannelStatus('wechat', config.wechat.enabled), ...lifecycleChannels.wechat },
    }

    return {
      enabled: config.enabled,
      running: this.running,
      activeBindings: this.channelRouter.listBindings().length,
      channels,
      lifecycle: this.lifecycleRegistry.getHealth(config, this.getBridgeSecrets()),
    }
  }

  listBindings(): BridgeBinding[] {
    return this.channelRouter.listBindings()
  }

  updateBinding(input: BridgeBindingUpdateInput): BridgeBinding | null {
    const updated = this.channelRouter.updateBinding(input.endpointKey, input.sessionId)
    this.emitStatus()
    return updated
  }

  updateBindingProjectPath(endpointKey: string, projectPath: string): {
    binding: BridgeBinding
    sessionReplaced: boolean
  } {
    const result = this.channelRouter.updateBindingProjectPath(endpointKey, projectPath)
    this.emitStatus()
    return result
  }

  removeBinding(endpointKey: string): boolean {
    const removed = this.channelRouter.removeBinding(endpointKey)
    this.emitStatus()
    return removed
  }

  async deliverScheduledTaskResult(input: {
    endpointKey: string
    channelType?: BridgeChannelType
    text: string
    sessionId?: string
    taskId: string
    isError?: boolean
  }): Promise<void> {
    const allBindings = this.channelRouter.listBindings()
    let binding = allBindings.find((item) => item.endpointKey === input.endpointKey)
    // 兼容旧版定时任务：旧版 endpointKey 不带 channelType 前缀，尝试补前缀匹配
    if (!binding && input.channelType) {
      const prefixedKey = `${input.channelType}:${input.endpointKey}`
      binding = allBindings.find((item) => item.endpointKey === prefixedKey)
    }
    if (!binding) {
      throw new Error(`找不到 Bridge 绑定: ${input.endpointKey}`)
    }
    if (input.channelType && binding.channelType !== input.channelType) {
      throw new Error(`Bridge 绑定 channel 不匹配: ${input.endpointKey} 是 ${binding.channelType}，不是 ${input.channelType}`)
    }

    if (input.isError) {
      await this.adapters[binding.channelType].sendMessage({
        chatId: binding.chatId,
        threadId: binding.threadId,
        endpointKey: binding.endpointKey,
        text: input.text,
        deliveryKind: 'system',
        providerContext: this.buildProviderContext(binding),
      })
      this.auditLog.appendOutboundMessage({
        channelType: binding.channelType,
        endpointKey: input.endpointKey,
        sessionId: input.sessionId ?? binding.sessionId,
        chatId: binding.chatId,
        threadId: binding.threadId,
        text: input.text,
        deliveryKind: 'system',
        reason: `scheduled_task:${input.taskId}`,
      })
      return
    }

    await this.sendFinalReply(
      binding.channelType,
      binding,
      input.endpointKey,
      input.text,
      `scheduled_task:${input.taskId}`,
    )
  }

  /** 飞书流式卡片事件管理：按 endpointKey 维护 RunState，驱动 CardStream */
  private readonly feishuRunStates = new Map<string, RunState>()
  private readonly feishuStreamReplyStates = new Map<string, {
    opened: boolean
    openPromise?: Promise<boolean>
  }>()

  private handleFeishuStreamEvent(
    context: { sessionId: string; channelType: BridgeChannelType; endpointKey: string },
    event: AgentEvent,
  ): void {
    const adapter = this.feishuAdapter

    // 首个事件（text_delta / tool_start / model_resolved）→ 创建流式卡片
    if (!this.feishuRunStates.has(context.endpointKey)) {
      if (event.type === 'text_delta' || event.type === 'tool_start' || event.type === 'model_resolved') {
        const modelName = event.type === 'model_resolved' ? event.model : undefined
        const state = createInitialState(modelName)
        this.feishuRunStates.set(context.endpointKey, state)

        // 查找 chatId
        const binding = this.channelRouter.listBindings().find((b) => b.endpointKey === context.endpointKey)
        if (binding) {
          const replyToId = adapter.getLastInboundMessageId(binding.endpointKey, binding.chatId)
          const streamReplyState = { opened: false } as {
            opened: boolean
            openPromise?: Promise<boolean>
          }
          streamReplyState.openPromise = adapter.openStreamCard(binding.endpointKey, binding.chatId, modelName, replyToId)
            .then((stream) => {
              streamReplyState.opened = Boolean(stream)
              return streamReplyState.opened
            })
            .catch(() => false)
          this.feishuStreamReplyStates.set(context.endpointKey, streamReplyState)
        }
      }
      return
    }

    // 更新 RunState
    let state = this.feishuRunStates.get(context.endpointKey)!
    state = reduceRunState(state, event)
    this.feishuRunStates.set(context.endpointKey, state)

    // 终态 → flush 并清理
    if (state.terminal !== 'running') {
      const binding = this.channelRouter.listBindings().find((b) => b.endpointKey === context.endpointKey)
      if (binding) {
        void adapter.closeStreamCard(binding.endpointKey, binding.chatId, state).catch(() => {})
      }
      this.feishuRunStates.delete(context.endpointKey)
      return
    }

    // 非终态 → 节流更新卡片
    const binding = this.channelRouter.listBindings().find((b) => b.endpointKey === context.endpointKey)
    if (binding) {
      adapter.updateStreamCard(binding.endpointKey, binding.chatId, state).catch(() => {})
    }
  }

  private async consumeFeishuStreamReply(endpointKey: string): Promise<boolean> {
    const state = this.feishuStreamReplyStates.get(endpointKey)
    if (!state) return false

    try {
      if (state.openPromise) {
        state.opened = (await state.openPromise) || state.opened
      }
      return state.opened
    } finally {
      this.feishuStreamReplyStates.delete(endpointKey)
    }
  }

  private async handleAdapterEvent(event: BridgeAdapterEvent): Promise<void> {
    if (event.type === 'permission_action') {
      const result = this.permissionBridge.resolveAction(event.action)
      this.auditLog.appendPermissionAction({
        channelType: event.action.channelType,
        endpointKey: event.action.endpointKey,
        sessionId: result.sessionId,
        chatId: event.action.chatId,
        threadId: event.action.threadId,
        behavior: event.action.behavior,
        alwaysAllow: event.action.alwaysAllow,
        ok: result.ok,
        reason: result.message,
      })
      if (!result.ok) {
        await this.adapters[event.action.channelType].sendMessage({
          chatId: event.action.chatId,
          threadId: event.action.threadId,
          endpointKey: event.action.endpointKey,
          text: result.message,
          deliveryKind: 'system',
        })
      }
      return
    }

    await this.handleInboundMessage(event.message)
  }

  private handleAdapterEventError(event: BridgeAdapterEvent, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const channelType = event.type === 'message' ? event.message.channelType : event.action.channelType
    const endpointKey = event.type === 'message' ? event.message.endpointKey : event.action.endpointKey
    const chatId = event.type === 'message' ? event.message.chatId : event.action.chatId
    const threadId = event.type === 'message' ? event.message.threadId : event.action.threadId

    log.error('[IM Bridge] 处理入站事件失败', error)
    this.auditLog.appendChannelError({
      channelType,
      endpointKey,
      chatId,
      threadId,
      errorMessage,
    })

    if (event.type !== 'message') return

    void this.adapters[channelType].sendMessage({
      chatId,
      threadId,
      endpointKey,
      text: `远程渠道处理失败：${errorMessage}`,
      deliveryKind: 'system',
      providerContext: event.message.providerContext,
    }).catch((sendError) => {
      log.error('[IM Bridge] 发送入站失败提示失败', sendError)
    })
  }

  private async handleInboundMessage(message: BridgeInboundMessage): Promise<void> {
    if (!hasUsableInboundContent(message)) {
      return
    }

    if (!this.rateLimiter.allow(message.endpointKey)) {
      await this.adapters[message.channelType].sendMessage({
        chatId: message.chatId,
        threadId: message.threadId,
        endpointKey: message.endpointKey,
        text: '消息过于频繁，请稍后重试。',
        deliveryKind: 'system',
        providerContext: message.providerContext,
      })
      this.auditLog.appendOutboundMessage({
        channelType: message.channelType,
        endpointKey: message.endpointKey,
        chatId: message.chatId,
        threadId: message.threadId,
        text: '消息过于频繁，请稍后重试。',
        deliveryKind: 'system',
        reason: 'rate_limited',
      })
      return
    }

    const maxInboundFileBytes = message.channelType === 'telegram'
      ? this.resolveTelegramConfig().maxInboundFileBytes
      : message.channelType === 'discord'
        ? this.resolveDiscordConfig().maxInboundFileBytes
        : Number.MAX_SAFE_INTEGER
    const oversizedAttachment = message.attachments.find((attachment) => attachment.size > maxInboundFileBytes)
    if (oversizedAttachment) {
      await this.adapters[message.channelType].sendMessage({
        chatId: message.chatId,
        threadId: message.threadId,
        endpointKey: message.endpointKey,
        text: `附件过大，已拒绝接收：${oversizedAttachment.filename}`,
        deliveryKind: 'system',
        providerContext: message.providerContext,
      })
      this.auditLog.appendOutboundMessage({
        channelType: message.channelType,
        endpointKey: message.endpointKey,
        chatId: message.chatId,
        threadId: message.threadId,
        text: `附件过大，已拒绝接收：${oversizedAttachment.filename}`,
        deliveryKind: 'system',
        reason: 'oversized_attachment',
      })
      return
    }

    const binding = this.channelRouter.resolveOrCreateBinding({
      channelType: message.channelType,
      endpointKey: message.endpointKey,
      chatId: message.chatId,
      threadId: message.threadId,
      userId: message.userId,
      accountId: message.providerContext?.wechat?.accountId,
      peerId: message.providerContext?.wechat?.peerId,
      peerType: message.channelType === 'wechat' ? 'user' : undefined,
      displayName: message.displayName,
    })

    this.auditLog.appendInboundMessage({
      channelType: message.channelType,
      endpointKey: message.endpointKey,
      sessionId: binding.sessionId,
      chatId: message.chatId,
      threadId: message.threadId,
      userId: message.userId,
      messageId: message.messageId,
      text: message.text,
      attachments: message.attachments,
    })

    if (message.channelType === 'wechat') {
      const action = parseWeChatTextApproval(message.text)
      if (action) {
        const result = this.permissionBridge.resolveTextApproval({
          endpointKey: message.endpointKey,
          approvalCode: action.approvalCode,
          behavior: action.behavior,
          alwaysAllow: action.alwaysAllow,
        })
        await this.adapters.wechat.sendMessage({
          chatId: binding.chatId,
          threadId: binding.threadId,
          endpointKey: message.endpointKey,
          text: result.message,
          deliveryKind: 'system',
          providerContext: this.buildProviderContext(binding, message.providerContext),
        })
        this.auditLog.appendPermissionAction({
          channelType: message.channelType,
          endpointKey: message.endpointKey,
          sessionId: result.sessionId,
          chatId: binding.chatId,
          threadId: binding.threadId,
          behavior: action.behavior,
          alwaysAllow: action.alwaysAllow,
          ok: result.ok,
          reason: result.message,
        })
        return
      }
    }

    if (isAgentSessionActive(binding.sessionId)) {
      await this.adapters[message.channelType].sendMessage({
        chatId: binding.chatId,
        threadId: binding.threadId,
        endpointKey: message.endpointKey,
        text: '当前会话正在运行，请稍后再试。',
        deliveryKind: 'system',
        providerContext: this.buildProviderContext(binding, message.providerContext),
      })
      this.auditLog.appendOutboundMessage({
        channelType: message.channelType,
        endpointKey: message.endpointKey,
        sessionId: binding.sessionId,
        chatId: binding.chatId,
        threadId: binding.threadId,
        text: '当前会话正在运行，请稍后再试。',
        deliveryKind: 'system',
        reason: 'session_busy',
      })
      return
    }

    const attachments = await this.adapters[message.channelType].downloadAttachments(message.attachments, binding.sessionId)
    const userMessage = buildInboundUserMessage(message)
    const session = getSessionMeta(binding.sessionId)
    const botSessionOverride = message.channelType === 'feishu'
      ? this.resolveFeishuBotSessionOverride(message.botId)
      : undefined
    const effectiveConfig = botSessionOverride
      ? {
          ...this.resolveLiveConfig(),
          feishu: {
            ...this.resolveLiveConfig().feishu,
            defaultSession: {
              ...this.resolveLiveConfig().feishu.defaultSession,
              ...botSessionOverride,
            },
          },
        }
      : this.resolveLiveConfig()
    const defaultsResult = this.resolveInboundSessionPlan(
      message.channelType,
      session,
      effectiveConfig,
      { ignoreSessionSelection: message.channelType === 'feishu' },
    )

    if (!defaultsResult.ok) {
      await this.adapters[message.channelType].sendMessage({
        chatId: binding.chatId,
        threadId: binding.threadId,
        endpointKey: message.endpointKey,
        text: defaultsResult.error,
        deliveryKind: 'system',
        providerContext: this.buildProviderContext(binding, message.providerContext),
      })
      this.auditLog.appendOutboundMessage({
        channelType: message.channelType,
        endpointKey: message.endpointKey,
        sessionId: binding.sessionId,
        chatId: binding.chatId,
        threadId: binding.threadId,
        text: defaultsResult.error,
        deliveryKind: 'system',
        reason: 'default_model_resolution_failed',
      })
      return
    }

    // 将 config 层解析出的最新默认模型同步到 session 元数据，确保 UI 一致
    if (session && defaultsResult.shouldSyncSessionMeta) {
      updateSessionMeta(binding.sessionId, {
        channelId: defaultsResult.channelId,
        modelId: defaultsResult.modelId,
      })
      broadcastSessionChannel(SESSION_IPC_CHANNELS.UPDATED, {
        sessionId: binding.sessionId,
        reason: 'updated',
      })
    }

    const result = await this.headlessBridge.sendMessage({
      sessionId: binding.sessionId,
      channelType: message.channelType,
      endpointKey: message.endpointKey,
      userMessage,
      attachments,
      overrides: {
        channelId: defaultsResult.channelId,
        modelId: defaultsResult.modelId,
        ...(message.channelType === 'feishu'
          ? { permissionModeOverride: 'auto' as const }
          : {}),
      },
    })

    if (!result.ok) {
      await this.adapters[message.channelType].sendMessage({
        chatId: binding.chatId,
        threadId: binding.threadId,
        endpointKey: message.endpointKey,
        text: result.error,
        deliveryKind: 'system',
        providerContext: this.buildProviderContext(binding, message.providerContext),
      })
      this.auditLog.appendOutboundMessage({
        channelType: message.channelType,
        endpointKey: message.endpointKey,
        sessionId: binding.sessionId,
        chatId: binding.chatId,
        threadId: binding.threadId,
        text: result.error,
        deliveryKind: 'system',
        reason: 'session_stream_error',
      })
      return
    }

    if (!result.finalReply.trim()) {
      await this.adapters[message.channelType].sendMessage({
        chatId: binding.chatId,
        threadId: binding.threadId,
        endpointKey: message.endpointKey,
        text: '任务已完成，但没有可发送的最终文本回复。',
        deliveryKind: 'system',
        providerContext: this.buildProviderContext(binding, message.providerContext),
      })
      this.auditLog.appendOutboundMessage({
        channelType: message.channelType,
        endpointKey: message.endpointKey,
        sessionId: binding.sessionId,
        chatId: binding.chatId,
        threadId: binding.threadId,
        text: '任务已完成，但没有可发送的最终文本回复。',
        deliveryKind: 'system',
        reason: 'empty_final_reply',
      })
      return
    }

    if (message.channelType === 'feishu' && await this.consumeFeishuStreamReply(message.endpointKey)) {
      this.auditLog.appendOutboundMessage({
        channelType: message.channelType,
        endpointKey: message.endpointKey,
        sessionId: binding.sessionId,
        chatId: binding.chatId,
        threadId: binding.threadId,
        text: result.finalReply,
        deliveryKind: 'assistant',
        chunkCount: 1,
        reason: 'final_reply_stream_card',
      })
      return
    }

    await this.sendFinalReply(message.channelType, binding, message.endpointKey, result.finalReply)
  }

  private async sendFinalReply(
    channelType: BridgeChannelType,
    binding: BridgeBinding,
    endpointKey: string,
    text: string,
    reason = 'final_reply',
  ): Promise<void> {
    const adapter = this.adapters[channelType]
    const chunks = chunkOutboundMessage({ channelType, text })

    for (const chunk of chunks) {
      try {
        await adapter.sendMessage({
          chatId: binding.chatId,
          threadId: binding.threadId,
          endpointKey,
          text: chunk.text,
          parseMode: chunk.parseMode,
          deliveryKind: 'assistant',
          providerContext: this.buildProviderContext(binding),
        })
      } catch (error) {
        if (channelType !== 'telegram') {
          throw error
        }

        const fallback = renderTelegramOutbound(text).fallback.text
        const fallbackChunks = chunkOutboundMessage({ channelType: 'discord', text: fallback })
        for (const fallbackChunk of fallbackChunks) {
          await adapter.sendMessage({
            chatId: binding.chatId,
            threadId: binding.threadId,
            endpointKey,
            text: fallbackChunk.text,
            deliveryKind: 'assistant',
            providerContext: this.buildProviderContext(binding),
          })
        }
        this.auditLog.appendOutboundMessage({
          channelType,
          endpointKey,
          sessionId: binding.sessionId,
          chatId: binding.chatId,
          threadId: binding.threadId,
          text: fallback,
          deliveryKind: 'assistant',
          chunkCount: fallbackChunks.length,
          reason: `${reason}:telegram_html_fallback`,
        })
        return
      }
    }

    this.auditLog.appendOutboundMessage({
      channelType,
      endpointKey,
      sessionId: binding.sessionId,
      chatId: binding.chatId,
      threadId: binding.threadId,
      text,
      deliveryKind: 'assistant',
      chunkCount: chunks.length,
      reason,
    })
  }
}

export const bridgeManager = new BridgeManager()
