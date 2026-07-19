import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type {
  BridgeBinding,
  BridgeConfig,
  BridgeConfigInput,
  BridgeChannelType,
  BridgeChannelSessionOverride,
  BridgeRuntimeState,
  FeishuBotConfig,
  FeishuBotConfigInput,
} from '@kila/shared'
import {
  createHash,
  randomUUID,
} from 'node:crypto'
import {
  getImBridgeBindingsPath,
  getImBridgeConfigPath,
  getImBridgeRuntimePath,
} from '../config-paths'


import { createLogger } from '../logger'
const log = createLogger('IM Bridge')

interface SecretBox {
  isEncryptionAvailable: () => boolean
  encryptString: (plain: string) => string
  decryptString: (encrypted: string) => string
}

interface ConfigManagerDeps {
  secretBox?: SecretBox
  getConfigPath?: () => string
  getBindingsPath?: () => string
  getRuntimePath?: () => string
}

const DEFAULT_CONFIG: BridgeConfig = {
  enabled: false,
  autoStart: false,
  defaultSession: {},
  telegram: {
    enabled: false,
    botToken: '',
    allowedUserIds: [],
    maxInboundFileBytes: 10 * 1024 * 1024,
    defaultSession: {},
  },
  discord: {
    enabled: false,
    botToken: '',
    allowedUserIds: [],
    allowedChannelIds: [],
    allowedGuildIds: [],
    requireMention: true,
    maxInboundFileBytes: 10 * 1024 * 1024,
    defaultSession: {},
  },
  feishu: {
      enabled: false,
      appId: '',
      appSecret: '',
      bots: [],
      sessionMirror: { mode: 'off' },
      allowP2P: true,
    allowGroup: true,
    requireMention: true,
    streamingCards: true,
    quietWindowMs: 600,
    maxConcurrent: 5,
    defaultSession: {},
  },
  wechat: {
    enabled: false,
    baseUrl: 'https://ilinkai.weixin.qq.com',
    accountIds: [],
    allowedUserIds: [],
    aggregateWindowMs: 1200,
    deferredOutboundTtlMs: 12 * 60 * 60 * 1000,
    contextTtlMs: 24 * 60 * 60 * 1000,
    defaultSession: {},
  },
}

const DEFAULT_RUNTIME_STATE: BridgeRuntimeState = {}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const normalized = value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)

  return Array.from(new Set(normalized))
}

function normalizeWeChatBaseUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw || raw === 'https://api-bot.weixin.qq.com') {
    return DEFAULT_CONFIG.wechat.baseUrl
  }
  return raw.replace(/\/+$/, '')
}

function createDefaultSecretBox(): SecretBox {
  const { safeStorage } = require('electron') as typeof import('electron')

  return {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (plain) => {
      if (!plain) return ''
      if (!safeStorage.isEncryptionAvailable()) {
        log.warn('[IM Bridge] safeStorage 不可用，bot token 将以明文存储')
        return plain
      }
      return safeStorage.encryptString(plain).toString('base64')
    },
    decryptString: (encrypted) => {
      if (!encrypted) return ''
      if (!safeStorage.isEncryptionAvailable()) return encrypted
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    },
  }
}

function normalizeSessionOverride(value: unknown): BridgeChannelSessionOverride {
  if (!value || typeof value !== 'object') {
    return {}
  }

  const source = value as BridgeChannelSessionOverride
  return {
    channelId: source.channelId?.trim() || undefined,
    modelId: source.modelId?.trim() || undefined,
    projectPath: source.projectPath?.trim() || undefined,
  }
}

function stableFeishuBotId(source: Partial<FeishuBotConfig>): string {
  const seed = [
    source.appId?.trim(),
    source.name?.trim(),
    source.appSecret?.trim(),
  ].find((value) => value && value.length > 0)

  if (!seed) return randomUUID()
  return `feishu-${createHash('sha256').update(seed).digest('hex').slice(0, 16)}`
}

function normalizeFeishuBot(value: unknown): FeishuBotConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Partial<FeishuBotConfig>
  const id = source.id?.trim() || stableFeishuBotId(source)
  return {
    id,
    name: source.name?.trim() || '飞书助手',
    enabled: Boolean(source.enabled),
    appId: source.appId?.trim() || '',
    appSecret: source.appSecret?.trim() || '',
    defaultSession: normalizeSessionOverride(source.defaultSession),
  }
}

