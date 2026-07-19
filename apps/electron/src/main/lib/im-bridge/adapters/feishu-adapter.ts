import type { FeishuBridgeConfig, FileAttachment } from '@kila/shared'
import type { BridgeTestResult } from '@kila/shared'
import { BaseImAdapter } from './base-adapter'
import type { BridgeAttachmentReference, BridgeOutboundMessage, BridgePermissionPromptMessage } from './base-adapter'
import { buildAgentReplyCard, buildErrorCard, splitLongContent } from './feishu-renderer'
import { downloadFeishuAttachments } from './feishu-files'
import { ScopedQueue } from '../feishu/scoped-queue'
import { RunCoordinator } from '../feishu/run-coordinator'
import {
  createInitialState,
  reduce as reduceRunState,
  markInterrupted,
  markError,
  finalizeIfRunning,
} from '../feishu/card-run-state'
import type { RunState } from '../feishu/card-run-state'
import { CardStream } from '../feishu/card-stream'
import { renderCard } from '../feishu/card-renderer'
import {
  buildAgentUserMessage,
  convertMentions,
  buildGroupExtraBlock,
} from '../feishu/prompt-builder'
import type { BridgeContext, QuotedMessage } from '../feishu/prompt-builder'

import { createLogger } from '../../logger'
const log = createLogger('IM Bridge')

interface FeishuMessageApi {
  create: (input: { params?: Record<string, unknown>; data: Record<string, unknown> }) => Promise<any>
  reply: (input: { path: Record<string, unknown>; data: Record<string, unknown> }) => Promise<any>
  get: (input: { path: Record<string, unknown> }) => Promise<any>
}

interface FeishuClientLike {
  request: (input: { method: string; url: string }) => Promise<any>
  im: {
    message: FeishuMessageApi
    chat: {
      create: (input: { data: Record<string, unknown>; params?: Record<string, unknown> }) => Promise<any>
      update: (input: { path: Record<string, unknown>; data: Record<string, unknown> }) => Promise<any>
    }
  }
}

interface FeishuWsClientLike {
  start: (input?: Record<string, unknown>) => Promise<void>
  stop?: () => void
}

interface FeishuChannelLike {
  rawClient: FeishuClientLike
  connect: () => Promise<void>
  disconnect?: () => Promise<void>
  on: (handlers: {
    message?: (message: Record<string, unknown>) => void | Promise<void>
    reject?: (event: Record<string, unknown>) => void
    error?: (error: unknown) => void
    reconnecting?: () => void
    reconnected?: () => void
  }) => () => void
}

interface FeishuAdapterDeps {
  getConfig: () => FeishuBridgeConfig
  botId?: string
  botName?: string
  createClient?: () => FeishuClientLike
  createWsClient?: () => FeishuWsClientLike
  onStreamEvent?: (context: {
    chatId: string
    endpointKey: string
    event: AgentStreamEvent
  }) => void
}

interface AgentStreamEvent {
  type: 'text' | 'tool_start' | 'tool_result' | 'done' | 'error'
  [key: string]: unknown
}

interface FeishuMention {
  key?: string
  id?: string | { open_id?: string; union_id?: string; user_id?: string }
  openId?: string
  userId?: string
  name?: string
}

interface FeishuEventMessage {
  message_id: string
  chat_id: string
  chat_type?: string
  message_type?: string
  content?: unknown
  mentions?: FeishuMention[]
  parent_id?: string
  root_id?: string
}

interface FeishuEventSender {
  sender_id?: { open_id?: string; user_id?: string; union_id?: string }
  type?: string
  sender_type?: string
}

function parseMentionedOpenId(mention: FeishuMention): string | undefined {
  if (typeof mention.openId === 'string') return mention.openId
  if (typeof mention.id === 'string') return mention.id
  return mention.id?.open_id
}

function parseMessageText(messageType: string, rawContent: unknown): string {
  if (typeof rawContent !== 'string') return ''

  try {
    if (messageType === 'text') {
      const parsed = JSON.parse(rawContent) as { text?: string }
      return (parsed.text ?? '').replace(/@_user_\d+/g, '').trim()
    }

    if (messageType === 'post') {
      const parsed = JSON.parse(rawContent) as {
        title?: string
        content?: Array<Array<{ tag: string; text?: string }>>
      }
      const parts: string[] = []
      if (parsed.title) parts.push(parsed.title)
      for (const line of parsed.content ?? []) {
        for (const node of line) {
          if (node.tag === 'text' && node.text) {
            parts.push(node.text)
          }
        }
      }
      return parts.join(' ').replace(/@_user_\d+/g, '').trim()
    }
  } catch (error) {
    log.warn('[IM Bridge][Feishu] 解析消息失败', error)
  }

  return ''
}

function getRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' ? value as Record<string, any> : undefined
}

function resolveEventEnvelope(payload: Record<string, any>): {
  event: Record<string, any>
  message?: FeishuEventMessage
  sender?: FeishuEventSender
  eventId?: string
} {
  const event = getRecord(payload.event) ?? payload
  const header = getRecord(payload.header)
  return {
    event,
    message: getRecord(event.message) as FeishuEventMessage | undefined,
    sender: getRecord(event.sender) as FeishuEventSender | undefined,
    eventId: String(header?.event_id ?? payload.event_id ?? event.event_id ?? ''),
  }
}

function normalizeChannelRawMessage(message: Record<string, unknown>): Record<string, any> {
  const raw = getRecord(message.raw)
  if (raw) return raw

  return {
    event_id: message.messageId,
    sender: {
      sender_id: {
        open_id: message.senderId,
      },
      sender_type: 'user',
    },
    message: {
      message_id: message.messageId,
      chat_id: message.chatId,
      chat_type: message.chatType,
      message_type: message.rawContentType,
      content: JSON.stringify({ text: message.content ?? '' }),
      mentions: message.mentions,
      root_id: message.rootId,
      parent_id: message.replyToMessageId,
    },
  }
}

/** 三层去重：event 级 → message 级 → chat 级 */
class TripleDedup {
  private readonly recentEventIds = new Map<string, number>()
  private readonly recentMessageIds = new Map<string, number>()
  private readonly processingChats = new Set<string>()
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null

  private static readonly MAX_ENTRIES = 5000
  private static readonly TTL_MS = 5 * 60 * 1000

  checkEvent(eventId: string): boolean {
    this.scheduleCleanup()
    if (this.recentEventIds.has(eventId)) return true
    this.recentEventIds.set(eventId, Date.now())
    this.evictIfNeeded(this.recentEventIds)
    return false
  }

  checkMessage(messageId: string): boolean {
    if (this.recentMessageIds.has(messageId)) return true
    this.recentMessageIds.set(messageId, Date.now())
    this.evictIfNeeded(this.recentMessageIds)
    return false
  }

  tryAcquireChat(chatId: string): boolean {
    if (this.processingChats.has(chatId)) return false
    this.processingChats.add(chatId)
    return true
  }

  releaseChat(chatId: string): void {
    this.processingChats.delete(chatId)
  }

  /** 将 Bot 发出的消息 ID 加入去重，防止回环 */
  addSentMessageId(messageId: string): void {
    this.recentMessageIds.set(messageId, Date.now())
  }

  clear(): void {
    this.recentEventIds.clear()
    this.recentMessageIds.clear()
    this.processingChats.clear()
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  private scheduleCleanup(): void {
    if (this.cleanupTimer) return
    this.cleanupTimer = setTimeout(() => {
      this.cleanupTimer = null
      const cutoff = Date.now() - TripleDedup.TTL_MS
      this.evictExpired(this.recentEventIds, cutoff)
      this.evictExpired(this.recentMessageIds, cutoff)
    }, 60_000)
  }

  private evictExpired(map: Map<string, number>, cutoff: number): void {
    for (const [key, ts] of map) {
      if (ts < cutoff) map.delete(key)
    }
  }

  private evictIfNeeded(map: Map<string, number>): void {
    if (map.size <= TripleDedup.MAX_ENTRIES) return
    const entries = [...map.entries()].sort((a, b) => a[1] - b[1])
    const toDelete = entries.slice(0, Math.floor(entries.length * 0.3))
    for (const [key] of toDelete) {
      map.delete(key)
    }
  }
}

export class FeishuAdapter extends BaseImAdapter {
  readonly channelType = 'feishu' as const
  private client: FeishuClientLike | null = null
  private wsClient: FeishuWsClientLike | null = null
  private channel: FeishuChannelLike | null = null
  private channelUnsubscribe: (() => void) | null = null
  private larkClient: InstanceType<typeof import('@larksuiteoapi/node-sdk').Client> | null = null
  private botOpenId: string | null = null
  private readonly lastInboundMessageIdByChatId = new Map<string, string>()
  private readonly chatTypeByChatId = new Map<string, 'p2p' | 'group'>()
  private readonly displayNameByChatId = new Map<string, string>()

