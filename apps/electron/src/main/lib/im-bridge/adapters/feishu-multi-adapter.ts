import type {
  BridgeChannelStatus,
  BridgeTestResult,
  FeishuBotBridgeStatus,
  FeishuBotConfig,
  FeishuBridgeConfig,
  FeishuMultiBridgeStatus,
  FileAttachment,
} from '@kila/shared'
import { BaseImAdapter } from './base-adapter'
import type {
  BridgeAdapterEvent,
  BridgeAttachmentReference,
  BridgeOutboundMessage,
  BridgePermissionPromptMessage,
} from './base-adapter'
import { FeishuAdapter } from './feishu-adapter'

interface FeishuMultiAdapterDeps {
  getConfig: () => FeishuBridgeConfig
  getBotSecret: (botId: string) => string
}

function splitEndpointKey(endpointKey?: string): { botId?: string } {
  const parts = endpointKey?.split(':') ?? []
  if (parts.length >= 3 && parts[0] === 'feishu') {
    return { botId: parts[1] }
  }
  return {}
}

export class FeishuMultiAdapter extends BaseImAdapter {
  readonly channelType = 'feishu' as const
  private readonly adapters = new Map<string, FeishuAdapter>()
  private readonly unsubs = new Map<string, Array<() => void>>()

  constructor(private readonly deps: FeishuMultiAdapterDeps) {
    super('feishu')
  }

  private get config(): FeishuBridgeConfig {
    return this.deps.getConfig()
  }

  private get bots(): FeishuBotConfig[] {
    return this.config.bots ?? []
  }

  getBotStates(): FeishuMultiBridgeStatus {
    const bots: Record<string, FeishuBotBridgeStatus> = {}
    for (const bot of this.bots) {
      const adapter = this.adapters.get(bot.id)
      const status = adapter?.getStatus() ?? {
        channel: 'feishu' as const,
        enabled: bot.enabled,
        status: 'disconnected' as const,
      }
      bots[bot.id] = {
        ...status,
        botId: bot.id,
        botName: bot.name,
      }
    }
    return { bots }
  }

  async start(): Promise<void> {
    const enabledBots = this.bots.filter((bot) => bot.enabled && bot.appId && bot.appSecret)
    if (enabledBots.length === 0) {
      this.updateStatus({ enabled: this.config.enabled, status: 'disconnected', errorMessage: undefined })
      return
    }

    const results = await Promise.allSettled(enabledBots.map((bot) => this.startBot(bot.id)))
    const failed = results.filter((result) => result.status === 'rejected')
    const connected = [...this.adapters.values()].filter((adapter) => adapter.getStatus().status === 'connected')

    this.updateStatus({
      enabled: this.config.enabled,
      status: connected.length > 0 ? 'connected' : 'error',
      connectedAt: connected.length > 0 ? Date.now() : undefined,
      lastConnectedAt: connected.length > 0 ? Date.now() : undefined,
      errorMessage: connected.length > 0 ? undefined : (failed[0] as PromiseRejectedResult | undefined)?.reason?.message,
    })

    if (connected.length === 0 && failed.length > 0) {
      throw new Error((failed[0] as PromiseRejectedResult).reason?.message ?? '飞书 Bot 启动失败')
    }
  }

  stop(): void {
    for (const botId of [...this.adapters.keys()]) {
      this.stopBot(botId)
    }
    this.updateStatus({ enabled: this.config.enabled, status: 'disconnected', errorMessage: undefined })
  }

  async startBot(botId: string): Promise<void> {
    const bot = this.bots.find((item) => item.id === botId)
    if (!bot) throw new Error(`飞书 Bot 不存在: ${botId}`)
    if (!bot.enabled) throw new Error(`飞书 Bot 未启用: ${bot.name}`)

    this.stopBot(botId)
    const adapter = new FeishuAdapter({
      botId: bot.id,
      botName: bot.name,
      getConfig: () => ({
        ...this.config,
        appId: bot.appId,
        appSecret: this.deps.getBotSecret(bot.id),
        defaultSession: bot.defaultSession ?? this.config.defaultSession,
      }),
    })
    const unsubs = [
      adapter.onEvent((event) => this.emit(event)),
      adapter.onStatusChanged(() => {
        this.updateAggregateStatus()
      }),
    ]
    this.adapters.set(botId, adapter)
    this.unsubs.set(botId, unsubs)
    await adapter.start()
    this.updateAggregateStatus()
  }

