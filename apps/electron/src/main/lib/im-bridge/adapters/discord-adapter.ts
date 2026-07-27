import type {
  BridgeAdapterCapabilities,
  BridgeRuntimeState,
  DiscordBridgeConfig,
  DiscordBridgeRuntimeState,
  FileAttachment,
} from '@kila/shared'
import type { BridgeTestResult } from '@kila/shared'
import { BaseImAdapter } from './base-adapter'
import type { BridgeAttachmentReference, BridgeOutboundMessage, BridgePermissionPromptMessage } from './base-adapter'
import { downloadDiscordAttachments } from './discord-files'
import { DISCORD_CAPABILITIES } from './adapter-capabilities'
import type {
  BridgeWebSocket,
  DiscordDispatchData,
  DiscordGatewayPayload,
  DiscordHelloData,
} from './discord-gateway-types'
import { createLogger } from '../../logger'

const log = createLogger('IM Bridge')

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

interface DiscordAdapterDeps {
  getConfig: () => DiscordBridgeConfig
  getRuntimeState?: () => BridgeRuntimeState | undefined
  saveRuntimeState?: (nextState: BridgeRuntimeState) => void
  fetchImpl?: FetchLike
  webSocketFactory?: (url: string) => BridgeWebSocket
  setTimeoutImpl?: typeof setTimeout
  clearTimeoutImpl?: typeof clearTimeout
  setIntervalImpl?: typeof setInterval
  clearIntervalImpl?: typeof clearInterval
  now?: () => number
  randomJitter?: () => number
}

function parseCustomId(customId: string | undefined): { behavior: 'allow' | 'deny'; callbackToken: string; alwaysAllow: boolean } | null {
  if (!customId) return null
  const [prefix, behavior, callbackToken, mode] = customId.split('|')
  if (prefix !== 'imbridge') return null
  if (behavior !== 'allow' && behavior !== 'deny') return null
  if (!callbackToken) return null

  return {
    behavior,
    callbackToken,
    alwaysAllow: mode === 'always',
  }
}

async function assertDiscordResponseOk(response: Response, context: string): Promise<void> {
  if (response.ok) return

  let detail = response.statusText.trim()
  try {
    const payload = await response.json() as { message?: string }
    if (typeof payload.message === 'string' && payload.message.trim()) {
      detail = payload.message.trim()
    }
  } catch {
    // Ignore parse errors and fall back to status text.
  }

  throw new Error(detail
    ? `${context}失败 (${response.status}: ${detail})`
    : `${context}失败 (${response.status})`)
}

const DEFAULT_HEARTBEAT_TIMEOUT_MS = 15_000
const MAX_RECONNECT_DELAY_MS = 30_000
/** lastSequence 落盘节流窗口：每条事件同步写盘会把主进程 IO 打满 */
const SEQUENCE_FLUSH_INTERVAL_MS = 30_000

export class DiscordAdapter extends BaseImAdapter {
  readonly channelType = 'discord' as const
  readonly capabilities: BridgeAdapterCapabilities = DISCORD_CAPABILITIES
  private readonly fetchImpl: FetchLike
  private readonly webSocketFactory: (url: string) => BridgeWebSocket
  private readonly getRuntimeState: () => BridgeRuntimeState | undefined
  private readonly saveRuntimeState: (nextState: BridgeRuntimeState) => void
  private readonly setTimeoutImpl: typeof setTimeout
  private readonly clearTimeoutImpl: typeof clearTimeout
  private readonly setIntervalImpl: typeof setInterval
  private readonly clearIntervalImpl: typeof clearInterval
  private readonly now: () => number
  private readonly randomJitter: () => number

  private socket: BridgeWebSocket | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private gatewayUrl: string | null = null
  private botUserId: string | null = null
  private shouldReconnect = false
  private reconnectAttempts = 0
  private heartbeatIntervalMs = 0
  private lastHeartbeatSentAt = 0
  private lastHeartbeatAckAt = 0
  private awaitingHeartbeatAck = false
  private pendingSequence: number | null = null
  private lastSequenceFlushedAt = 0