function normalizeFeishuBots(current: Partial<BridgeConfig> | undefined): FeishuBotConfig[] {
  const fromBots = Array.isArray(current?.feishu?.bots)
    ? current.feishu.bots.map(normalizeFeishuBot).filter((bot): bot is FeishuBotConfig => Boolean(bot))
    : []

  if (fromBots.length > 0) return fromBots
  if (!current?.feishu?.appId && !current?.feishu?.appSecret) return []

  return [{
    id: stableFeishuBotId(current.feishu),
    name: '飞书助手',
    enabled: Boolean(current.feishu.enabled),
    appId: current.feishu.appId?.trim() || '',
    appSecret: current.feishu.appSecret?.trim() || '',
    defaultSession: normalizeSessionOverride(current.feishu.defaultSession),
  }]
}

function normalizeWeChatConfig(current: Partial<BridgeConfig> | undefined): BridgeConfig['wechat'] {
  return {
    enabled: Boolean(current?.wechat?.enabled),
    baseUrl: normalizeWeChatBaseUrl(current?.wechat?.baseUrl),
    accountIds: normalizeStringArray(current?.wechat?.accountIds),
    allowedUserIds: normalizeStringArray(current?.wechat?.allowedUserIds),
    aggregateWindowMs: typeof current?.wechat?.aggregateWindowMs === 'number'
      ? Math.max(0, current.wechat.aggregateWindowMs)
      : DEFAULT_CONFIG.wechat.aggregateWindowMs,
    deferredOutboundTtlMs: typeof current?.wechat?.deferredOutboundTtlMs === 'number'
      ? Math.max(0, current.wechat.deferredOutboundTtlMs)
      : DEFAULT_CONFIG.wechat.deferredOutboundTtlMs,
    contextTtlMs: typeof current?.wechat?.contextTtlMs === 'number'
      ? Math.max(0, current.wechat.contextTtlMs)
      : DEFAULT_CONFIG.wechat.contextTtlMs,
    defaultSession: normalizeSessionOverride(current?.wechat?.defaultSession),
  }
}

function normalizeFeishuConfig(current: Partial<BridgeConfig> | undefined): BridgeConfig['feishu'] {
  const bots = normalizeFeishuBots(current)
  const firstBot = bots[0]

  return {
    enabled: Boolean(current?.feishu?.enabled),
    appId: firstBot?.appId ?? current?.feishu?.appId?.trim() ?? '',
    appSecret: firstBot?.appSecret ?? current?.feishu?.appSecret?.trim() ?? '',
    bots,
    sessionMirror: current?.feishu?.sessionMirror?.mode === 'stream'
      ? { mode: 'stream', botId: current.feishu.sessionMirror.botId?.trim() || undefined }
      : { mode: 'off', botId: current?.feishu?.sessionMirror?.botId?.trim() || undefined },
    allowP2P: current?.feishu?.allowP2P ?? DEFAULT_CONFIG.feishu.allowP2P,
    allowGroup: current?.feishu?.allowGroup ?? DEFAULT_CONFIG.feishu.allowGroup,
    requireMention: current?.feishu?.requireMention ?? DEFAULT_CONFIG.feishu.requireMention,
    streamingCards: current?.feishu?.streamingCards ?? DEFAULT_CONFIG.feishu.streamingCards,
    quietWindowMs: typeof current?.feishu?.quietWindowMs === 'number'
      ? Math.max(0, current.feishu.quietWindowMs)
      : DEFAULT_CONFIG.feishu.quietWindowMs,
    maxConcurrent: typeof current?.feishu?.maxConcurrent === 'number'
      ? Math.max(1, current.feishu.maxConcurrent)
      : DEFAULT_CONFIG.feishu.maxConcurrent,
    defaultSession: normalizeSessionOverride(current?.feishu?.defaultSession),
  }
}

