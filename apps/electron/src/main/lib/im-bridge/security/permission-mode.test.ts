import { describe, expect, test } from 'bun:test'
import type { FeishuBotConfig } from '@kila/shared'
import { resolveBridgePermissionMode } from './permission-mode'
import { createBridgeConfigFixture } from './__fixtures__/bridge-config'

function createBot(overrides?: Partial<FeishuBotConfig>): FeishuBotConfig {
  return {
    id: 'bot-1',
    name: '飞书助手',
    enabled: true,
    appId: 'cli_test',
    appSecret: 'secret',
    autoApprove: false,
    defaultSession: {},
    ...overrides,
  }
}

describe('resolveBridgePermissionMode 飞书不再硬编码全放行', () => {
  test('Given 飞书入站且机器人未开启自动放行 When 解析权限模式 Then 不注入 auto', () => {
    const decision = resolveBridgePermissionMode({
      channelType: 'feishu',
      config: createBridgeConfigFixture({ feishuBots: [createBot()] }),
      botId: 'bot-1',
    })

    expect(decision.mode).toBeUndefined()
    expect(decision.reason).toBe('default_gate')
  })

  test('Given 飞书入站但找不到对应机器人配置 When 解析权限模式 Then 不注入 auto', () => {
    const decision = resolveBridgePermissionMode({
      channelType: 'feishu',
      config: createBridgeConfigFixture({ feishuBots: [createBot()] }),
      botId: 'bot-unknown',
    })

    expect(decision.mode).toBeUndefined()
  })

  test('Given 机器人开启自动放行但白名单为空 When 解析权限模式 Then 拒绝自动放行并回退闸门', () => {
    const decision = resolveBridgePermissionMode({
      channelType: 'feishu',
      config: createBridgeConfigFixture({ feishuBots: [createBot({ autoApprove: true })] }),
      botId: 'bot-1',
    })

    expect(decision.mode).toBeUndefined()
    expect(decision.reason).toBe('auto_approve_requires_allowlist')
  })

  test('Given 机器人开启自动放行且白名单非空 When 解析权限模式 Then 才允许注入 auto', () => {
    const decision = resolveBridgePermissionMode({
      channelType: 'feishu',
      config: createBridgeConfigFixture({
        feishuBots: [createBot({ autoApprove: true })],
        feishuAllowedOpenIds: ['ou_owner'],
      }),
      botId: 'bot-1',
    })

    expect(decision.mode).toBe('auto')
    expect(decision.reason).toBe('auto_approve_bot')
  })

  test('Given telegram / discord / wechat 入站 When 解析权限模式 Then 永远不注入 auto', () => {
    const config = createBridgeConfigFixture({
      feishuBots: [createBot({ autoApprove: true })],
      feishuAllowedOpenIds: ['ou_owner'],
    })

    for (const channelType of ['telegram', 'discord', 'wechat'] as const) {
      expect(resolveBridgePermissionMode({ channelType, config, botId: 'bot-1' }).mode).toBeUndefined()
    }
  })
})
