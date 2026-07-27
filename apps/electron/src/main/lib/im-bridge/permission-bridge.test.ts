import { describe, expect, test } from 'bun:test'
import type { BridgeAdapterCapabilities, BridgeChannelType, BridgePermissionPrompt, PermissionRequest } from '@kila/shared'
import { PermissionBridge } from './permission-bridge'
import { isSenderAllowed } from './security/sender-allowlist'
import { createBridgeConfigFixture } from './security/__fixtures__/bridge-config'

interface RespondCall {
  requestId: string
  behavior: 'allow' | 'deny'
  alwaysAllow: boolean
}

function createRequest(): PermissionRequest {
  return {
    requestId: 'req-1',
    sessionId: 'session-1',
    createdAt: 0,
    expiresAt: 10_000,
    toolName: 'Bash',
    toolInput: { command: 'rm -rf /' },
    description: '执行命令: rm -rf /',
    dangerLevel: 'dangerous',
  }
}

function createBridge(options?: {
  allowedUserIds?: string[]
  approvalMode?: BridgeAdapterCapabilities['approvalMode']
}): {
  bridge: PermissionBridge
  respondCalls: RespondCall[]
  dispatched: BridgePermissionPrompt[]
} {
  const respondCalls: RespondCall[] = []
  const dispatched: BridgePermissionPrompt[] = []
  const config = createBridgeConfigFixture({
    discordAllowedUserIds: options?.allowedUserIds ?? ['owner-1'],
    telegramAllowedUserIds: options?.allowedUserIds ?? ['owner-1'],
    wechatAllowedUserIds: options?.allowedUserIds ?? ['owner-1'],
  })

  const bridge = new PermissionBridge({
    now: () => 1_000,
    createToken: () => 'token-1',
    respondToPermission: (requestId, behavior, alwaysAllow) => {
      respondCalls.push({ requestId, behavior, alwaysAllow })
      return {
        requestId,
        sessionId: 'session-1',
        behavior,
        resolution: 'user',
        request: createRequest(),
      }
    },
    dispatchPrompt: async (prompt) => {
      dispatched.push(prompt)
    },
    isActorAllowed: (channelType: BridgeChannelType, identity) => isSenderAllowed(channelType, config, identity),
    getApprovalMode: () => options?.approvalMode ?? 'interactive',
  })

  return { bridge, respondCalls, dispatched }
}

describe('PermissionBridge 审批者身份校验', () => {
  test('Given 公共频道里的非授权成员 When 点击「允许一次」 Then 拒绝处理且不回调权限服务', async () => {
    const { bridge, respondCalls } = createBridge({ allowedUserIds: ['owner-1'] })
    await bridge.handlePermissionRequest({
      channelType: 'discord',
      endpointKey: 'discord:c1',
      request: createRequest(),
    })

    const result = bridge.resolveAction({
      channelType: 'discord',
      callbackToken: 'token-1',
      endpointKey: 'discord:c1',
      userId: 'stranger-9',
      chatId: 'c1',
      behavior: 'allow',
      alwaysAllow: false,
    })

    expect(result.ok).toBe(false)
    expect(respondCalls).toHaveLength(0)
  })

  test('Given 审批回调缺少发送者身份 When 处理 Then 拒绝', async () => {
    const { bridge, respondCalls } = createBridge()
    await bridge.handlePermissionRequest({
      channelType: 'discord',
      endpointKey: 'discord:c1',
      request: createRequest(),
    })

    const result = bridge.resolveAction({
      channelType: 'discord',
      callbackToken: 'token-1',
      endpointKey: 'discord:c1',
      behavior: 'allow',
      alwaysAllow: false,
    })

    expect(result.ok).toBe(false)
    expect(respondCalls).toHaveLength(0)
  })

  test('Given 授权用户 When 点击「允许一次」 Then 放行并回调权限服务', async () => {
    const { bridge, respondCalls } = createBridge({ allowedUserIds: ['owner-1'] })
    await bridge.handlePermissionRequest({
      channelType: 'discord',
      endpointKey: 'discord:c1',
      request: createRequest(),
    })

    const result = bridge.resolveAction({
      channelType: 'discord',
      callbackToken: 'token-1',
      endpointKey: 'discord:c1',
      userId: 'owner-1',
      chatId: 'c1',
      behavior: 'allow',
      alwaysAllow: false,
    })

    expect(result.ok).toBe(true)
    expect(respondCalls).toEqual([{ requestId: 'req-1', behavior: 'allow', alwaysAllow: false }])
  })
})

describe('PermissionBridge 禁止远程「总是允许」', () => {
  test('Given 授权用户 When 提交 alwaysAllow Then 拒绝且不写入永久白名单', async () => {
    const { bridge, respondCalls } = createBridge({ allowedUserIds: ['owner-1'] })
    await bridge.handlePermissionRequest({
      channelType: 'discord',
      endpointKey: 'discord:c1',
      request: createRequest(),
    })

    const result = bridge.resolveAction({
      channelType: 'discord',
      callbackToken: 'token-1',
      endpointKey: 'discord:c1',
      userId: 'owner-1',
      chatId: 'c1',
      behavior: 'allow',
      alwaysAllow: true,
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('总是允许')
    expect(respondCalls).toHaveLength(0)
  })

  test('Given 微信文本审批码 When 使用 /allow-always Then 同样被拒绝', async () => {
    const { bridge, respondCalls } = createBridge({ allowedUserIds: ['owner-1'] })
    const prompt = await bridge.handlePermissionRequest({
      channelType: 'wechat',
      endpointKey: 'wechat:acc:owner-1',
      request: createRequest(),
    })

    const result = bridge.resolveTextApproval({
      channelType: 'wechat',
      endpointKey: 'wechat:acc:owner-1',
      userId: 'owner-1',
      chatId: 'owner-1',
      approvalCode: prompt.approvalCode ?? '',
      behavior: 'allow',
      alwaysAllow: true,
    })

    expect(result.ok).toBe(false)
    expect(respondCalls).toHaveLength(0)
  })
})

describe('PermissionBridge 无法远程审批的渠道默认拒绝', () => {
  test('Given 飞书（desktop_only） When 收到权限请求 Then 立即 deny 而不是挂起等待', async () => {
    const { bridge, respondCalls, dispatched } = createBridge({ approvalMode: 'desktop_only' })

    await bridge.handlePermissionRequest({
      channelType: 'feishu',
      endpointKey: 'feishu:bot-1:oc_a',
      request: createRequest(),
    })

    expect(respondCalls).toEqual([{ requestId: 'req-1', behavior: 'deny', alwaysAllow: false }])
    // 仍然推送一张说明卡片，让远端知道发生了什么
    expect(dispatched).toHaveLength(1)
  })

  test('Given 飞书默认拒绝后 When 有人尝试用 token 补审批 Then 找不到待处理请求', async () => {
    const { bridge } = createBridge({ approvalMode: 'desktop_only' })
    await bridge.handlePermissionRequest({
      channelType: 'feishu',
      endpointKey: 'feishu:bot-1:oc_a',
      request: createRequest(),
    })

    const result = bridge.resolveAction({
      channelType: 'feishu',
      callbackToken: 'token-1',
      endpointKey: 'feishu:bot-1:oc_a',
      userId: 'ou_owner',
      chatId: 'oc_a',
      behavior: 'allow',
      alwaysAllow: false,
    })

    expect(result.ok).toBe(false)
  })
})
