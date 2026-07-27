import { randomBytes } from 'node:crypto'
import type {
  BridgeAdapterCapabilities,
  BridgePermissionPrompt,
  BridgeChannelType,
  PermissionRequest,
} from '@kila/shared'
import type { PermissionResolution } from '../agent-permission-service'
import type { BridgeSenderIdentity, SenderAllowlistDecision } from './security/sender-allowlist'

interface PendingPermissionPrompt extends BridgePermissionPrompt {
  resolved: boolean
}

interface PermissionBridgeDeps {
  now?: () => number
  ttlMs?: number
  createToken?: () => string
  respondToPermission: (
    requestId: string,
    behavior: 'allow' | 'deny',
    alwaysAllow: boolean,
  ) => PermissionResolution | null
  dispatchPrompt: (prompt: BridgePermissionPrompt) => Promise<void>
  /** 审批人身份校验；与入站消息共用同一份白名单真相源 */
  isActorAllowed?: (
    channelType: BridgeChannelType,
    identity: BridgeSenderIdentity,
  ) => SenderAllowlistDecision
  /** 渠道的审批能力；desktop_only 表示该渠道无法远程审批 */
  getApprovalMode?: (channelType: BridgeChannelType) => BridgeAdapterCapabilities['approvalMode']
}

export interface HandlePermissionRequestInput {
  channelType: BridgeChannelType
  endpointKey: string
  request: PermissionRequest
}

export interface ResolvePermissionActionInput {
  channelType: BridgeChannelType
  callbackToken: string
  endpointKey: string
  userId?: string
  chatId?: string
  behavior: 'allow' | 'deny'
  alwaysAllow: boolean
  now?: number
}

export interface PermissionActionResult {
  ok: boolean
  message: string
  sessionId?: string
}

const UNSUPPORTED_ALWAYS_ALLOW_MESSAGE =
  '远程渠道不支持“总是允许”：这会把危险工具永久写进白名单。请改用“允许一次”，或在 Kila 桌面端处理。'
const UNAUTHORIZED_ACTOR_MESSAGE = '你没有权限处理这条审批请求。'
const DESKTOP_ONLY_DENY_MESSAGE = '该远程渠道不支持审批交互，权限请求已按默认拒绝处理，请在 Kila 桌面端继续。'

export class PermissionBridge {
  private readonly pending = new Map<string, PendingPermissionPrompt>()
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly createToken: () => string

  constructor(private readonly deps: PermissionBridgeDeps) {
    this.now = deps.now ?? (() => Date.now())
    this.ttlMs = deps.ttlMs ?? (10 * 60 * 1000)
    this.createToken = deps.createToken ?? (() => randomBytes(12).toString('base64url'))
  }

  async handlePermissionRequest(input: HandlePermissionRequestInput): Promise<BridgePermissionPrompt> {
    const callbackToken = this.createToken()
    const prompt: PendingPermissionPrompt = {
      channelType: input.channelType,
      endpointKey: input.endpointKey,
      sessionId: input.request.sessionId,
      requestId: input.request.requestId,
      toolName: input.request.toolName,
      description: input.request.description,
      dangerLevel: input.request.dangerLevel,
      callbackToken,
      approvalCode: callbackToken.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase(),
      expiresAt: this.now() + this.ttlMs,
      resolved: false,
    }

    // 无法远程审批的渠道（如飞书）必须“默认拒绝”，而不是挂着等超时或被全放行绕过
    const approvalMode = this.deps.getApprovalMode?.(input.channelType) ?? 'interactive'
    if (approvalMode === 'desktop_only') {
      prompt.resolved = true
      this.deps.respondToPermission(prompt.requestId, 'deny', false)
      await this.deps.dispatchPrompt(prompt)
      return prompt
    }

    this.pending.set(prompt.callbackToken, prompt)
    await this.deps.dispatchPrompt(prompt)
    return prompt
  }

  resolveTextApproval(input: {
    channelType: BridgeChannelType
    approvalCode: string
    endpointKey: string
    userId?: string
    chatId?: string
    behavior: 'allow' | 'deny'
    alwaysAllow: boolean
    now?: number
  }): PermissionActionResult {
    const code = input.approvalCode.trim().toUpperCase()
    const prompt = Array.from(this.pending.values()).find((item) => item.approvalCode === code)
    if (!prompt) {
      return { ok: false, message: '权限审批码不存在或已失效。' }
    }

    return this.resolveAction({
      channelType: input.channelType,
      callbackToken: prompt.callbackToken,
      endpointKey: input.endpointKey,
      userId: input.userId,
      chatId: input.chatId,
      behavior: input.behavior,
      alwaysAllow: input.alwaysAllow,
      now: input.now,
    })
  }

  resolveAction(input: ResolvePermissionActionInput): PermissionActionResult {
    const prompt = this.pending.get(input.callbackToken)
    if (!prompt) {
      return { ok: false, message: '权限操作不存在或已失效。' }
    }

    const now = input.now ?? this.now()
    if (prompt.endpointKey !== input.endpointKey) {
      return { ok: false, message: '权限操作来源不匹配。' }
    }
    if (prompt.resolved) {
      return { ok: false, message: '权限操作已处理。' }
    }
    if (now > prompt.expiresAt) {
      this.pending.delete(input.callbackToken)
      return { ok: false, message: '权限操作已过期。' }
    }

    // 身份校验：Discord/Telegram 的审批按钮任何人都能点，必须在此拦住非授权用户
    const actorDecision = this.deps.isActorAllowed?.(input.channelType, {
      userId: input.userId,
      chatId: input.chatId,
    })
    if (actorDecision && !actorDecision.allowed) {
      return { ok: false, message: actorDecision.message ?? UNAUTHORIZED_ACTOR_MESSAGE }
    }

    // 远程渠道禁止 alwaysAllow：一次误点会把危险工具永久加进白名单
    if (input.alwaysAllow) {
      return { ok: false, message: UNSUPPORTED_ALWAYS_ALLOW_MESSAGE }
    }

    const resolution = this.deps.respondToPermission(prompt.requestId, input.behavior, false)
    if (!resolution) {
      this.pending.delete(input.callbackToken)
      return { ok: false, message: '权限请求不存在。' }
    }

    prompt.resolved = true
    this.pending.delete(input.callbackToken)
    return {
      ok: true,
      message: input.behavior === 'allow' ? '已允许本次操作。' : '已拒绝本次操作。',
      sessionId: resolution.sessionId,
    }
  }
}

export const PERMISSION_BRIDGE_MESSAGES = {
  unsupportedAlwaysAllow: UNSUPPORTED_ALWAYS_ALLOW_MESSAGE,
  unauthorizedActor: UNAUTHORIZED_ACTOR_MESSAGE,
  desktopOnlyDeny: DESKTOP_ONLY_DENY_MESSAGE,
} as const
