import { describe, expect, test } from 'bun:test'
import type { BridgeConfig, Channel, SessionMeta } from '@kila/shared'
import { resolveInboundBridgeSessionPlan } from './bridge-session-defaults'

const channels: Channel[] = [
  {
    id: 'old-channel',
    name: '旧渠道',
    provider: 'custom',
    baseUrl: 'https://old.example.com',
    apiKey: 'test',
    enabled: true,
    models: [
      {
        id: 'old-model',
        name: 'old-model',
        enabled: true,
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'remote-channel',
    name: '远程渠道',
    provider: 'custom',
    baseUrl: 'https://remote.example.com',
    apiKey: 'test',
    enabled: true,
    models: [
      {
        id: 'remote-model',
        name: 'remote-model',
        enabled: true,
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  },
]

const baseConfig: BridgeConfig = {
  enabled: true,
  autoStart: true,
  defaultSession: {},
  telegram: {
    enabled: true,
    botToken: '',
    allowedUserIds: [],
    defaultSession: {
      channelId: 'remote-channel',
      modelId: 'remote-model',
    },
    maxInboundFileBytes: 20 * 1024 * 1024,
  },
  discord: {
    enabled: false,
    botToken: '',
    allowedUserIds: [],
    allowedGuildIds: [],
    allowedChannelIds: [],
    requireMention: true,
    defaultSession: {},
    maxInboundFileBytes: 20 * 1024 * 1024,
  },
  feishu: {
    enabled: true,
    appId: '',
    appSecret: '',
    allowP2P: true,
    allowGroup: true,
    requireMention: true,
    defaultSession: {
      channelId: 'remote-channel',
      modelId: 'remote-model',
    },
    bots: [],
  },
  wechat: {
    enabled: false,
    baseUrl: '',
    accountIds: [],
    allowedUserIds: [],
    aggregateWindowMs: 1200,
    deferredOutboundTtlMs: 24 * 60 * 60 * 1000,
    contextTtlMs: 30 * 60 * 1000,
    defaultSession: {},
  },
}

const existingSession = {
  channelId: 'old-channel',
  modelId: 'old-model',
} as Pick<SessionMeta, 'channelId' | 'modelId'>

describe('resolveInboundBridgeSessionPlan', () => {
  test('Given 飞书入站消息 When 忽略 session 旧模型 Then 使用远程渠道默认模型并同步会话', () => {
    const result = resolveInboundBridgeSessionPlan({
      channelType: 'feishu',
      config: baseConfig,
      channels,
      session: existingSession,
      ignoreSessionSelection: true,
    })

    expect(result).toMatchObject({
      ok: true,
      source: 'channel',
      channelId: 'remote-channel',
      modelId: 'remote-model',
      shouldSyncSessionMeta: true,
    })
  })

  test('Given 非飞书入站消息 When session 已有模型 Then 保留 session 模型', () => {
    const result = resolveInboundBridgeSessionPlan({
      channelType: 'telegram',
      config: baseConfig,
      channels,
      session: existingSession,
    })

    expect(result).toMatchObject({
      ok: true,
      source: 'session',
      channelId: 'old-channel',
      modelId: 'old-model',
      shouldSyncSessionMeta: false,
    })
  })
})
