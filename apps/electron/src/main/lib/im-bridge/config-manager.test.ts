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
})
