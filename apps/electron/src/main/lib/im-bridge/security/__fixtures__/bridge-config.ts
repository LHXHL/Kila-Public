/** 测试夹具：构造一份最小可用的 BridgeConfig，避免每个用例重复铺字段 */

import type { BridgeConfig, FeishuBotConfig } from '@kila/shared'

export interface BridgeConfigFixtureOverrides {
  telegramAllowedUserIds?: string[]
  discordAllowedUserIds?: string[]
  wechatAllowedUserIds?: string[]
  feishuAllowedOpenIds?: string[]
  feishuAllowedChatIds?: string[]
  feishuBots?: FeishuBotConfig[]
  maxInboundFileBytes?: number
}

export function createBridgeConfigFixture(overrides?: BridgeConfigFixtureOverrides): BridgeConfig {
  const maxInboundFileBytes = overrides?.maxInboundFileBytes ?? 10 * 1024 * 1024

  return {
    enabled: true,
    autoStart: false,
    defaultSession: {},
    telegram: {
      enabled: true,
      botToken: '',
      allowedUserIds: overrides?.telegramAllowedUserIds ?? [],
      maxInboundFileBytes,
      defaultSession: {},
    },
    discord: {
      enabled: true,
      botToken: '',
      allowedUserIds: overrides?.discordAllowedUserIds ?? [],
      allowedChannelIds: [],
      allowedGuildIds: [],
      requireMention: true,
      maxInboundFileBytes,
      defaultSession: {},
    },
    feishu: {
      enabled: true,
      appId: '',
      appSecret: '',
      bots: overrides?.feishuBots ?? [],
      sessionMirror: { mode: 'off' },
      allowP2P: true,
      allowGroup: true,
      requireMention: true,
      allowedOpenIds: overrides?.feishuAllowedOpenIds ?? [],
      allowedChatIds: overrides?.feishuAllowedChatIds ?? [],
      maxInboundFileBytes,
      defaultSession: {},
    },
    wechat: {
      enabled: true,
      baseUrl: '',
      accountIds: [],
      allowedUserIds: overrides?.wechatAllowedUserIds ?? [],
      maxInboundFileBytes,
      aggregateWindowMs: 1200,
      deferredOutboundTtlMs: 1000,
      contextTtlMs: 1000,
      defaultSession: {},
    },
  }
}
