import type {
  BridgeChannelStatus,
  WeChatAccountRuntimeState,
  WeChatBridgeAccountEntry,
  WeChatBridgeConfig,
} from '@kila/shared'
import type {
  BridgeAdapterEvent,
  BridgeInboundMessage,
  BridgeOutboundMessage,
} from '../adapters/base-adapter'
import { chunkOutboundMessage } from '../delivery-layer'
import { WeChatIlinkClient } from './client'
import type { WeChatContextStore } from './context-store'
import type { WeChatDeferredOutboundStore } from './deferred-outbound-store'
import type { WeChatMediaService } from './media-service'
import { WeChatMessageAggregator } from './message-aggregator'
import { parseWeChatInbound } from './parser'
import type { WeChatCredential, WeChatIlinkRawMessage } from './types'
import { classifyPollFailure, computePollBackoffDelayMs, sleepWithSignal } from '../poll-backoff'
import { createLogger } from '../../logger'

const log = createLogger('IM Bridge')

const WECHAT_SESSION_EXPIRED_CODE = -14

interface WeChatAccountRuntimeDeps {
  account: WeChatBridgeAccountEntry
  credential: WeChatCredential
  getConfig: () => WeChatBridgeConfig
  getRuntimeState: () => WeChatAccountRuntimeState | undefined
  saveRuntimeState: (state: WeChatAccountRuntimeState) => void
  contextStore: WeChatContextStore
  deferredStore: WeChatDeferredOutboundStore
  mediaService: WeChatMediaService
  createClient?: (credential: WeChatCredential) => WeChatIlinkClient
  emit: (event: BridgeAdapterEvent) => void
  onStatus: (status: BridgeChannelStatus) => void
}

function statusFor(
  account: WeChatBridgeAccountEntry,
  status: BridgeChannelStatus['status'],
  patch?: Partial<BridgeChannelStatus>,
): BridgeChannelStatus {
  return {
    channel: 'wechat',
    enabled: account.enabled,
    status,
    ...patch,
  }
}