  // 三层去重 + 消息聚合 + 并发控制
  private readonly dedup = new TripleDedup()
  private readonly scopedQueue: ScopedQueue<BridgeInboundPayload>
  private readonly runCoordinator = new RunCoordinator(
    () => this.config.maxConcurrent ?? 5,
  )

  // 流式卡片管理：chatId → CardStream
  private readonly activeStreams = new Map<string, CardStream>()
  // 流式卡片状态：endpointKey → RunState
  private readonly activeRunStates = new Map<string, RunState>()

  constructor(private readonly deps: FeishuAdapterDeps) {
    super('feishu')
    this.scopedQueue = new ScopedQueue<BridgeInboundPayload>(
      (scope, items) => { void this.flushQueue(scope, items) },
      { quietWindowMs: 600, maxBatchSize: 20 },
    )
  }

  get botId(): string | undefined {
    return this.deps.botId
  }

  get botName(): string | undefined {
    return this.deps.botName
  }

  private buildEndpointKey(chatId: string): string {
    return this.deps.botId ? `feishu:${this.deps.botId}:${chatId}` : `feishu:${chatId}`
  }

  private get config(): FeishuBridgeConfig {
    return this.deps.getConfig()
  }

  private getOrCreateClient(): FeishuClientLike {
    if (this.client) return this.client
    if (this.channel?.rawClient) {
      this.client = this.channel.rawClient
      return this.client
    }
    if (this.deps.createClient) {
      this.client = this.deps.createClient()
      return this.client
    }

    const lark = require('@larksuiteoapi/node-sdk') as typeof import('@larksuiteoapi/node-sdk')
    this.client = new lark.Client({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      appType: lark.AppType.SelfBuild,
    }) as unknown as FeishuClientLike
    return this.client
  }

  /** 获取原生 lark.Client 实例（用于 CardKit 2.0 API） */
  private getLarkClient(): InstanceType<typeof import('@larksuiteoapi/node-sdk').Client> | null {
    if (this.larkClient) return this.larkClient
    try {
      const client = this.getOrCreateClient() as any
      if (client?.cardkit) {
        this.larkClient = client as InstanceType<typeof import('@larksuiteoapi/node-sdk').Client>
        return this.larkClient
      }
    } catch {
      // 不是真正的 lark.Client
    }
    return null
  }

  /** 获取 chatId 对应的最近用户消息 ID（用于群聊 thread reply） */
  getLastInboundMessageId(chatId: string): string | undefined {
    return this.lastInboundMessageIdByChatId.get(chatId)
  }