  constructor(private readonly deps: DiscordAdapterDeps) {
    super('discord')
    this.fetchImpl = deps.fetchImpl ?? fetch
    this.webSocketFactory = deps.webSocketFactory ?? ((url) => {
      const WebSocketCtor = globalThis.WebSocket
      if (!WebSocketCtor) {
        throw new Error('当前运行时不支持 WebSocket，无法启动 Discord 桥接')
      }
      return new WebSocketCtor(url) as unknown as BridgeWebSocket
    })
    this.getRuntimeState = deps.getRuntimeState ?? (() => undefined)
    this.saveRuntimeState = deps.saveRuntimeState ?? (() => {})
    this.setTimeoutImpl = deps.setTimeoutImpl ?? setTimeout
    this.clearTimeoutImpl = deps.clearTimeoutImpl ?? clearTimeout
    this.setIntervalImpl = deps.setIntervalImpl ?? setInterval
    this.clearIntervalImpl = deps.clearIntervalImpl ?? clearInterval
    this.now = deps.now ?? (() => Date.now())
    this.randomJitter = deps.randomJitter ?? (() => (Math.random() * 0.4) - 0.2)
  }

  private get config(): DiscordBridgeConfig {
    return this.deps.getConfig()
  }

  private readPersistedRuntime(): BridgeRuntimeState {
    return this.getRuntimeState() ?? {}
  }

  private readRuntimeState(): DiscordBridgeRuntimeState {
    const persisted = this.readPersistedRuntime().discord ?? {}
    // 内存中的 sequence 更新，落盘则是节流的
    return this.pendingSequence === null
      ? persisted
      : { ...persisted, lastSequence: this.pendingSequence }
  }

  /** 记录网关 sequence：内存即时更新，落盘按 30s 节流，避免每条事件同步写文件 */
  private recordSequence(sequence: number): void {
    this.pendingSequence = sequence
    if ((this.now() - this.lastSequenceFlushedAt) < SEQUENCE_FLUSH_INTERVAL_MS) return
    this.flushSequence()
  }

  /** 断线、重连、停止等关键节点强制落盘，保证 resume 不丢 sequence */
  private flushSequence(): void {
    if (this.pendingSequence === null) return
    const sequence = this.pendingSequence
    this.pendingSequence = null
    this.lastSequenceFlushedAt = this.now()
    this.patchRuntimeState({ lastSequence: sequence })
  }

  private writeRuntimeState(nextState: DiscordBridgeRuntimeState): void {
    const current = this.readPersistedRuntime()
    this.saveRuntimeState({
      ...current,
      discord: nextState,
    })
  }

  private patchRuntimeState(patch: Partial<DiscordBridgeRuntimeState>): DiscordBridgeRuntimeState {
    const nextState = {
      ...this.readRuntimeState(),
      ...patch,
    }
    this.writeRuntimeState(nextState)
    return nextState
  }

  private clearResumeState(): DiscordBridgeRuntimeState {
    this.pendingSequence = null
    const current = this.readRuntimeState()
    const nextState: DiscordBridgeRuntimeState = {
      ...current,
      sessionId: undefined,
      resumeGatewayUrl: undefined,
      lastSequence: undefined,
    }
    this.writeRuntimeState(nextState)
    return nextState
  }

  private canResume(): boolean {
    const runtime = this.readRuntimeState()
    return Boolean(runtime.sessionId && runtime.resumeGatewayUrl && typeof runtime.lastSequence === 'number')
  }

  private get headers(): HeadersInit {
    return {
      Authorization: `Bot ${this.config.botToken}`,
      'Content-Type': 'application/json',
    }
  }

  setBotUserId(userId: string): void {
    this.botUserId = userId
  }

  async testConnection(): Promise<BridgeTestResult> {
    const token = this.config.botToken.trim()
    if (!token) {
      return { channel: 'discord', success: false, message: '缺少 Discord 机器人令牌' }
    }

    const response = await this.fetchImpl('https://discord.com/api/v10/users/@me', {
      headers: this.headers,
    })

    if (!response.ok) {
      return { channel: 'discord', success: false, message: `Discord 连接失败 (${response.status})` }
    }

    const payload = await response.json() as { username?: string }
    return {
      channel: 'discord',
      success: true,
      message: `Discord 机器人已连接 ${payload.username ?? 'bot'}`,
    }
  }

