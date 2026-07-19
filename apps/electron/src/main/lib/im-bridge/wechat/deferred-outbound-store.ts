import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { BridgeOutboundMessage } from '../adapters/base-adapter'
import { getImBridgeWechatDeferredOutboundPath } from '../../config-paths-bridge'
import type { WeChatDeferredOutboundEntry } from './types'

interface WeChatDeferredOutboundStoreDeps {
  getDeferredPath?: () => string
  now?: () => number
  createId?: () => string
}

function readJson<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T
  } catch {
    return fallback
  }
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8')
}

export class WeChatDeferredOutboundStore {
  private readonly getDeferredPath: () => string
  private readonly now: () => number
  private readonly createId: () => string

  constructor(deps?: WeChatDeferredOutboundStoreDeps) {
    this.getDeferredPath = deps?.getDeferredPath ?? getImBridgeWechatDeferredOutboundPath
    this.now = deps?.now ?? (() => Date.now())
    this.createId = deps?.createId ?? (() => randomUUID())
  }

  list(): WeChatDeferredOutboundEntry[] {
    const raw = readJson<WeChatDeferredOutboundEntry[]>(this.getDeferredPath(), [])
    const now = this.now()
    return Array.isArray(raw)
      ? raw.filter((entry) => entry.expiresAt > now)
      : []
  }

  enqueue(input: {
    accountId: string
    peerId: string
    sessionId: string
    reason: WeChatDeferredOutboundEntry['reason']
    ttlMs: number
    payload: BridgeOutboundMessage
  }): WeChatDeferredOutboundEntry {
    const now = this.now()
    const entry: WeChatDeferredOutboundEntry = {
      id: this.createId(),
      channelType: 'wechat',
      accountId: input.accountId,
      peerId: input.peerId,
      sessionId: input.sessionId,
      reason: input.reason,
      payload: input.payload,
      createdAt: now,
      expiresAt: now + input.ttlMs,
    }
    this.save([...this.list(), entry])
    return entry
  }

  takeForPeer(accountId: string, peerId: string): WeChatDeferredOutboundEntry[] {
    const entries = this.list()
    const selected = entries.filter((entry) => entry.accountId === accountId && entry.peerId === peerId)
    if (selected.length > 0) {
      this.save(entries.filter((entry) => !(entry.accountId === accountId && entry.peerId === peerId)))
    }
    return selected
  }

  removeAccount(accountId: string): void {
    this.save(this.list().filter((entry) => entry.accountId !== accountId))
  }

  private save(entries: WeChatDeferredOutboundEntry[]): void {
    writeJson(this.getDeferredPath(), entries)
  }
}