  stopBot(botId: string): void {
    const adapter = this.adapters.get(botId)
    if (adapter) adapter.stop()
    for (const unsub of this.unsubs.get(botId) ?? []) unsub()
    this.unsubs.delete(botId)
    this.adapters.delete(botId)
    this.updateAggregateStatus()
  }

  private updateAggregateStatus(): void {
    const statuses = [...this.adapters.values()].map((adapter) => adapter.getStatus())
    const connected = statuses.filter((status) => status.status === 'connected')
    const connecting = statuses.some((status) => status.status === 'connecting')
    const errored = statuses.find((status) => status.status === 'error')
    const status: BridgeChannelStatus['status'] = connected.length > 0
      ? 'connected'
      : connecting
        ? 'connecting'
        : errored
          ? 'error'
          : 'disconnected'
    this.updateStatus({
      enabled: this.config.enabled,
      status,
      connectedAt: connected[0]?.connectedAt,
      lastConnectedAt: connected[0]?.lastConnectedAt,
      errorMessage: status === 'error' ? errored?.errorMessage : undefined,
    })
  }

  private resolveAdapter(input: { endpointKey?: string; chatId?: string }): FeishuAdapter {
    const { botId } = splitEndpointKey(input.endpointKey)
    if (botId) {
      const adapter = this.adapters.get(botId)
      if (adapter) return adapter
    }
    if (this.adapters.size === 1) return [...this.adapters.values()][0]!
    throw new Error(`无法定位飞书 Bot: ${input.endpointKey ?? input.chatId ?? 'unknown'}`)
  }

  getLastInboundMessageId(endpointKey: string, chatId: string): string | undefined {
    return this.resolveAdapter({ endpointKey, chatId }).getLastInboundMessageId(chatId)
  }

  async openStreamCard(endpointKey: string, chatId: string, modelName?: string, replyToMessageId?: string) {
    return this.resolveAdapter({ endpointKey, chatId }).openStreamCard(chatId, modelName, replyToMessageId)
  }

  async updateStreamCard(endpointKey: string, chatId: string, state: Parameters<FeishuAdapter['updateStreamCard']>[1]): Promise<void> {
    await this.resolveAdapter({ endpointKey, chatId }).updateStreamCard(chatId, state)
  }

  async closeStreamCard(endpointKey: string, chatId: string, state?: Parameters<FeishuAdapter['closeStreamCard']>[1]): Promise<void> {
    await this.resolveAdapter({ endpointKey, chatId }).closeStreamCard(chatId, state)
  }

  async sendMessage(input: BridgeOutboundMessage): Promise<void> {
    await this.resolveAdapter(input).sendMessage(input)
  }

  async sendPermissionPrompt(input: BridgePermissionPromptMessage): Promise<void> {
    await this.resolveAdapter(input).sendPermissionPrompt(input)
  }

  async testConnection(): Promise<BridgeTestResult> {
    const bot = this.bots.find((item) => item.enabled && item.appId && item.appSecret) ?? this.bots[0]
    if (!bot) return { channel: 'feishu', success: false, message: '还没有配置飞书 Bot' }
    const adapter = new FeishuAdapter({
      botId: bot.id,
      botName: bot.name,
      getConfig: () => ({
        ...this.config,
        appId: bot.appId,
        appSecret: this.deps.getBotSecret(bot.id),
      }),
    })
    return adapter.testConnection()
  }

  async testBot(bot: FeishuBotConfig, plainSecret: string): Promise<BridgeTestResult> {
    const adapter = new FeishuAdapter({
      botId: bot.id,
      botName: bot.name,
      getConfig: () => ({
        ...this.config,
        appId: bot.appId,
        appSecret: plainSecret,
      }),
    })
    return adapter.testConnection()
  }

  async downloadAttachments(attachments: BridgeAttachmentReference[], sessionId: string): Promise<FileAttachment[]> {
    if (attachments.length === 0) return []
    if (this.adapters.size === 1) {
      return [...this.adapters.values()][0]!.downloadAttachments(attachments, sessionId)
    }
    throw new Error('多 Bot 模式下暂无法定位飞书附件所属 Bot，请重新发送文本消息或减少同时在线 Bot')
  }

  getAdapter(botId: string): FeishuAdapter | undefined {
    return this.adapters.get(botId)
  }
}
