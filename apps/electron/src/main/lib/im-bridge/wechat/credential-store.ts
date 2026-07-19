import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type {
  WeChatBridgeAccountEntry,
  WeChatBridgeCredentialEntry,
} from '@kila/shared'
import {
  getImBridgeWechatAccountsPath,
  getImBridgeWechatCredentialsPath,
} from '../../config-paths-bridge'
import type { WeChatCredential } from './types'

interface SecretBox {
  isEncryptionAvailable: () => boolean
  encryptString: (plain: string) => string
  decryptString: (encrypted: string) => string
}

interface WeChatCredentialStoreDeps {
  secretBox?: SecretBox
  getAccountsPath?: () => string
  getCredentialsPath?: () => string
}

function createDefaultSecretBox(): SecretBox {
  const { safeStorage } = require('electron') as typeof import('electron')
  return {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (plain) => {
      if (!plain) return ''
      if (!safeStorage.isEncryptionAvailable()) return plain
      return safeStorage.encryptString(plain).toString('base64')
    },
    decryptString: (encrypted) => {
      if (!encrypted) return ''
      if (!safeStorage.isEncryptionAvailable()) return encrypted
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    },
  }
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

function normalizeAccount(account: Partial<WeChatBridgeAccountEntry>): WeChatBridgeAccountEntry | null {
  const accountId = account.accountId?.trim()
  if (!accountId) return null

  return {
    accountId,
    label: account.label?.trim() || accountId,
    ilinkUserId: account.ilinkUserId?.trim() || '',
    ilinkBotId: account.ilinkBotId?.trim() || '',
    baseUrl: account.baseUrl?.trim() || '',
    enabled: account.enabled ?? true,
    createdAt: account.createdAt || Date.now(),
    updatedAt: account.updatedAt || Date.now(),
    lastLoginAt: account.lastLoginAt,
  }
}

export class WeChatCredentialStore {
  private readonly secretBox: SecretBox
  private readonly getAccountsPath: () => string
  private readonly getCredentialsPath: () => string

  constructor(deps?: WeChatCredentialStoreDeps) {
    this.secretBox = deps?.secretBox ?? createDefaultSecretBox()
    this.getAccountsPath = deps?.getAccountsPath ?? getImBridgeWechatAccountsPath
    this.getCredentialsPath = deps?.getCredentialsPath ?? getImBridgeWechatCredentialsPath
  }

  listAccounts(): WeChatBridgeAccountEntry[] {
    const raw = readJson<Partial<WeChatBridgeAccountEntry>[]>(this.getAccountsPath(), [])
    return Array.isArray(raw)
      ? raw.map(normalizeAccount).filter((item): item is WeChatBridgeAccountEntry => Boolean(item))
      : []
  }

  saveAccounts(accounts: WeChatBridgeAccountEntry[]): WeChatBridgeAccountEntry[] {
    writeJson(this.getAccountsPath(), accounts.map((account) => ({
      ...account,
      updatedAt: account.updatedAt || Date.now(),
    })))
    return accounts
  }

  getAccount(accountId: string): WeChatBridgeAccountEntry | null {
    return this.listAccounts().find((account) => account.accountId === accountId) ?? null
  }

  setAccountEnabled(accountId: string, enabled: boolean): WeChatBridgeAccountEntry | null {
    const accounts = this.listAccounts()
    const account = accounts.find((item) => item.accountId === accountId)
    if (!account) return null
    const next = { ...account, enabled, updatedAt: Date.now() }
    this.saveAccounts(accounts.map((item) => item.accountId === accountId ? next : item))
    return next
  }

  saveCredential(input: {
    accountId: string
    label?: string
    ilinkUserId: string
    ilinkBotId: string
    baseUrl: string
    botToken: string
    enabled?: boolean
  }): WeChatBridgeAccountEntry {
    const now = Date.now()
    const accounts = this.listAccounts()
    const existing = accounts.find((item) => item.accountId === input.accountId)
    const account: WeChatBridgeAccountEntry = {
      accountId: input.accountId,
      label: input.label?.trim() || existing?.label || input.accountId,
      ilinkUserId: input.ilinkUserId,
      ilinkBotId: input.ilinkBotId,
      baseUrl: input.baseUrl,
      enabled: input.enabled ?? existing?.enabled ?? true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastLoginAt: now,
    }

    const credentials = this.readCredentials()
    credentials[input.accountId] = {
      accountId: input.accountId,
      botToken: this.secretBox.encryptString(input.botToken),
      ilinkUserId: input.ilinkUserId,
      ilinkBotId: input.ilinkBotId,
      baseUrl: input.baseUrl,
      updatedAt: now,
    }
    writeJson(this.getCredentialsPath(), credentials)
    this.saveAccounts(existing
      ? accounts.map((item) => item.accountId === input.accountId ? account : item)
      : [...accounts, account])
    return account
  }

  getCredential(accountId: string): WeChatCredential | null {
    const credential = this.readCredentials()[accountId]
    if (!credential) return null

    try {
      return {
        accountId,
        botToken: this.secretBox.decryptString(credential.botToken),
        ilinkUserId: credential.ilinkUserId,
        ilinkBotId: credential.ilinkBotId,
        baseUrl: credential.baseUrl,
      }
    } catch {
      return null
    }
  }

  removeAccount(accountId: string): boolean {
    const accounts = this.listAccounts()
    const nextAccounts = accounts.filter((account) => account.accountId !== accountId)
    if (nextAccounts.length === accounts.length) return false

    const credentials = this.readCredentials()
    delete credentials[accountId]
    writeJson(this.getCredentialsPath(), credentials)
    this.saveAccounts(nextAccounts)
    return true
  }

  private readCredentials(): Record<string, WeChatBridgeCredentialEntry> {
    const raw = readJson<Record<string, WeChatBridgeCredentialEntry>>(this.getCredentialsPath(), {})
    return raw && typeof raw === 'object' ? raw : {}
  }
}
