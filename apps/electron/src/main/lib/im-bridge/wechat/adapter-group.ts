import type {
  BridgeChannelStatus,
  BridgeAdapterCapabilities,
  BridgeRuntimeState,
  BridgeTestResult,
  FileAttachment,
  WeChatBridgeAccountEntry,
  WeChatBridgeAccountStatus,
  WeChatBridgeConfig,
  WeChatBridgeLoginState,
  WeChatBridgeStartLoginInput,
} from '@kila/shared'
import { BaseImAdapter } from '../adapters/base-adapter'
import type {
  BridgeAttachmentReference,
  BridgeAdapterEvent,
  BridgeOutboundMessage,
  BridgePermissionPromptMessage,
} from '../adapters/base-adapter'
import { WeChatAccountRuntime } from './account-runtime'
import { WeChatContextStore } from './context-store'
import { WeChatCredentialStore } from './credential-store'
import { WeChatDeferredOutboundStore } from './deferred-outbound-store'
import { WeChatLoginManager } from './login-manager'
import { WeChatMediaService } from './media-service'
import type { WeChatCredential } from './types'

interface WeChatAdapterGroupDeps {
  getConfig: () => WeChatBridgeConfig
  getRuntimeState: () => BridgeRuntimeState
  saveRuntimeState: (state: BridgeRuntimeState) => void
  credentialStore?: WeChatCredentialStore
  contextStore?: WeChatContextStore
  deferredStore?: WeChatDeferredOutboundStore
  mediaService?: WeChatMediaService
  createRuntime?: (input: {
    account: WeChatBridgeAccountEntry
    credential: WeChatCredential
  }) => WeChatAccountRuntime
  onAccountStatusChanged?: (status: WeChatBridgeAccountStatus) => void
  onLoginStateChanged?: (state: WeChatBridgeLoginState) => void
  onAccountsChanged?: (accountId?: string) => void
}

function statusToAccountStatus(accountId: string, status: BridgeChannelStatus): WeChatBridgeAccountStatus {
  return {
    accountId,
    enabled: status.enabled,
    status: status.status,
    connectedAt: status.connectedAt,
    lastConnectedAt: status.lastConnectedAt,
    errorMessage: status.errorMessage,
  }
}

function aggregateWechatStatus(
  enabled: boolean,
  statuses: BridgeChannelStatus[],
): BridgeChannelStatus {
  if (!enabled) {
    return { channel: 'wechat', enabled, status: 'disconnected' }
  }
  if (statuses.some((status) => status.status === 'connected')) {
    const connected = statuses.find((status) => status.status === 'connected')
    return {
      channel: 'wechat',
      enabled,
      status: 'connected',
      connectedAt: connected?.connectedAt,
      lastConnectedAt: connected?.lastConnectedAt,
    }
  }
  if (statuses.some((status) => status.status === 'connecting')) {
    return { channel: 'wechat', enabled, status: 'connecting' }
  }
  if (statuses.some((status) => status.status === 'error' || status.status === 'token_expired')) {
    const error = statuses.find((status) => status.errorMessage)
    return {
      channel: 'wechat',
      enabled,
      status: 'error',
      errorMessage: error?.errorMessage,
    }
  }
  return { channel: 'wechat', enabled, status: 'disconnected' }
}

export class WeChatAdapterGroup extends BaseImAdapter {
  readonly channelType = 'wechat' as const
  readonly capabilities: BridgeAdapterCapabilities = {
    approvalMode: 'text_code',
    supportsTyping: true,
    supportsDeferredOutbound: true,
    supportsMediaUpload: true,
    outboundTextLimit: 4000,
  }

  private readonly credentialStore: WeChatCredentialStore
  private readonly contextStore: WeChatContextStore
  private readonly deferredStore: WeChatDeferredOutboundStore
  private readonly mediaService: WeChatMediaService
  private readonly loginManager: WeChatLoginManager
  private readonly runtimes = new Map<string, WeChatAccountRuntime>()
  private readonly accountStatuses = new Map<string, BridgeChannelStatus>()

