import type {
  WeChatBridgeLoginState,
  WeChatBridgeStartLoginInput,
} from '@kila/shared'
import QRCode from 'qrcode'
import { WeChatIlinkClient } from './client'
import { WeChatCredentialStore } from './credential-store'
import type {
  WeChatIlinkLoginStatusResponse,
  WeChatLoginTicket,
} from './types'
import { DEFAULT_WECHAT_ILINK_BASE_URL } from './types'

interface WeChatLoginManagerDeps {
  credentialStore: WeChatCredentialStore
  getBaseUrl?: () => string
  createClient?: () => WeChatIlinkClient
  now?: () => number
  onStateChanged?: (state: WeChatBridgeLoginState) => void
  onAccountSaved?: (accountId: string) => void
}

function normalizeStatus(status?: string): WeChatLoginTicket['status'] {
  const value = (status || '').toLowerCase()
  if (value.includes('scan') && !value.includes('wait')) return 'scanned'
  if (value.includes('confirm') || value.includes('success') || value.includes('login')) return 'confirmed'
  if (value.includes('expire')) return 'expired'
  if (value.includes('redirect')) return 'redirected'
  if (value.includes('error') || value.includes('fail')) return 'error'
  return 'waiting_scan'
}

function toState(ticket: WeChatLoginTicket): WeChatBridgeLoginState {
  return {
    accountId: ticket.accountId,
    status: ticket.status,
    qrCodeDataUrl: ticket.qrCodeDataUrl,
    message: ticket.message,
    errorMessage: ticket.errorMessage,
    updatedAt: ticket.updatedAt,
  }
}

function responseAccountId(response: WeChatIlinkLoginStatusResponse, fallback: string): string {
  return response.accountId
    || response.account_id
    || response.ilinkBotId
    || response.ilink_bot_id
    || fallback
}

export class WeChatLoginManager {
  private readonly activeTickets = new Map<string, WeChatLoginTicket>()
  private readonly now: () => number

  constructor(private readonly deps: WeChatLoginManagerDeps) {
    this.now = deps.now ?? (() => Date.now())
  }

  private get baseUrl(): string {
    return this.deps.getBaseUrl?.() || process.env.KILA_WECHAT_ILINK_BASE_URL || DEFAULT_WECHAT_ILINK_BASE_URL
  }

  listStates(): WeChatBridgeLoginState[] {
    return Array.from(this.activeTickets.values()).map(toState)
  }

  getState(accountId: string): WeChatBridgeLoginState | null {
    const ticket = this.activeTickets.get(accountId)
    return ticket ? toState(ticket) : null
  }

  async start(input?: WeChatBridgeStartLoginInput): Promise<WeChatBridgeLoginState> {
    const now = this.now()
    const accountId = input?.accountId?.trim() || `pending-${now}`
    const label = input?.label?.trim() || accountId
    try {
      const client = this.deps.createClient?.() ?? new WeChatIlinkClient({
        baseUrl: this.baseUrl,
      })

      const response = await client.startLogin({
        accountId: input?.accountId,
        label,
        botType: input?.botType,
      })
      const ticketId = response.qrcode || response.ticket || accountId
      const scanUrl = response.qrcode_img_content || response.qrcode_img_url || response.qrcode_url || response.url
      const qrCodeDataUrl = scanUrl
        ? await QRCode.toDataURL(scanUrl, { width: 280, margin: 2 })
        : undefined
      const ticket: WeChatLoginTicket = {
        accountId,
        label,
        ticket: ticketId,
        qrCodeDataUrl,
        status: normalizeStatus(response.status),
        message: response.message,
        createdAt: now,
        updatedAt: now,
      }
      this.activeTickets.set(accountId, ticket)
      this.emit(ticket)
      return toState(ticket)
    } catch (error) {
      const ticket: WeChatLoginTicket = {
        accountId,
        label,
        ticket: accountId,
        status: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
        createdAt: now,
        updatedAt: now,
      }
      this.activeTickets.set(accountId, ticket)
      this.emit(ticket)
      return toState(ticket)
    }
  }

  async refresh(accountId: string): Promise<WeChatBridgeLoginState> {
    const ticket = this.activeTickets.get(accountId)
    if (!ticket) {
      return {
        accountId,
        status: 'idle',
        updatedAt: this.now(),
      }
    }

    const client = this.deps.createClient?.() ?? new WeChatIlinkClient({
      baseUrl: this.baseUrl,
    })

    try {
      const response = await client.refreshLogin(ticket.ticket)
      const status = normalizeStatus(response.status)
      const nextAccountId = responseAccountId(response, accountId)
      const next: WeChatLoginTicket = {
        ...ticket,
        accountId: nextAccountId,
        status,
        message: response.message,
        updatedAt: this.now(),
      }

      if (status === 'confirmed') {
        const botToken = response.botToken || response.bot_token
        const ilinkUserId = response.ilinkUserId || response.ilink_user_id || nextAccountId
        const ilinkBotId = response.ilinkBotId || response.ilink_bot_id || nextAccountId
        if (!botToken) {
          next.status = 'error'
          next.errorMessage = 'iLink login succeeded without bot token'
        } else {
          this.deps.credentialStore.saveCredential({
            accountId: nextAccountId,
            label: response.label || ticket.label,
            ilinkUserId,
            ilinkBotId,
            baseUrl: response.baseUrl || response.base_url || response.baseurl || this.baseUrl,
            botToken,
            enabled: true,
          })
          this.activeTickets.delete(accountId)
          this.deps.onAccountSaved?.(nextAccountId)
        }
      }

      if (this.activeTickets.has(accountId)) {
        this.activeTickets.set(accountId, next)
      }
      this.emit(next)
      return toState(next)
    } catch (error) {
      const next: WeChatLoginTicket = {
        ...ticket,
        status: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
        updatedAt: this.now(),
      }
      this.activeTickets.set(accountId, next)
      this.emit(next)
      return toState(next)
    }
  }

  cancel(accountId: string): void {
    const ticket = this.activeTickets.get(accountId)
    this.activeTickets.delete(accountId)
    if (ticket) {
      this.deps.onStateChanged?.({
        accountId: ticket.accountId,
        status: 'idle',
        qrCodeDataUrl: ticket.qrCodeDataUrl,
        message: ticket.message,
        errorMessage: ticket.errorMessage,
        updatedAt: this.now(),
      })
    }
  }

  private emit(ticket: WeChatLoginTicket): void {
    this.deps.onStateChanged?.(toState(ticket))
  }
}