  private async getGatewayUrl(): Promise<string> {
    if (this.gatewayUrl) return this.gatewayUrl

    const response = await this.fetchImpl('https://discord.com/api/v10/gateway/bot', {
      headers: this.headers,
    })
    const payload = await response.json() as { url?: string }
    if (!payload.url) {
      throw new Error('无法获取 Discord 网关地址')
    }

    this.gatewayUrl = `${payload.url}?v=10&encoding=json`
    return this.gatewayUrl
  }

  async start(): Promise<void> {
    const result = await this.testConnection()
    if (!result.success) {
      this.updateStatus({
        enabled: this.config.enabled,
        status: 'error',
        errorMessage: result.message,
      })
      this.patchRuntimeState({ lastError: result.message })
      throw new Error(result.message)
    }

    this.shouldReconnect = true
    this.reconnectAttempts = 0
    this.updateStatus({
      enabled: this.config.enabled,
      status: 'connecting',
      errorMessage: undefined,
    })
    this.patchRuntimeState({ lastError: undefined })
    await this.connectGateway()
  }

  stop(): void {
    this.shouldReconnect = false
    if (this.heartbeatTimer) this.clearIntervalImpl(this.heartbeatTimer)
    if (this.reconnectTimer) this.clearTimeoutImpl(this.reconnectTimer)
    this.heartbeatTimer = null
    this.reconnectTimer = null
    this.awaitingHeartbeatAck = false
    this.heartbeatIntervalMs = 0
    this.flushSequence()
    this.socket?.close()
    this.socket = null
    this.updateStatus({
      enabled: this.config.enabled,
      status: 'disconnected',
      errorMessage: undefined,
    })
  }

  private async connectGateway(): Promise<void> {
    const runtime = this.readRuntimeState()
    const preferredUrl = this.canResume()
      ? runtime.resumeGatewayUrl
      : await this.getGatewayUrl()
    const url = preferredUrl ?? await this.getGatewayUrl()

    this.socket = this.webSocketFactory(url)
    this.socket.addEventListener('message', (event) => {
      // 单帧异常不得在主进程抛未捕获异常，否则一条畸形帧就能拖垮整个 Electron 主进程
      try {
        const raw = typeof event.data === 'string' ? event.data : String(event.data)
        this.handleGatewayPayload(JSON.parse(raw))
      } catch (error) {
        log.error('[IM Bridge][Discord] 网关帧解析失败，已跳过该帧', error)
      }
    })
    this.socket.addEventListener('close', () => {
      if (this.heartbeatTimer) this.clearIntervalImpl(this.heartbeatTimer)
      this.heartbeatTimer = null
      this.awaitingHeartbeatAck = false
      this.socket = null
      this.flushSequence()

      if (this.shouldReconnect) {
        this.scheduleReconnect()
        return
      }

      this.updateStatus({
        enabled: this.config.enabled,
        status: 'disconnected',
        errorMessage: undefined,
      })
    })
  }

