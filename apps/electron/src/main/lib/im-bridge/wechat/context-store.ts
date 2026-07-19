import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { getImBridgeWechatContextsPath } from '../../config-paths-bridge'
import type { WeChatContextEntry } from './types'

interface WeChatContextStoreDeps {
  getContextsPath?: () => string
  now?: () => number
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

function contextKey(accountId: string, peerId: string): string {
  return `${accountId}:${peerId}`
}

export class WeChatContextStore {
  private readonly getContextsPath: () => string
  private readonly now: () => number

  constructor(deps?: WeChatContextStoreDeps) {
    this.getContextsPath = deps?.getContextsPath ?? getImBridgeWechatContextsPath
    this.now = deps?.now ?? (() => Date.now())
  }

  list(): WeChatContextEntry[] {
    const raw = readJson<Record<string, WeChatContextEntry>>(this.getContextsPath(), {})
    return Object.values(raw)
  }

  get(accountId: string, peerId: string): WeChatContextEntry | null {
    const raw = readJson<Record<string, WeChatContextEntry>>(this.getContextsPath(), {})
    return raw[contextKey(accountId, peerId)] ?? null
  }

  upsert(input: {
    accountId: string
    peerId: string
    contextToken?: string
    sessionId?: string
    typingTicket?: string
  }): WeChatContextEntry | null {
    const token = input.contextToken?.trim()
    const existing = this.get(input.accountId, input.peerId)
    if (!token && !existing) return null

    const next: WeChatContextEntry = {
      accountId: input.accountId,
      peerId: input.peerId,
      contextToken: token || existing?.contextToken || '',
      sessionId: input.sessionId ?? existing?.sessionId,
      typingTicket: input.typingTicket ?? existing?.typingTicket,
      lastSeenAt: this.now(),
    }

    const raw = readJson<Record<string, WeChatContextEntry>>(this.getContextsPath(), {})
    raw[contextKey(input.accountId, input.peerId)] = next
    writeJson(this.getContextsPath(), raw)
    return next
  }

  removeAccount(accountId: string): void {
    const raw = readJson<Record<string, WeChatContextEntry>>(this.getContextsPath(), {})
    for (const key of Object.keys(raw)) {
      if (raw[key]?.accountId === accountId) {
        delete raw[key]
      }
    }
    writeJson(this.getContextsPath(), raw)
  }
}
