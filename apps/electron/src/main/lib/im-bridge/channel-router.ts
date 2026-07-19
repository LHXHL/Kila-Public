import type { BridgeBinding, BridgeChannelType } from '@kila/shared'
import type { SessionCreateInput, SessionMeta } from '@kila/shared'

export interface ResolveBridgeEndpointInput {
  channelType: BridgeBinding['channelType']
  endpointKey: string
  chatId: string
  threadId?: string
  userId?: string
  accountId?: string
  peerId?: string
  peerType?: 'user' | 'group'
  displayName?: string
}

interface ChannelRouterDeps {
  listBindings: () => BridgeBinding[]
  saveBindings: (bindings: BridgeBinding[]) => void
  getSessionMeta: (sessionId: string) => SessionMeta | undefined
  createSession: (input: SessionCreateInput) => SessionMeta
  updateSessionProject?: (sessionId: string, projectPath: string) => void
  watchSessionProject?: (sessionId: string, projectPath: string) => void
  getDefaultSessionCreateInput?: () => Partial<SessionCreateInput>
  resolveProjectPath?: (endpointKey: string, channelType: BridgeChannelType) => string | undefined
}

function buildDefaultTitle(input: ResolveBridgeEndpointInput): string {
  if (input.displayName?.trim()) {
    return input.displayName.trim()
  }

  switch (input.channelType) {
    case 'telegram':
      return 'Telegram 会话'
    case 'discord':
      return 'Discord 会话'
    case 'feishu':
      return 'Feishu 会话'
    case 'wechat':
      return '微信会话'
  }
}

function buildSourceLabel(input: ResolveBridgeEndpointInput): string {
  return input.channelType.toUpperCase()
}

export class ChannelRouter {
  constructor(private readonly deps: ChannelRouterDeps) {}

  listBindings(): BridgeBinding[] {
    return this.deps.listBindings()
  }

  private createReplacementSession(
    input: ResolveBridgeEndpointInput,
    projectPath?: string,
  ): SessionMeta {
    const defaults = this.deps.getDefaultSessionCreateInput?.()
    const session = this.deps.createSession({
      title: buildDefaultTitle(input),
      messageSource: 'im-bridge',
      messageSourceLabel: buildSourceLabel(input),
      ...defaults,
      projectPath: projectPath ?? defaults?.projectPath,
    })

    this.deps.watchSessionProject?.(session.id, session.project.path)
    return session
  }

  resolveOrCreateBinding(input: ResolveBridgeEndpointInput): BridgeBinding {
    const now = Date.now()
    const bindings = this.deps.listBindings()
    const existing = bindings.find((binding) => binding.endpointKey === input.endpointKey)

    // 解析 projectPath：binding 级 > deps 注入（config/channel 级）
    const resolveProjectPathFor = (binding?: Pick<BridgeBinding, 'projectPath'>): string | undefined => {
      if (binding?.projectPath) return binding.projectPath
      return this.deps.resolveProjectPath?.(input.endpointKey, input.channelType)
    }

    if (existing) {
      const session = this.deps.getSessionMeta(existing.sessionId)
      if (session) {
        const nextBinding: BridgeBinding = {
          ...existing,
          chatId: input.chatId,
          threadId: input.threadId,
          userId: input.userId ?? existing.userId,
          accountId: input.accountId ?? existing.accountId,
          peerId: input.peerId ?? existing.peerId,
          peerType: input.peerType ?? existing.peerType,
          displayName: input.displayName ?? existing.displayName,
          updatedAt: now,
        }
        const nextBindings = bindings.map((binding) => (
          binding.endpointKey === nextBinding.endpointKey ? nextBinding : binding
        ))
        this.deps.saveBindings(nextBindings)
        return nextBinding
      }

      const projectPath = resolveProjectPathFor(existing)
      const replacement = this.createReplacementSession(input, projectPath)
      const nextBinding: BridgeBinding = {
        ...existing,
        chatId: input.chatId,
        threadId: input.threadId,
        userId: input.userId ?? existing.userId,
        accountId: input.accountId ?? existing.accountId,
        peerId: input.peerId ?? existing.peerId,
        peerType: input.peerType ?? existing.peerType,
        displayName: input.displayName ?? existing.displayName,
        sessionId: replacement.id,
        projectPath,
        updatedAt: now,
      }
      this.deps.saveBindings(bindings.map((binding) => (
        binding.endpointKey === nextBinding.endpointKey ? nextBinding : binding
      )))
      return nextBinding
    }

    const projectPath = resolveProjectPathFor()
    const session = this.createReplacementSession(input, projectPath)
    const nextBinding: BridgeBinding = {
      channelType: input.channelType,
      endpointKey: input.endpointKey,
      chatId: input.chatId,
      threadId: input.threadId,
      userId: input.userId,
      accountId: input.accountId,
      peerId: input.peerId,
      peerType: input.peerType,
      sessionId: session.id,
      projectPath,
      displayName: input.displayName,
      createdAt: now,
      updatedAt: now,
    }

    this.deps.saveBindings([...bindings, nextBinding])
    return nextBinding
  }

  updateBinding(endpointKey: string, sessionId: string): BridgeBinding | null {
    if (!this.deps.getSessionMeta(sessionId)) {
      return null
    }

    const bindings = this.deps.listBindings()
    const existing = bindings.find((binding) => binding.endpointKey === endpointKey)
    if (!existing) return null

    const nextBinding: BridgeBinding = {
      ...existing,
      sessionId,
      updatedAt: Date.now(),
    }

    this.deps.saveBindings(bindings.map((binding) => (
      binding.endpointKey === endpointKey ? nextBinding : binding
    )))
    return nextBinding
  }

  removeBinding(endpointKey: string): boolean {
    const bindings = this.deps.listBindings()
    const nextBindings = bindings.filter((binding) => binding.endpointKey !== endpointKey)
    if (nextBindings.length === bindings.length) {
      return false
    }

    this.deps.saveBindings(nextBindings)
    return true
  }

  updateBindingProjectPath(endpointKey: string, projectPath: string): {
    binding: BridgeBinding
    sessionReplaced: boolean
  } {
    const bindings = this.deps.listBindings()
    const existing = bindings.find((binding) => binding.endpointKey === endpointKey)
    if (!existing) throw new Error('Binding 不存在')

    const session = this.deps.getSessionMeta(existing.sessionId)
    if (!session) throw new Error('Session 不存在')

    const now = Date.now()
    const nextBinding: BridgeBinding = { ...existing, projectPath, updatedAt: now }

    // session 未锁定 → 同步更新 session project 和 binding
    if (!session.project.lockedAt) {
      this.deps.updateSessionProject?.(session.id, projectPath)
      this.deps.saveBindings(bindings.map((binding) => (
        binding.endpointKey === endpointKey ? nextBinding : binding
      )))
      return { binding: nextBinding, sessionReplaced: false }
    }

    // session 已锁定 → 创建新 session 并 rebind
    const newSession = this.createReplacementSession(
      {
        channelType: existing.channelType,
        endpointKey: existing.endpointKey,
        chatId: existing.chatId,
        threadId: existing.threadId,
        userId: existing.userId,
        accountId: existing.accountId,
        peerId: existing.peerId,
        peerType: existing.peerType,
        displayName: existing.displayName,
      },
      projectPath,
    )
    const reboundBinding: BridgeBinding = { ...nextBinding, sessionId: newSession.id }
    this.deps.saveBindings(bindings.map((binding) => (
      binding.endpointKey === endpointKey ? reboundBinding : binding
    )))
    return { binding: reboundBinding, sessionReplaced: true }
  }
}