export class WeChatAccountRuntime {
  private readonly client: WeChatIlinkClient
  private readonly aggregator: WeChatMessageAggregator
  private abortController: AbortController | null = null
  private pollPromise: Promise<void> | null = null
  private lastStatus: BridgeChannelStatus
  private typingTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: WeChatAccountRuntimeDeps) {
    this.client = deps.createClient?.(deps.credential) ?? new WeChatIlinkClient({ credential: deps.credential })
    this.lastStatus = statusFor(deps.account, 'disconnected')
    this.aggregator = new WeChatMessageAggregator({
      aggregateWindowMs: () => this.deps.getConfig().aggregateWindowMs,
      flush: (message) => this.emitInbound(message),
    })
  }

  get accountId(): string {
    return this.deps.account.accountId
  }

  getStatus(): BridgeChannelStatus {
    return { ...this.lastStatus }
  }

  async testConnection(): Promise<void> {
    if (!this.deps.credential.botToken) {
      throw new Error('WeChat credential is missing bot token')
    }
  }

  async start(): Promise<void> {
    if (this.abortController) return

    this.updateStatus('connecting')
    try {
      await this.testConnection()
      this.abortController = new AbortController()
      const now = Date.now()
      this.patchRuntimeState({ lastConnectedAt: now, lastError: undefined })
      this.updateStatus('connected', {
        connectedAt: now,
        lastConnectedAt: now,
        errorMessage: undefined,
      })
      this.pollPromise = this.pollLoop(this.abortController.signal)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.patchRuntimeState({ lastError: message })
      this.updateStatus('error', { errorMessage: message })
      throw error
    }
  }

  stop(): void {
    this.abortController?.abort()
    this.abortController = null
    this.pollPromise = null
    this.aggregator.flushAll()
    this.stopTyping()
    this.updateStatus('disconnected', { errorMessage: undefined })
  }

  async sendMessage(input: BridgeOutboundMessage): Promise<void> {
    const peerId = input.providerContext?.wechat?.peerId || input.chatId
    const context = this.deps.contextStore.get(this.accountId, peerId)
    const contextToken = input.providerContext?.wechat?.contextToken || context?.contextToken
    if (!contextToken) {
      this.deps.deferredStore.enqueue({
        accountId: this.accountId,
        peerId,
        sessionId: input.providerContext?.wechat?.sessionId || '',
        reason: input.deliveryKind === 'command'
          ? 'command'
          : input.deliveryKind === 'system'
            ? 'system'
            : 'assistant',
        ttlMs: this.deps.getConfig().deferredOutboundTtlMs,
        payload: input,
      })
      return
    }

    const typingTicket = input.providerContext?.wechat?.typingTicket || context?.typingTicket
    await this.startTyping(peerId, typingTicket)
    try {
      const chunks = chunkOutboundMessage({ channelType: 'wechat', text: input.text })
      for (const chunk of chunks) {
        await this.client.sendMessage({
          contextToken,
          toUserId: peerId,
          text: chunk.text,
          attachments: input.attachments,
        })
      }
    } finally {
      await this.stopTyping(peerId, typingTicket)
    }
  }

  async downloadAttachments(attachments: BridgeInboundMessage['attachments'], sessionId: string) {
    return this.deps.mediaService.downloadAttachments(attachments, sessionId)
  }

  /**
   * 长轮询主循环
   *
   * 与 Telegram 同一套约束：只有请求成功才把状态改回 connected（禁止谎报），
   * 失败走指数退避，401/403 这类不可重试错误直接停止轮询。
   */
  private async pollLoop(signal: AbortSignal): Promise<void> {
    let failureAttempt = 0

    while (!signal.aborted) {
      try {
        const runtime = this.deps.getRuntimeState()
        const batch = await this.client.getUpdates({
          getUpdatesBuf: runtime?.getUpdatesBuf,
          timeoutSeconds: 25,
          signal,
        })

        if (batch.errcode === WECHAT_SESSION_EXPIRED_CODE) {
          if (runtime?.getUpdatesBuf) {
            this.patchRuntimeState({ getUpdatesBuf: '', lastConnectedAt: Date.now(), lastError: undefined })
            await new Promise((resolve) => setTimeout(resolve, 5000))
            continue
          }
          this.patchRuntimeState({ lastError: 'WeChat session expired; relogin required' })
          this.updateStatus('token_expired', { errorMessage: '微信 iLink 会话已过期，请重新扫码登录。' })
          return
        }

        if (typeof batch.ret === 'number' && batch.ret !== 0 && batch.errcode) {
          throw new Error(batch.errmsg || `WeChat getupdates failed: ret=${batch.ret} errcode=${batch.errcode}`)
        }

        failureAttempt = 0
        this.markPollSucceeded()

        const messages = this.getBatchMessages(batch)
        for (const raw of messages) {
          try {
            await this.handleRawMessage(raw)
          } catch (error) {
            log.error('[IM Bridge][WeChat] 处理单条入站消息失败，已跳过', error)
          }
        }

        const nextBuf = batch.get_updates_buf || batch.getUpdatesBuf
        if (nextBuf) {
          this.patchRuntimeState({ getUpdatesBuf: nextBuf, lastConnectedAt: Date.now(), lastError: undefined })
        }
      } catch (error) {
        if (signal.aborted) return
        const message = error instanceof Error ? error.message : String(error)
        this.patchRuntimeState({ lastError: message })
        this.updateStatus('error', { errorMessage: message })

        const classification = classifyPollFailure(error)
        if (!classification.retryable) {
          log.error(`[IM Bridge][WeChat] 轮询遇到不可重试错误，已停止：${message}`)
          return
        }

        failureAttempt += 1
        await sleepWithSignal(computePollBackoffDelayMs(failureAttempt), signal)
      }
    }
  }

  /** 只在请求成功后回到 connected；失败期间保持 error，让外层退避真正生效 */
  private markPollSucceeded(): void {
    if (this.lastStatus.status === 'connected' && !this.lastStatus.errorMessage) return
    this.updateStatus('connected', { errorMessage: undefined, lastConnectedAt: Date.now() })
  }

  private getBatchMessages(batch: { msgs?: WeChatIlinkRawMessage[]; update_list?: WeChatIlinkRawMessage[]; updates?: WeChatIlinkRawMessage[]; messages?: WeChatIlinkRawMessage[] }): WeChatIlinkRawMessage[] {
    return batch.msgs ?? batch.update_list ?? batch.updates ?? batch.messages ?? []
  }

  private async handleRawMessage(raw: WeChatIlinkRawMessage): Promise<void> {
    if (raw.message_type && raw.message_type !== 1) return
    if (typeof raw.message_state === 'number' && raw.message_state !== 2) return
    let typingTicket: string | undefined
    const peerId = raw.from_user_id || raw.peer_id || raw.peerId || raw.fromUserId || raw.from_user_id
    const contextToken = raw.context_token || raw.contextToken
    if (peerId && contextToken) {
      typingTicket = await this.client.getConfig({
        userId: peerId,
        contextToken,
      }).then((config) => config.typing_ticket || config.typingTicket).catch(() => undefined)
    }
    const parsed = parseWeChatInbound({
      accountId: this.accountId,
      raw,
      typingTicket,
    })
    if (!parsed) return

    if (parsed.context) {
      this.deps.contextStore.upsert(parsed.context)
    }
    this.aggregator.ingest(parsed.message)
  }

  private async emitInbound(message: BridgeInboundMessage): Promise<void> {
    this.deps.emit({ type: 'message', message })
    const ctx = message.providerContext?.wechat
    if (!ctx) return

    for (const entry of this.deps.deferredStore.takeForPeer(ctx.accountId, ctx.peerId)) {
      await this.sendMessage({
        ...entry.payload,
        providerContext: {
          ...entry.payload.providerContext,
          wechat: {
            ...entry.payload.providerContext?.wechat,
            accountId: ctx.accountId,
            peerId: ctx.peerId,
            contextToken: ctx.contextToken,
            sessionId: ctx.sessionId,
            typingTicket: ctx.typingTicket,
          },
        },
      })
    }
  }

  private patchRuntimeState(patch: Partial<WeChatAccountRuntimeState>): void {
    const current = this.deps.getRuntimeState()
    this.deps.saveRuntimeState({
      accountId: this.accountId,
      ...current,
      ...patch,
    })
  }

  private updateStatus(status: BridgeChannelStatus['status'], patch?: Partial<BridgeChannelStatus>): void {
    this.lastStatus = statusFor(this.deps.account, status, patch)
    this.deps.onStatus(this.lastStatus)
  }

  private async startTyping(peerId: string, typingTicket?: string): Promise<void> {
    if (!typingTicket) return
    await this.client.sendTyping({ userId: peerId, typingTicket, status: 'typing' }).catch(() => {})
    this.typingTimer = setInterval(() => {
      void this.client.sendTyping({ userId: peerId, typingTicket, status: 'typing' }).catch(() => {})
    }, 8000)
  }

  private async stopTyping(peerId?: string, typingTicket?: string): Promise<void> {
    if (this.typingTimer) {
      clearInterval(this.typingTimer)
      this.typingTimer = null
    }
    if (peerId && typingTicket) {
      await this.client.sendTyping({ userId: peerId, typingTicket, status: 'cancel' }).catch(() => {})
    }
  }
}