  private scheduleReconnect(forcedDelayMs?: number): void {
    if (!this.shouldReconnect) return
    if (this.reconnectTimer) return

    const baseDelay = forcedDelayMs ?? Math.min(MAX_RECONNECT_DELAY_MS, 1000 * (2 ** this.reconnectAttempts))
    const delay = Math.max(250, Math.round(baseDelay * (1 + this.randomJitter())))
    this.reconnectAttempts += 1
    this.updateStatus({
      enabled: this.config.enabled,
      status: 'connecting',
    })

    this.reconnectTimer = this.setTimeoutImpl(() => {
      this.reconnectTimer = null
      void this.connectGateway().catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        this.updateStatus({
          enabled: this.config.enabled,
          status: 'error',
          errorMessage: message,
        })
        this.patchRuntimeState({ lastError: message })
        this.scheduleReconnect()
      })
    }, delay)
  }

  private sendGateway(payload: Record<string, unknown>): void {
    this.socket?.send(JSON.stringify(payload))
  }

  private sendHeartbeat(): void {
    this.lastHeartbeatSentAt = this.now()
    this.awaitingHeartbeatAck = true
    this.sendGateway({
      op: 1,
      d: this.readRuntimeState().lastSequence ?? null,
    })
  }

  private startHeartbeatLoop(intervalMs: number): void {
    if (this.heartbeatTimer) this.clearIntervalImpl(this.heartbeatTimer)
    this.heartbeatIntervalMs = intervalMs
    this.lastHeartbeatAckAt = this.now()
    this.awaitingHeartbeatAck = false
    this.sendHeartbeat()
    this.heartbeatTimer = this.setIntervalImpl(() => {
      if (
        this.awaitingHeartbeatAck
        && (this.now() - this.lastHeartbeatSentAt) > Math.max(intervalMs * 2, DEFAULT_HEARTBEAT_TIMEOUT_MS)
      ) {
        this.patchRuntimeState({ lastError: 'Discord heartbeat ACK 超时' })
        this.socket?.close(4000, 'heartbeat timeout')
        this.scheduleReconnect()
        return
      }

      this.sendHeartbeat()
    }, intervalMs)
  }

  private sendIdentify(): void {
    this.sendGateway({
      op: 2,
      d: {
        token: this.config.botToken,
        intents: (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15),
        properties: {
          os: process.platform,
          browser: 'proma',
          device: 'proma',
        },
      },
    })
  }

  private sendResume(): void {
    const runtime = this.readRuntimeState()
    if (!runtime.sessionId || !runtime.resumeGatewayUrl || typeof runtime.lastSequence !== 'number') {
      this.sendIdentify()
      return
    }

    this.sendGateway({
      op: 6,
      d: {
        token: this.config.botToken,
        session_id: runtime.sessionId,
        seq: runtime.lastSequence,
      },
    })
  }

  private handleGatewayPayload(payload: DiscordGatewayPayload): void {
    if (typeof payload.s === 'number') {
      this.recordSequence(payload.s)
    }

    switch (payload.op) {
      case 10: {
        const hello = payload.d as DiscordHelloData | undefined
        const intervalMs = Number(hello?.heartbeat_interval ?? 30_000)
        this.startHeartbeatLoop(intervalMs)
        if (this.canResume()) {
          this.sendResume()
        } else {
          this.sendIdentify()
        }
        return
      }

      case 11:
        this.awaitingHeartbeatAck = false
        this.lastHeartbeatAckAt = this.now()
        return

      case 7:
        this.socket?.close(4000, 'gateway requested reconnect')
        this.scheduleReconnect(1_000)
        return

      case 9:
        if (payload.d === false) {
          this.clearResumeState()
        }
        this.socket?.close(4001, 'invalid session')
        this.scheduleReconnect(1_000)
        return

      case 0:
        if (payload.t) {
          void this.handleDispatch(payload.t, payload.d as DiscordDispatchData)
        }
        return
    }
  }

  async handleDispatch(eventType: string, data: DiscordDispatchData): Promise<void> {
    if (eventType === 'READY') {
      const now = this.now()
      this.botUserId = String(data.user?.id ?? '')
      this.reconnectAttempts = 0
      this.flushSequence()
      this.patchRuntimeState({
        sessionId: String(data.session_id ?? ''),
        resumeGatewayUrl: String(data.resume_gateway_url ?? '').trim() || undefined,
        lastSequence: this.readRuntimeState().lastSequence,
        lastConnectedAt: now,
        lastError: undefined,
      })
      this.updateStatus({
        enabled: this.config.enabled,
        status: 'connected',
        connectedAt: now,
        lastConnectedAt: now,
        errorMessage: undefined,
      })
      return
    }

    if (eventType === 'RESUMED') {
      const now = this.now()
      this.reconnectAttempts = 0
      this.flushSequence()
      this.patchRuntimeState({
        lastConnectedAt: now,
        lastError: undefined,
      })
      this.updateStatus({
        enabled: this.config.enabled,
        status: 'connected',
        lastConnectedAt: now,
        errorMessage: undefined,
      })
      return
    }

    if (eventType === 'MESSAGE_CREATE') {
      if (data.author?.bot) return

      // 身份白名单已统一收敛到 BridgeManager 的 inbound-guard（默认拒绝 + 回提示 + 写审计）；
      // 这里只保留服务器/频道/@提及等路由层过滤。
      const userId = String(data.author?.id ?? '')
      const channelId = String(data.channel_id ?? '')
      const guildId = typeof data.guild_id === 'string' ? data.guild_id : null
      if (guildId) {
        if (this.config.allowedGuildIds.length > 0 && !this.config.allowedGuildIds.includes(guildId)) {
          return
        }
        if (this.config.allowedChannelIds.length > 0 && !this.config.allowedChannelIds.includes(channelId)) {
          return
        }
        if (this.config.requireMention && this.botUserId) {
          const mentioned = Array.isArray(data.mentions)
            && data.mentions.some((mention: { id?: string }) => mention.id === this.botUserId)
          if (!mentioned) return
        }
      }

      const attachments: BridgeAttachmentReference[] = Array.isArray(data.attachments)
        ? data.attachments.map((attachment) => ({
          remoteId: String(attachment.id ?? ''),
          filename: String(attachment.filename ?? 'discord-attachment'),
          mediaType: String(attachment.content_type ?? 'application/octet-stream'),
          size: Number(attachment.size ?? 0),
          downloadUrl: attachment.url ? String(attachment.url) : undefined,
        }))
        : []

      this.emit({
        type: 'message',
        message: {
          channelType: 'discord',
          endpointKey: `discord:${channelId}`,
          chatId: channelId,
          userId,
          displayName: String(data.author?.username ?? 'Discord 用户'),
          messageId: String(data.id ?? ''),
          text: String(data.content ?? ''),
          attachments,
        },
      })
      return
    }

    if (eventType === 'INTERACTION_CREATE') {
      const parsed = parseCustomId(data.data?.custom_id)
      if (!parsed) return

      await this.fetchImpl(`https://discord.com/api/v10/interactions/${data.id}/${data.token}/callback`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ type: 6 }),
      })

      const userId = String(data.member?.user?.id ?? data.user?.id ?? '')
      const channelId = String(data.channel_id ?? '')
      this.emit({
        type: 'permission_action',
        action: {
          channelType: 'discord',
          endpointKey: `discord:${channelId}`,
          chatId: channelId,
          userId,
          callbackToken: parsed.callbackToken,
          behavior: parsed.behavior,
          alwaysAllow: parsed.alwaysAllow,
        },
      })
    }
  }

  async sendMessage(input: BridgeOutboundMessage): Promise<void> {
    const response = await this.fetchImpl(`https://discord.com/api/v10/channels/${input.chatId}/messages`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        content: input.text,
      }),
    })
    await assertDiscordResponseOk(response, 'Discord 消息发送')
  }

  async sendPermissionPrompt(input: BridgePermissionPromptMessage): Promise<void> {
    const response = await this.fetchImpl(`https://discord.com/api/v10/channels/${input.chatId}/messages`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        content: input.promptText,
        components: [{
          type: 1,
          components: [
            {
              type: 2,
              style: 3,
              label: '允许一次',
              custom_id: `imbridge|allow|${input.callbackToken}|once`,
            },
            // 不提供“总是允许”：公共频道里一次误点就会把危险工具永久写进白名单
            {
              type: 2,
              style: 4,
              label: '拒绝',
              custom_id: `imbridge|deny|${input.callbackToken}|once`,
            },
          ],
        }],
      }),
    })
    await assertDiscordResponseOk(response, 'Discord 权限提示发送')
  }

  async downloadAttachments(attachments: BridgeAttachmentReference[], sessionId: string): Promise<FileAttachment[]> {
    return downloadDiscordAttachments({
      fetchImpl: this.fetchImpl,
      attachments,
      sessionId,
      maxBytes: this.config.maxInboundFileBytes,
    })
  }
}