function normalizeConfig(current: Partial<BridgeConfig> | undefined): BridgeConfig {
  return {
    enabled: Boolean(current?.enabled),
    autoStart: Boolean(current?.autoStart),
    defaultSession: {
      channelId: current?.defaultSession?.channelId?.trim() || undefined,
      modelId: current?.defaultSession?.modelId?.trim() || undefined,
      thinkingLevel: current?.defaultSession?.thinkingLevel,
      historyTurns: current?.defaultSession?.historyTurns,
      enabledToolIds: normalizeStringArray(current?.defaultSession?.enabledToolIds),
    },
    telegram: {
      enabled: Boolean(current?.telegram?.enabled),
      botToken: current?.telegram?.botToken?.trim() || '',
      allowedUserIds: normalizeStringArray(current?.telegram?.allowedUserIds),
      maxInboundFileBytes: typeof current?.telegram?.maxInboundFileBytes === 'number'
        ? Math.max(0, current.telegram.maxInboundFileBytes)
        : DEFAULT_CONFIG.telegram.maxInboundFileBytes,
      defaultSession: normalizeSessionOverride(current?.telegram?.defaultSession),
    },
    discord: {
      enabled: Boolean(current?.discord?.enabled),
      botToken: current?.discord?.botToken?.trim() || '',
      allowedUserIds: normalizeStringArray(current?.discord?.allowedUserIds),
      allowedChannelIds: normalizeStringArray(current?.discord?.allowedChannelIds),
      allowedGuildIds: normalizeStringArray(current?.discord?.allowedGuildIds),
      requireMention: current?.discord?.requireMention ?? DEFAULT_CONFIG.discord.requireMention,
      maxInboundFileBytes: typeof current?.discord?.maxInboundFileBytes === 'number'
        ? Math.max(0, current.discord.maxInboundFileBytes)
        : DEFAULT_CONFIG.discord.maxInboundFileBytes,
      defaultSession: normalizeSessionOverride(current?.discord?.defaultSession),
    },
    feishu: normalizeFeishuConfig(current),
    wechat: normalizeWeChatConfig(current),
  }
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T
  } catch (error) {
    log.error(`[IM Bridge] 读取 JSON 失败: ${filePath}`, error)
    return fallback
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8')
}

export class ImBridgeConfigManager {
  private readonly secretBox: SecretBox
  private readonly getConfigPath: () => string
  private readonly getBindingsPath: () => string
  private readonly getRuntimePath: () => string

  constructor(deps?: ConfigManagerDeps) {
    this.secretBox = deps?.secretBox ?? createDefaultSecretBox()
    this.getConfigPath = deps?.getConfigPath ?? getImBridgeConfigPath
    this.getBindingsPath = deps?.getBindingsPath ?? getImBridgeBindingsPath
    this.getRuntimePath = deps?.getRuntimePath ?? getImBridgeRuntimePath
  }

  getConfig(): BridgeConfig {
    return normalizeConfig(readJsonFile<Partial<BridgeConfig>>(this.getConfigPath(), DEFAULT_CONFIG))
  }

  saveConfig(input: BridgeConfigInput): BridgeConfig {
    const current = this.getConfig()
    const next: BridgeConfig = normalizeConfig({
      enabled: input.enabled,
      autoStart: input.autoStart,
      defaultSession: {
        ...current.defaultSession,
        ...input.defaultSession,
      },
      telegram: {
        ...current.telegram,
        ...input.telegram,
        defaultSession: {
          ...current.telegram.defaultSession,
          ...input.telegram?.defaultSession,
        },
        botToken: input.telegram?.botToken?.trim()
          ? this.secretBox.encryptString(input.telegram.botToken.trim())
          : current.telegram.botToken,
      },
      discord: {
        ...current.discord,
        ...input.discord,
        defaultSession: {
          ...current.discord.defaultSession,
          ...input.discord?.defaultSession,
        },
        botToken: input.discord?.botToken?.trim()
          ? this.secretBox.encryptString(input.discord.botToken.trim())
          : current.discord.botToken,
      },
      feishu: {
        ...current.feishu,
        ...input.feishu,
        defaultSession: {
          ...current.feishu.defaultSession,
          ...input.feishu?.defaultSession,
        },
        bots: input.feishu?.bots === undefined
          ? current.feishu.bots
          : input.feishu.bots.map((bot) => ({
              id: bot.id?.trim() || randomUUID(),
              name: bot.name.trim() || '飞书助手',
              enabled: bot.enabled,
              appId: bot.appId.trim(),
              appSecret: bot.appSecret.trim()
                ? this.secretBox.encryptString(bot.appSecret.trim())
                : current.feishu.bots?.find((item) => item.id === bot.id)?.appSecret ?? '',
              defaultSession: bot.defaultSession,
            })),
        sessionMirror: input.feishu?.sessionMirror ?? current.feishu.sessionMirror,
        appSecret: input.feishu?.appSecret?.trim()
          ? this.secretBox.encryptString(input.feishu.appSecret.trim())
          : current.feishu.appSecret,
      },
      wechat: {
        ...current.wechat,
        ...input.wechat,
        defaultSession: {
          ...current.wechat.defaultSession,
          ...input.wechat?.defaultSession,
        },
        accountIds: normalizeStringArray(input.wechat?.accountIds ?? current.wechat.accountIds),
        allowedUserIds: normalizeStringArray(input.wechat?.allowedUserIds ?? current.wechat.allowedUserIds),
      },
    })

    writeJsonFile(this.getConfigPath(), next)
    return next
  }