  private getOrCreateWsClient(): FeishuWsClientLike {
    if (this.wsClient) return this.wsClient
    if (this.deps.createWsClient) {
      this.wsClient = this.deps.createWsClient()
      return this.wsClient
    }

    const lark = require('@larksuiteoapi/node-sdk') as typeof import('@larksuiteoapi/node-sdk')
    const eventDispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': (data: Record<string, unknown>) => {
        void this.handleEventPayload(data)
      },
    })
    const ws = new lark.WSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      loggerLevel: lark.LoggerLevel.warn,
    })
    this.wsClient = {
      start: async () => ws.start({ eventDispatcher }),
      stop: () => (ws as any).stop?.(),
    }
    return this.wsClient
  }

  private getOrCreateChannel(): FeishuChannelLike {
    if (this.channel) return this.channel

    const lark = require('@larksuiteoapi/node-sdk') as typeof import('@larksuiteoapi/node-sdk')
    if (typeof (lark as any).createLarkChannel !== 'function') {
      return {
        rawClient: this.getOrCreateClient(),
        connect: async () => this.getOrCreateWsClient().start(),
        disconnect: async () => this.getOrCreateWsClient().stop?.(),
        on: () => () => {},
      }
    }

    this.channel = (lark as any).createLarkChannel({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      domain: (lark as any).Domain?.Feishu,
      loggerLevel: lark.LoggerLevel.warn,
      policy: {
        dmMode: 'open',
        requireMention: false,
        respondToMentionAll: false,
      },
      safety: { chatQueue: { enabled: false } },
      includeRawEvent: true,
    }) as FeishuChannelLike
    this.client = this.channel.rawClient
    return this.channel
  }

  private async refreshBotOpenId(): Promise<void> {
    const response = await this.getOrCreateClient().request({
      method: 'GET',
      url: 'https://open.feishu.cn/open-apis/bot/v3/info/',
    }) as { bot?: { open_id?: string; app_name?: string }; data?: { bot?: { open_id?: string; app_name?: string } } }

    this.botOpenId = response?.bot?.open_id ?? response?.data?.bot?.open_id ?? null
  }

  async testConnection(): Promise<BridgeTestResult> {
    if (!this.config.appId.trim() || !this.config.appSecret.trim()) {
      return { channel: 'feishu', success: false, message: '缺少飞书应用 ID 或应用密钥' }
    }

    try {
      const response = await this.getOrCreateClient().request({
        method: 'GET',
        url: 'https://open.feishu.cn/open-apis/bot/v3/info/',
      }) as { bot?: { app_name?: string }; data?: { bot?: { app_name?: string } } }
      const botName = response?.bot?.app_name ?? response?.data?.bot?.app_name

      return {
        channel: 'feishu',
        success: true,
        message: botName ? `飞书机器人已连接 ${botName}` : '飞书机器人已连接',
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      const status = (error as any)?.response?.status
      const code = (error as any)?.response?.data?.code
      const msg = (error as any)?.response?.data?.msg
      log.error(`[IM Bridge][Feishu] 连接测试失败: status=${status}, code=${code}, msg=${msg}, appId=${this.config.appId.substring(0, 4)}***`)
      return {
        channel: 'feishu',
        success: false,
        message: code ? `飞书 API 错误 (${code}): ${msg ?? message}` : message,
      }
    }
  }

  async start(): Promise<void> {
    const result = await this.testConnection()
    if (!result.success) {
      this.updateStatus({
        enabled: this.config.enabled,
        status: 'error',
        errorMessage: result.message,
      })
      throw new Error(result.message)
    }

    await this.refreshBotOpenId()
    const channel = this.getOrCreateChannel()
    this.channelUnsubscribe = channel.on({
      message: (message) => {
        void this.handleEventPayload(normalizeChannelRawMessage(message)).catch((error) => {
          log.error('[IM Bridge][Feishu] 处理长连接消息失败', error)
        })
      },
      reject: (event) => {
        log.info('[IM Bridge][Feishu] 消息被 Channel 策略跳过', event)
      },
      error: (error) => {
        const message = error instanceof Error ? error.message : String(error)
        this.updateStatus({
          enabled: this.config.enabled,
          status: 'error',
          errorMessage: message,
        })
      },
      reconnecting: () => {
        this.updateStatus({
          enabled: this.config.enabled,
          status: 'connecting',
          errorMessage: undefined,
        })
      },
      reconnected: () => {
        this.updateStatus({
          enabled: this.config.enabled,
          status: 'connected',
          connectedAt: Date.now(),
          lastConnectedAt: Date.now(),
          errorMessage: undefined,
        })
      },
    })
    await channel.connect()
    this.updateStatus({
      enabled: this.config.enabled,
      status: 'connected',
      connectedAt: Date.now(),
      lastConnectedAt: Date.now(),
      errorMessage: undefined,
    })
  }

  stop(): void {
    this.channelUnsubscribe?.()
    this.channelUnsubscribe = null
    void this.channel?.disconnect?.().catch(() => {})
    this.channel = null
    this.wsClient?.stop?.()
    this.wsClient = null
    this.client = null
    this.larkClient = null
    this.botOpenId = null
    this.lastInboundMessageIdByChatId.clear()
    this.chatTypeByChatId.clear()
    this.displayNameByChatId.clear()
    this.scopedQueue.cancelAll()
    this.runCoordinator.abortAll()
    this.closeAllStreams()
    this.dedup.clear()
    this.updateStatus({
      enabled: this.config.enabled,
      status: 'disconnected',
      errorMessage: undefined,
    })
  }

  private isBotMentioned(mentions: FeishuMention[] | undefined): boolean {
    if (!mentions?.length) return false
    if (!this.botOpenId) return true
    return mentions.some((mention) => parseMentionedOpenId(mention) === this.botOpenId)
  }

  async handleEventPayload(payload: Record<string, any>): Promise<void> {
    const { event, message, sender, eventId } = resolveEventEnvelope(payload)
    if (!message) return

    // 三层去重 — 第一层：event 级
    if (eventId && this.dedup.checkEvent(String(eventId))) return

    const chatId = String(message.chat_id ?? '')
    const chatType = message.chat_type === 'group' ? 'group' : 'p2p'
    const messageType = String(message.message_type ?? '')
    const mentions = message.mentions as FeishuMention[] | undefined
    const userId = String(sender?.sender_id?.open_id ?? 'unknown')
    const messageId = String(message.message_id ?? '')

    if (!chatId) return
    if (chatType === 'p2p' && !this.config.allowP2P) return
    if (chatType === 'group' && !this.config.allowGroup) return
    if (chatType === 'group' && this.config.requireMention && !this.isBotMentioned(mentions)) return

    // 过滤非用户消息
    const senderType = String(sender?.type ?? sender?.sender_type ?? '')
    if (senderType !== 'user' && senderType !== '') return

    // 三层去重 — 第二层：message 级
    if (this.dedup.checkMessage(messageId)) return

    this.chatTypeByChatId.set(chatId, chatType)
    this.lastInboundMessageIdByChatId.set(chatId, messageId)

    const text = parseMessageText(messageType, message.content)
    if (!text && messageType !== 'text' && messageType !== 'post' && messageType !== 'image' && messageType !== 'file') {
      await this.sendText(chatId, '当前飞书桥接仅支持文本、图片和文件消息。')
      return
    }

    const groupName = typeof (event as any)?.chat?.name === 'string'
      ? (event as any).chat.name
      : (chatType === 'group' ? '飞书群聊' : '飞书私聊')
    this.displayNameByChatId.set(chatId, groupName)

    // 获取引用消息
    const quotedMessageId = message.parent_id ?? message.root_id
    let quoted: QuotedMessage | undefined
    if (quotedMessageId) {
      quoted = await this.fetchQuotedMessage(quotedMessageId)
    }

    // 构建飞书桥接上下文
    const bridgeContext: BridgeContext = {
      chatId,
      chatType: chatType as 'p2p' | 'group' | 'topic',
      senderOpenId: userId,
      senderName: undefined,
      threadId: message.root_id,
      groupName: chatType === 'group' ? groupName : undefined,
    }

    // 构建增强的用户消息
    const groupExtraBlock = buildGroupExtraBlock(groupName)
    const enhancedText = buildAgentUserMessage({
      userText: text,
      context: bridgeContext,
      quoted,
      groupExtraBlock,
    })

    const endpointKey = this.buildEndpointKey(chatId)

    // 通过 ScopedQueue 聚合同 chat 的短时间消息
    this.scopedQueue.push(chatId, {
      channelType: 'feishu',
      endpointKey,
      chatId,
      userId,
      displayName: chatType === 'group' ? groupName : '飞书私聊',
      messageId,
      text: enhancedText,
      originalText: text,
      attachments: [],
      bridgeContext,
      quoted,
    })
  }

  /** 聚合队列刷新 — 合并多条消息后一次性投递 */
  private async flushQueue(chatId: string, items: BridgeInboundPayload[]): Promise<void> {
    if (items.length === 0) return

    // 三层去重 — 第三层：chat 级锁
    if (!this.dedup.tryAcquireChat(chatId)) {
      // chat 正在处理中，block 队列让消息累积，run 结束后 unblock
      this.scopedQueue.block(chatId)
      return
    }

    // 申请并发槽位（per-scope 串行 + 全局上限）
    const first = items[0]!
    const release = await this.runCoordinator.acquire(chatId, first.endpointKey)
    this.scopedQueue.block(chatId)

    try {
      // 合并多条消息为一条
      const merged = items.length === 1
        ? items[0]!
        : mergeInboundItems(items)

      if (!merged) return

      this.emit({
        type: 'message',
        message: {
          channelType: 'feishu',
          endpointKey: merged.endpointKey,
          chatId: merged.chatId,
          botId: this.deps.botId,
          userId: merged.userId,
          displayName: merged.displayName,
          messageId: merged.messageId,
          text: merged.text,
          attachments: merged.attachments,
        },
      })
    } finally {
      this.dedup.releaseChat(chatId)
      release()
      this.scopedQueue.unblock(chatId)
    }
  }

  /** 获取引用消息 */
  private async fetchQuotedMessage(messageId: string): Promise<QuotedMessage | undefined> {
    try {
      const client = this.getOrCreateClient()
      const response = await client.im.message.get({
        path: { message_id: messageId },
      }) as { data?: { items?: Array<Record<string, any>> } }

      const msg = response?.data?.items?.[0]
      if (!msg) return undefined

      const contentType = msg.msg_type ?? 'unknown'
      const bodyContent = msg.body?.content ?? ''
      let content = ''
      let cardJson: string | undefined

      if (contentType === 'text') {
        content = parseMessageText('text', bodyContent)
      } else if (contentType === 'post') {
        content = parseMessageText('post', bodyContent)
      } else if (contentType === 'interactive') {
        content = '（被引用的是交互式卡片，详见 <interactive_card>）'
        cardJson = bodyContent
      } else if (contentType === 'image') {
        content = `（被引用的是图片消息）`
      } else if (contentType === 'file') {
        content = `（被引用的是文件消息）`
      } else {
        content = typeof bodyContent === 'string' && bodyContent.length > 500
          ? bodyContent.slice(0, 500) + '…'
          : String(bodyContent)
      }

      return {
        messageId,
        senderOpenId: msg.sender?.id?.open_id,
        senderName: msg.sender?.id?.name ?? msg.sender?.id?.open_id,
        createdAt: msg.create_time ? Number(msg.create_time) * 1000 : undefined,
        contentType,
        content,
        cardJson,
      }
    } catch {
      return undefined
    }
  }

  private async sendText(chatId: string, text: string): Promise<void> {
    const client = this.getOrCreateClient()
    const chatType = this.chatTypeByChatId.get(chatId)
    const replyToId = chatType === 'group' ? this.lastInboundMessageIdByChatId.get(chatId) : undefined

    try {
      if (replyToId) {
        const resp = await client.im.message.reply({
          path: { message_id: replyToId },
          data: {
            msg_type: 'text',
            content: JSON.stringify({ text }),
          },
        })
        const sentId = resp?.data?.message_id
        if (sentId) this.dedup.addSentMessageId(sentId)
        return
      }

      const resp = await client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      })
      const sentId = resp?.data?.message_id
      if (sentId) this.dedup.addSentMessageId(sentId)
    } catch (error) {
      log.error('[IM Bridge][Feishu] 发送文本消息失败', error)
    }
  }

  private async sendCard(chatId: string, card: Record<string, unknown>): Promise<void> {
    const client = this.getOrCreateClient()
    const chatType = this.chatTypeByChatId.get(chatId)
    const replyToId = chatType === 'group' ? this.lastInboundMessageIdByChatId.get(chatId) : undefined

    try {
      if (replyToId) {
        const resp = await client.im.message.reply({
          path: { message_id: replyToId },
          data: {
            msg_type: 'interactive',
            content: JSON.stringify(card),
          },
        })
        const sentId = resp?.data?.message_id
        if (sentId) this.dedup.addSentMessageId(sentId)
        return
      }

      const resp = await client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'interactive',
          content: JSON.stringify(card),
        },
      })
      const sentId = resp?.data?.message_id
      if (sentId) this.dedup.addSentMessageId(sentId)
    } catch (error) {
      log.error('[IM Bridge][Feishu] 发送卡片消息失败', error)
    }
  }

  /** 创建流式卡片（由 BridgeManager 的流式事件回调驱动） */
  async openStreamCard(chatId: string, modelName?: string, replyToMessageId?: string): Promise<CardStream | null> {
    if (!this.config.streamingCards) return null

    const larkClient = this.getLarkClient()
    if (!larkClient) return null

    const initialState = createInitialState(modelName)
    const headerTitle = modelName ? `Kila Agent · ${modelName}` : 'Kila Agent'
    const initialCard = renderCard(initialState, {
      header: headerTitle,
    })

    try {
      const stream = await CardStream.open(
        larkClient,
        chatId,
        initialCard,
        { replyToMessageId },
      )
      this.activeStreams.set(chatId, stream)
      this.activeRunStates.set(this.buildEndpointKey(chatId), initialState)
      return stream
    } catch (error) {
      log.warn('[IM Bridge][Feishu] 创建流式卡片失败，回退普通卡片', error)
      return null
    }
  }

  /** 更新流式卡片状态 */
  async updateStreamCard(chatId: string, state: RunState): Promise<void> {
    const stream = this.activeStreams.get(chatId)
    if (!stream) return
    const endpointKey = this.buildEndpointKey(chatId)
    const headerTitle = state.terminal === 'running' ? 'Kila Agent · 处理中' : 'Kila Agent · 已完成'
    const card = renderCard(state, {
      header: headerTitle,
    })
    stream.update(card)
  }

  /** 刷新并关闭流式卡片 */
  async closeStreamCard(chatId: string, state?: RunState): Promise<void> {
    const stream = this.activeStreams.get(chatId)
    if (!stream) return
    const endpointKey = this.buildEndpointKey(chatId)
    if (state) {
      const headerTitle = 'Kila Agent · 已完成'
      const card = renderCard(state, { header: headerTitle })
      await stream.flush(card)
    }
    await stream.close()
    this.activeStreams.delete(chatId)
    this.activeRunStates.delete(endpointKey)
  }

  private closeAllStreams(): void {
    for (const [, stream] of this.activeStreams) {
      void stream.close().catch(() => {})
    }
    this.activeStreams.clear()
    this.activeRunStates.clear()
  }

  async sendMessage(input: BridgeOutboundMessage): Promise<void> {
    if (input.deliveryKind === 'assistant') {
      const processedText = convertMentions(input.text, new Map())
      const subtitle = this.displayNameByChatId.get(input.chatId)
      for (const chunk of splitLongContent(processedText)) {
        await this.sendCard(input.chatId, buildAgentReplyCard(chunk, subtitle))
      }
      return
    }

    await this.sendText(input.chatId, input.text)
  }

  async sendPermissionPrompt(input: BridgePermissionPromptMessage): Promise<void> {
    await this.sendCard(input.chatId, buildErrorCard(`${input.promptText}\n\n当前飞书桥接暂不支持远程审批，请在桌面端继续处理。`))
  }

  async createChatWithUser(input: { userOpenId: string; name: string }): Promise<string> {
    const client = this.getOrCreateClient()
    const response = await client.im.chat.create({
      data: {
        name: input.name,
        chat_mode: 'group',
        chat_type: 'private',
        user_id_list: [input.userOpenId],
      },
      params: { user_id_type: 'open_id' },
    })
    const chatId = response?.data?.chat_id ?? response?.data?.chat?.chat_id
    if (!chatId) throw new Error('飞书建群成功但未返回 chat_id')
    this.chatTypeByChatId.set(chatId, 'group')
    this.displayNameByChatId.set(chatId, input.name)
    return chatId
  }

  async renameChat(chatId: string, name: string): Promise<boolean> {
    const client = this.getOrCreateClient()
    try {
      const response = await client.im.chat.update({
        path: { chat_id: chatId },
        data: { name },
      })
      return !response?.code || response.code === 0
    } catch (error) {
      log.warn('[IM Bridge][Feishu] 更新群名失败', error)
      return false
    }
  }

  async sendMirrorCard(chatId: string, text: string): Promise<void> {
    await this.sendCard(chatId, buildAgentReplyCard(text, 'Kila Session'))
  }

  async downloadAttachments(attachments: BridgeAttachmentReference[], sessionId: string): Promise<FileAttachment[]> {
    if (attachments.length === 0) return []

    const client = this.getOrCreateClient()
    return downloadFeishuAttachments({
      client: client as any,
      attachments,
      sessionId,
    })
  }
}

interface BridgeInboundPayload {
  channelType: 'feishu'
  endpointKey: string
  chatId: string
  userId: string
  displayName: string
  messageId: string
  text: string
  originalText: string
  attachments: BridgeAttachmentReference[]
  bridgeContext: BridgeContext
  quoted?: QuotedMessage
}

function mergeInboundItems(items: BridgeInboundPayload[]): BridgeInboundPayload {
  if (items.length === 1) return items[0]!

  const last = items[items.length - 1]!
  const allTexts = items.map((item, i) => {
    const prefix = items.length > 1 ? `[消息 ${i + 1}] ` : ''
    return prefix + item.originalText
  })

  return {
    ...last,
    text: buildAgentUserMessage({
      userText: allTexts.join('\n\n'),
      context: last.bridgeContext,
      quoted: last.quoted,
      groupExtraBlock: buildGroupExtraBlock(last.bridgeContext.groupName),
    }),
    messageId: last.messageId,
  }
}