  constructor(private readonly deps: WeChatAdapterGroupDeps) {
    super('wechat')
    this.credentialStore = deps.credentialStore ?? new WeChatCredentialStore()
    this.contextStore = deps.contextStore ?? new WeChatContextStore()
    this.deferredStore = deps.deferredStore ?? new WeChatDeferredOutboundStore()
    this.mediaService = deps.mediaService ?? new WeChatMediaService({
      getMaxBytes: () => this.deps.getConfig().maxInboundFileBytes,
    })
    this.loginManager = new WeChatLoginManager({
      credentialStore: this.credentialStore,
      getBaseUrl: () => this.deps.getConfig().baseUrl,
      onStateChanged: (state) => this.deps.onLoginStateChanged?.(state),
      onAccountSaved: (accountId) => this.deps.onAccountsChanged?.(accountId),
    })
  }

  listAccounts(): WeChatBridgeAccountEntry[] {
    return this.credentialStore.listAccounts()
  }

  getLoginState(accountId: string): WeChatBridgeLoginState | null {
    return this.loginManager.getState(accountId)
  }

  startLogin(input?: WeChatBridgeStartLoginInput): Promise<WeChatBridgeLoginState> {
    return this.loginManager.start(input)
  }

  refreshLogin(accountId: string): Promise<WeChatBridgeLoginState> {
    return this.loginManager.refresh(accountId)
  }

  cancelLogin(accountId: string): void {
    this.loginManager.cancel(accountId)
  }

  async reloginAccount(accountId: string): Promise<WeChatBridgeLoginState> {
    this.stopAccount(accountId)
    return this.startLogin({ accountId })
  }

  removeAccount(accountId: string): void {
    this.stopAccount(accountId)
    this.credentialStore.removeAccount(accountId)
    this.contextStore.removeAccount(accountId)
    this.deferredStore.removeAccount(accountId)
    this.deps.onAccountsChanged?.()
    this.emitAggregateStatus()
  }

  async startAccount(accountId: string): Promise<WeChatBridgeAccountStatus> {
    const runtime = this.getOrCreateRuntime(accountId)
    if (!runtime) {
      throw new Error(`WeChat account is not configured: ${accountId}`)
    }
    await runtime.start()
    this.emitAggregateStatus()
    return statusToAccountStatus(accountId, runtime.getStatus())
  }

  stopAccount(accountId: string): WeChatBridgeAccountStatus {
    const runtime = this.runtimes.get(accountId)
    runtime?.stop()
    this.runtimes.delete(accountId)
    const account = this.credentialStore.getAccount(accountId)
    const status: BridgeChannelStatus = {
      channel: 'wechat',
      enabled: account?.enabled ?? false,
      status: 'disconnected',
    }
    this.accountStatuses.set(accountId, status)
    this.deps.onAccountStatusChanged?.(statusToAccountStatus(accountId, status))
    this.emitAggregateStatus()
    return statusToAccountStatus(accountId, status)
  }

