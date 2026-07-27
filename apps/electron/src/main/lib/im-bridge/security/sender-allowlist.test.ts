import { describe, expect, test } from 'bun:test'
import type { BridgeConfig } from '@kila/shared'
import { hasConfiguredSenderAllowlist, isSenderAllowed } from './sender-allowlist'

function createConfig(overrides?: {
  telegram?: string[]
  discord?: string[]
  wechat?: string[]
  feishuOpenIds?: string[]
  feishuChatIds?: string[]
}): BridgeConfig {
  return {
    enabled: true,
    autoStart: false,
    defaultSession: {},
    telegram: {
      enabled: true,
      botToken: '',
      allowedUserIds: overrides?.telegram ?? [],
      maxInboundFileBytes: 10 * 1024 * 1024,
      defaultSession: {},
    },
    discord: {
      enabled: true,
      botToken: '',
      allowedUserIds: overrides?.discord ?? [],
      allowedChannelIds: [],
      allowedGuildIds: [],
      requireMention: true,
      maxInboundFileBytes: 10 * 1024 * 1024,
      defaultSession: {},
    },
    feishu: {
      enabled: true,
      appId: '',
      appSecret: '',
      bots: [],
      sessionMirror: { mode: 'off' },
      allowP2P: true,
      allowGroup: true,
      requireMention: true,
      allowedOpenIds: overrides?.feishuOpenIds ?? [],
      allowedChatIds: overrides?.feishuChatIds ?? [],
      maxInboundFileBytes: 10 * 1024 * 1024,
      defaultSession: {},
    },
    wechat: {
      enabled: true,
      baseUrl: '',
      accountIds: [],
      allowedUserIds: overrides?.wechat ?? [],
      maxInboundFileBytes: 25 * 1024 * 1024,
      aggregateWindowMs: 1200,
      deferredOutboundTtlMs: 1000,
      contextTtlMs: 1000,
      defaultSession: {},
    },
  }
}

describe('isSenderAllowed 默认拒绝语义', () => {
  test('Given telegram 白名单为空 When 任意用户发消息 Then 拒绝并给出配置提示', () => {
    const decision = isSenderAllowed('telegram', createConfig(), { userId: '1001', chatId: '1001' })

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('empty_allowlist')
    expect(decision.message).toContain('白名单')
  })

  test('Given discord 白名单为空 When 任意用户发消息 Then 拒绝', () => {
    const decision = isSenderAllowed('discord', createConfig(), { userId: '2001', chatId: 'c1' })

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('empty_allowlist')
  })

  test('Given wechat 白名单为空 When 任意用户发消息 Then 拒绝（修复此前的死配置）', () => {
    const decision = isSenderAllowed('wechat', createConfig(), { userId: 'wxid_a', chatId: 'wxid_a' })

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('empty_allowlist')
  })

  test('Given feishu 白名单为空 When 任意用户发消息 Then 拒绝（此前完全没有白名单）', () => {
    const decision = isSenderAllowed('feishu', createConfig(), { userId: 'ou_a', chatId: 'oc_a' })

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('empty_allowlist')
  })
})

describe('isSenderAllowed 命中判定', () => {
  test('Given telegram 白名单包含该用户 When 该用户发消息 Then 放行', () => {
    const config = createConfig({ telegram: ['1001', '1002'] })

    expect(isSenderAllowed('telegram', config, { userId: '1001', chatId: '1001' }).allowed).toBe(true)
  })

  test('Given telegram 白名单不含该用户 When 陌生人发消息 Then 拒绝', () => {
    const config = createConfig({ telegram: ['1001'] })
    const decision = isSenderAllowed('telegram', config, { userId: '9999', chatId: '9999' })

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('sender_not_allowed')
  })

  test('Given feishu 发送者身份解析失败为 unknown When 判定 Then 拒绝', () => {
    const config = createConfig({ feishuOpenIds: ['ou_owner'] })
    const decision = isSenderAllowed('feishu', config, { userId: 'unknown', chatId: 'oc_a' })

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('missing_sender_id')
  })

  test('Given feishu 发送者在白名单但会话不在 allowedChatIds When 判定 Then 拒绝该会话', () => {
    const config = createConfig({ feishuOpenIds: ['ou_owner'], feishuChatIds: ['oc_allowed'] })
    const decision = isSenderAllowed('feishu', config, { userId: 'ou_owner', chatId: 'oc_other' })

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('chat_not_allowed')
  })

  test('Given feishu allowedChatIds 为空 When 授权用户在任意会话发消息 Then 放行（chat 范围为可选收窄）', () => {
    const config = createConfig({ feishuOpenIds: ['ou_owner'] })

    expect(isSenderAllowed('feishu', config, { userId: 'ou_owner', chatId: 'oc_any' }).allowed).toBe(true)
  })
})

describe('hasConfiguredSenderAllowlist', () => {
  test('Given 四渠道均未配置白名单 When 查询 Then 全部返回 false', () => {
    const config = createConfig()

    expect(hasConfiguredSenderAllowlist('telegram', config)).toBe(false)
    expect(hasConfiguredSenderAllowlist('discord', config)).toBe(false)
    expect(hasConfiguredSenderAllowlist('wechat', config)).toBe(false)
    expect(hasConfiguredSenderAllowlist('feishu', config)).toBe(false)
  })

  test('Given feishu 配置了 openId 白名单 When 查询 Then 返回 true', () => {
    expect(hasConfiguredSenderAllowlist('feishu', createConfig({ feishuOpenIds: ['ou_owner'] }))).toBe(true)
  })
})
