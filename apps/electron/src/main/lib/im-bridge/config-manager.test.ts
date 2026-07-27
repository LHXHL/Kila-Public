import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ImBridgeConfigManager } from './config-manager'

function createTestManager(configPath: string): ImBridgeConfigManager {
  return new ImBridgeConfigManager({
    getConfigPath: () => configPath,
    getBindingsPath: () => join(configPath, '..', 'bindings.json'),
    getRuntimePath: () => join(configPath, '..', 'runtime.json'),
    secretBox: {
      isEncryptionAvailable: () => false,
      encryptString: (plain) => plain,
      decryptString: (encrypted) => encrypted,
    },
  })
}

describe('ImBridgeConfigManager 飞书配置兼容', () => {
  test('旧单 Bot 配置迁移时生成稳定 botId', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kila-im-bridge-config-test-'))
    try {
      const configPath = join(dir, 'config.json')
      writeFileSync(configPath, JSON.stringify({
        enabled: true,
        autoStart: true,
        feishu: {
          enabled: true,
          appId: 'cli_test_app',
          appSecret: 'encrypted-secret',
        },
      }))

      const manager = createTestManager(configPath)
      const first = manager.getConfig().feishu.bots?.[0]?.id
      const second = manager.getConfig().feishu.bots?.[0]?.id

      expect(first).toBeTruthy()
      expect(second).toBe(first)
      expect(first).toStartWith('feishu-')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('Given 旧配置没有白名单字段 When 归一化 Then 飞书白名单为空且自动放行默认关闭', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kila-im-bridge-config-test-'))
    try {
      const configPath = join(dir, 'config.json')
      writeFileSync(configPath, JSON.stringify({
        enabled: true,
        autoStart: true,
        feishu: {
          enabled: true,
          appId: 'cli_test_app',
          appSecret: 'encrypted-secret',
        },
      }))

      const feishu = createTestManager(configPath).getConfig().feishu

      expect(feishu.allowedOpenIds).toEqual([])
      expect(feishu.allowedChatIds).toEqual([])
      expect(feishu.maxInboundFileBytes).toBeGreaterThan(0)
      expect(feishu.bots?.[0]?.autoApprove).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('Given 微信旧配置 When 归一化 Then 补齐入站附件上限', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kila-im-bridge-config-test-'))
    try {
      const configPath = join(dir, 'config.json')
      writeFileSync(configPath, JSON.stringify({
        enabled: true,
        autoStart: false,
        wechat: { enabled: true, allowedUserIds: ['wxid_owner'] },
      }))

      const wechat = createTestManager(configPath).getConfig().wechat

      expect(wechat.maxInboundFileBytes).toBeGreaterThan(0)
      expect(wechat.allowedUserIds).toEqual(['wxid_owner'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('Given 保存带白名单与自动放行的配置 When 重新读取 Then 字段被持久化', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kila-im-bridge-config-test-'))
    try {
      const configPath = join(dir, 'config.json')
      const manager = createTestManager(configPath)

      manager.saveConfig({
        enabled: true,
        autoStart: false,
        feishu: {
          enabled: true,
          allowedOpenIds: ['ou_owner', 'ou_owner'],
          allowedChatIds: ['oc_team'],
          sessionMirror: { mode: 'stream', botId: 'bot-1', targetOpenId: 'ou_owner' },
          bots: [{
            id: 'bot-1',
            name: '飞书助手',
            enabled: true,
            appId: 'cli_test_app',
            appSecret: 'secret',
            autoApprove: true,
          }],
        },
      })

      const feishu = manager.getConfig().feishu

      // normalizeStringArray 会去重
      expect(feishu.allowedOpenIds).toEqual(['ou_owner'])
      expect(feishu.allowedChatIds).toEqual(['oc_team'])
      expect(feishu.sessionMirror?.targetOpenId).toBe('ou_owner')
      expect(feishu.bots?.[0]?.autoApprove).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('Given 出站专用的镜像绑定 When 读取绑定列表 Then outboundOnly 标记被保留', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kila-im-bridge-config-test-'))
    try {
      const configPath = join(dir, 'config.json')
      const manager = createTestManager(configPath)

      manager.saveBindings([{
        channelType: 'feishu',
        endpointKey: 'feishu:bot-1:oc_mirror',
        botId: 'bot-1',
        chatId: 'oc_mirror',
        userId: 'ou_owner',
        sessionId: 'session-1',
        outboundOnly: true,
        createdAt: 1,
        updatedAt: 1,
      }])

      expect(manager.listBindings()[0]?.outboundOnly).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
