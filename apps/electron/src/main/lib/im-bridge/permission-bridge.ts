import { randomBytes } from 'node:crypto'
import type { BridgePermissionPrompt, BridgeChannelType, PermissionRequest } from '@kila/shared'
import type { PermissionResolution } from '../agent-permission-service'

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
}

export interface HandlePermissionRequestInput {
  channelType: BridgeChannelType
  endpointKey: string
  request: PermissionRequest
}

export interface ResolvePermissionActionInput {
  callbackToken: string
  endpointKey: string
  behavior: 'allow' | 'deny'
  alwaysAllow: boolean
  now?: number
}

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

    this.pending.set(prompt.callbackToken, prompt)
    await this.deps.dispatchPrompt(prompt)
    return prompt
  }

  resolveTextApproval(input: {
    approvalCode: string
    endpointKey: string
    behavior: 'allow' | 'deny'
    alwaysAllow: boolean
    now?: number
  }): { ok: boolean; message: string; sessionId?: string } {
    const code = input.approvalCode.trim().toUpperCase()
    const prompt = Array.from(this.pending.values()).find((item) => item.approvalCode === code)
    if (!prompt) {
      return { ok: false, message: '权限审批码不存在或已失效。' }
    }

    return this.resolveAction({
      callbackToken: prompt.callbackToken,
      endpointKey: input.endpointKey,
      behavior: input.behavior,
      alwaysAllow: input.alwaysAllow,
      now: input.now,
    })
  }

  resolveAction(input: ResolvePermissionActionInput): { ok: boolean; message: string; sessionId?: string } {
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

    const resolution = this.deps.respondToPermission(prompt.requestId, input.behavior, input.alwaysAllow)
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
