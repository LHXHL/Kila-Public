import { describe, expect, test } from 'bun:test'
import type { BridgeBinding } from '@kila/shared'
import type { BridgeInboundMessage } from '../adapters/base-adapter'
import { evaluateInboundGuard, resolveMaxInboundFileBytes } from './inbound-guard'
import { createBridgeConfigFixture } from './__fixtures__/bridge-config'

function createMessage(overrides?: Partial<BridgeInboundMessage>): BridgeInboundMessage {
  return {
    channelType: 'telegram',
    endpointKey: 'telegram:1001',
    chatId: '1001',
    userId: '1001',
    messageId: 'm1',
    text: '你好',
    attachments: [],
    ...overrides,
  }
}

describe('evaluateInboundGuard 未授权发送者', () => {
  test('Given 空白名单 When 陌生人发消息 Then 拒绝且带可回复的提示文案', () => {
    const result = evaluateInboundGuard({
      message: createMessage(),
      config: createBridgeConfigFixture(),
    })

    expect(result.allowed).toBe(false)
    expect(result.allowed === false && result.reason).toBe('empty_allowlist')
    expect(result.allowed === false && result.message.length > 0).toBe(true)
  })

  test('Given 白名单只含机器主人 When 陌生人发消息 Then 拒绝', () => {
    const result = evaluateInboundGuard({
      message: createMessage({ userId: '9999', endpointKey: 'telegram:9999', chatId: '9999' }),
      config: createBridgeConfigFixture({ telegramAllowedUserIds: ['1001'] }),
    })

    expect(result.allowed).toBe(false)
    expect(result.allowed === false && result.reason).toBe('sender_not_allowed')
  })

  test('Given 白名单含该用户 When 发消息 Then 放行', () => {
    const result = evaluateInboundGuard({
      message: createMessage(),
      config: createBridgeConfigFixture({ telegramAllowedUserIds: ['1001'] }),
    })

    expect(result.allowed).toBe(true)
  })
})

describe('evaluateInboundGuard 出站专用绑定', () => {
  test('Given 飞书 Session 镜像群绑定 When 群内有人发消息 Then 拒绝入站', () => {
    const mirrorBinding: BridgeBinding = {
      channelType: 'feishu',
      endpointKey: 'feishu:bot-1:oc_mirror',
      botId: 'bot-1',
      chatId: 'oc_mirror',
      userId: 'ou_owner',
      sessionId: 's1',
      outboundOnly: true,
      createdAt: 1,
      updatedAt: 1,
    }

    const result = evaluateInboundGuard({
      message: createMessage({
        channelType: 'feishu',
        endpointKey: 'feishu:bot-1:oc_mirror',
        chatId: 'oc_mirror',
        userId: 'ou_owner',
      }),
      config: createBridgeConfigFixture({ feishuAllowedOpenIds: ['ou_owner'] }),
      existingBinding: mirrorBinding,
    })

    expect(result.allowed).toBe(false)
    expect(result.allowed === false && result.reason).toBe('outbound_only_binding')
  })
})

describe('evaluateInboundGuard 频率限制与附件上限', () => {
  test('Given 限流器拒绝 When 判定 Then 先于身份校验返回 rate_limited', () => {
    const result = evaluateInboundGuard({
      message: createMessage(),
      config: createBridgeConfigFixture({ telegramAllowedUserIds: ['1001'] }),
      rateLimiter: { allow: () => false },
    })

    expect(result.allowed).toBe(false)
    expect(result.allowed === false && result.reason).toBe('rate_limited')
  })

  test('Given 飞书附件超过上限 When 判定 Then 拒绝（此前飞书/微信无任何上限）', () => {
    const result = evaluateInboundGuard({
      message: createMessage({
        channelType: 'feishu',
        endpointKey: 'feishu:bot-1:oc_a',
        chatId: 'oc_a',
        userId: 'ou_owner',
        attachments: [{
          remoteId: 'f1',
          filename: 'huge.bin',
          mediaType: 'application/octet-stream',
          size: 50 * 1024 * 1024,
        }],
      }),
      config: createBridgeConfigFixture({ feishuAllowedOpenIds: ['ou_owner'] }),
    })

    expect(result.allowed).toBe(false)
    expect(result.allowed === false && result.reason).toBe('oversized_attachment')
  })

  test('Given 四渠道配置 When 解析附件上限 Then 均返回有限值而非 MAX_SAFE_INTEGER', () => {
    const config = createBridgeConfigFixture()

    for (const channel of ['telegram', 'discord', 'feishu', 'wechat'] as const) {
      const limit = resolveMaxInboundFileBytes(channel, config)
      expect(limit).toBeLessThan(Number.MAX_SAFE_INTEGER)
      expect(limit).toBeGreaterThan(0)
    }
  })
})