  listFeishuBots(): FeishuBotConfig[] {
    return this.getConfig().feishu.bots ?? []
  }

  saveFeishuBot(input: FeishuBotConfigInput): FeishuBotConfig {
    const current = this.getConfig()
    const bots = [...(current.feishu.bots ?? [])]
    const id = input.id?.trim() || randomUUID()
    const existingIndex = bots.findIndex((bot) => bot.id === id)
    const existing = existingIndex >= 0 ? bots[existingIndex] : undefined
    const saved: FeishuBotConfig = {
      id,
      name: input.name.trim() || existing?.name || '飞书助手',
      enabled: input.enabled,
      appId: input.appId.trim(),
      appSecret: input.appSecret.trim()
        ? this.secretBox.encryptString(input.appSecret.trim())
        : existing?.appSecret ?? '',
      defaultSession: {
        ...existing?.defaultSession,
        ...input.defaultSession,
      },
    }

    if (existingIndex >= 0) {
      bots[existingIndex] = saved
    } else {
      bots.push(saved)
    }

    const next: BridgeConfig = normalizeConfig({
      ...current,
      feishu: {
        ...current.feishu,
        enabled: current.feishu.enabled || saved.enabled,
        appId: bots[0]?.appId ?? '',
        appSecret: bots[0]?.appSecret ?? '',
        bots,
      },
    })
    writeJsonFile(this.getConfigPath(), next)
    return saved
  }

  removeFeishuBot(botId: string): boolean {
    const current = this.getConfig()
    const bots = (current.feishu.bots ?? []).filter((bot) => bot.id !== botId)
    if (bots.length === (current.feishu.bots ?? []).length) return false

    const nextMirror = current.feishu.sessionMirror?.botId === botId
      ? { mode: 'off' as const }
      : current.feishu.sessionMirror
    const next: BridgeConfig = normalizeConfig({
      ...current,
      feishu: {
        ...current.feishu,
        appId: bots[0]?.appId ?? '',
        appSecret: bots[0]?.appSecret ?? '',
        bots,
        sessionMirror: nextMirror,
      },
    })
    writeJsonFile(this.getConfigPath(), next)
    return true
  }

  getDecryptedFeishuBotSecret(botId: string): string {
    const bot = this.listFeishuBots().find((item) => item.id === botId)
    if (!bot?.appSecret) return ''
    try {
      return this.secretBox.decryptString(bot.appSecret)
    } catch (error) {
      log.error(`[IM Bridge] 解密 feishu bot ${botId} secret 失败`, error)
      return ''
    }
  }

  getDecryptedBotToken(channel: BridgeChannelType): string {
    const config = this.getConfig()
    if (channel === 'wechat') return ''
    const encrypted = channel === 'feishu'
      ? config.feishu.appSecret
      : config[channel].botToken
    if (!encrypted) return ''

    try {
      return this.secretBox.decryptString(encrypted)
    } catch (error) {
      log.error(`[IM Bridge] 解密 ${channel} token 失败`, error)
      return ''
    }
  }

  getDecryptedSecret(channel: BridgeChannelType): string {
    if (channel === 'wechat') return ''
    return this.getDecryptedBotToken(channel)
  }

  listBindings(): BridgeBinding[] {
    const raw = readJsonFile<BridgeBinding[]>(this.getBindingsPath(), [])
    return Array.isArray(raw)
      ? raw
        .filter((item) => item && typeof item.endpointKey === 'string' && typeof item.sessionId === 'string')
        .map((item) => ({
          ...item,
          channelType: item.channelType,
          chatId: String(item.chatId),
          endpointKey: item.endpointKey.trim(),
          sessionId: item.sessionId.trim(),
          threadId: item.threadId?.trim() || undefined,
          userId: item.userId?.trim() || undefined,
          accountId: item.accountId?.trim() || undefined,
          peerId: item.peerId?.trim() || undefined,
          peerType: item.peerType,
          displayName: item.displayName?.trim() || undefined,
        }))
      : []
  }

  saveBindings(bindings: BridgeBinding[]): BridgeBinding[] {
    writeJsonFile(this.getBindingsPath(), bindings)
    return bindings
  }

  getRuntimeState(): BridgeRuntimeState {
    return readJsonFile<BridgeRuntimeState>(this.getRuntimePath(), DEFAULT_RUNTIME_STATE)
  }

  saveRuntimeState(runtime: BridgeRuntimeState): BridgeRuntimeState {
    writeJsonFile(this.getRuntimePath(), runtime)
    return runtime
  }
}

export const imBridgeConfigManager = new ImBridgeConfigManager()