  async testConnection(): Promise<BridgeTestResult> {
    const accounts = this.listAccounts().filter((account) => account.enabled)
    if (accounts.length === 0) {
      return {
        channel: 'wechat',
        success: false,
        message: 'WeChat bridge has no enabled account',
      }
    }
    const account = accounts[0]
    if (!account) {
      return {
        channel: 'wechat',
        success: false,
        message: 'WeChat bridge has no enabled account',
      }
    }

    try {
      const runtime = this.getOrCreateRuntime(account.accountId)
      if (!runtime) throw new Error('WeChat credential is missing')
      await runtime.testConnection()
      return {
        channel: 'wechat',
        success: true,
        message: `WeChat account is reachable: ${account.label}`,
      }
    } catch (error) {
      return {
        channel: 'wechat',
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async start(): Promise<void> {
    const config = this.deps.getConfig()
    if (!config.enabled) {
      this.emitAggregateStatus()
      return
    }

    const configuredIds = config.accountIds.length > 0
      ? new Set(config.accountIds)
      : null
    const accounts = this.listAccounts().filter((account) => (
      account.enabled && (!configuredIds || configuredIds.has(account.accountId))
    ))

    const tasks = accounts.map((account) => this.startAccount(account.accountId))
    await Promise.allSettled(tasks)
    this.emitAggregateStatus()
  }

  stop(): void {
    for (const accountId of Array.from(this.runtimes.keys())) {
      this.stopAccount(accountId)
    }
    this.emitAggregateStatus()
  }

  async sendMessage(input: BridgeOutboundMessage): Promise<void> {
    const accountId = input.providerContext?.wechat?.accountId
    if (!accountId) {
      throw new Error('WeChat outbound message is missing accountId')
    }
    const runtime = this.getOrCreateRuntime(accountId)
    if (!runtime) {
      throw new Error(`WeChat account is not running or configured: ${accountId}`)
    }
    await runtime.sendMessage(input)
  }

  async sendPermissionPrompt(input: BridgePermissionPromptMessage): Promise<void> {
    await this.sendMessage({
      chatId: input.chatId,
      threadId: input.threadId,
      text: input.promptText,
      deliveryKind: 'system',
      providerContext: {
        wechat: {
          accountId: input.providerContext?.wechat?.accountId ?? '',
          peerId: input.providerContext?.wechat?.peerId ?? input.chatId,
          contextToken: input.providerContext?.wechat?.contextToken,
          sessionId: input.sessionId,
          typingTicket: input.providerContext?.wechat?.typingTicket,
        },
      },
    })
  }

  async downloadAttachments(attachments: BridgeAttachmentReference[], sessionId: string): Promise<FileAttachment[]> {
    const accountId = attachments[0]?.providerPayload?.wechat?.accountId
    const runtime = accountId ? this.runtimes.get(accountId) : null
    if (runtime) {
      return runtime.downloadAttachments(attachments, sessionId)
    }
    return this.mediaService.downloadAttachments(attachments, sessionId)
  }

  override getStatus(): BridgeChannelStatus {
    return { ...this.status }
  }

  private getOrCreateRuntime(accountId: string): WeChatAccountRuntime | null {
    const existing = this.runtimes.get(accountId)
    if (existing) return existing

    const account = this.credentialStore.getAccount(accountId)
    const credential = this.credentialStore.getCredential(accountId)
    if (!account || !credential) return null

    const runtime = this.deps.createRuntime?.({ account, credential }) ?? new WeChatAccountRuntime({
      account,
      credential,
      getConfig: () => this.deps.getConfig(),
      getRuntimeState: () => this.deps.getRuntimeState().wechat?.[accountId],
      saveRuntimeState: (state) => {
        const current = this.deps.getRuntimeState()
        this.deps.saveRuntimeState({
          ...current,
          wechat: {
            ...current.wechat,
            [accountId]: state,
          },
        })
      },
      contextStore: this.contextStore,
      deferredStore: this.deferredStore,
      mediaService: this.mediaService,
      emit: (event) => this.emit(event),
      onStatus: (status) => this.recordAccountStatus(accountId, status),
    })

    this.runtimes.set(accountId, runtime)
    return runtime
  }

  private recordAccountStatus(accountId: string, status: BridgeChannelStatus): void {
    this.accountStatuses.set(accountId, status)
    this.deps.onAccountStatusChanged?.(statusToAccountStatus(accountId, status))
    this.emitAggregateStatus()
  }

  private emitAggregateStatus(): void {
    const config = this.deps.getConfig()
    this.status = aggregateWechatStatus(config.enabled, Array.from(this.accountStatuses.values()))
    for (const handler of this.statusHandlers) {
      handler(this.getStatus())
    }
  }
}
