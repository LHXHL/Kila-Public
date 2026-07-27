import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getSettings, isSettingsDegraded, readSettings, updateSettings } from './settings-service'

const tempDirs: string[] = []
const originalConfigDir = process.env.KILA_CONFIG_DIR

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  if (typeof originalConfigDir === 'string') {
    process.env.KILA_CONFIG_DIR = originalConfigDir
  } else {
    delete process.env.KILA_CONFIG_DIR
  }
})

/** 每个用例独立配置目录：降级登记按绝对路径隔离，用例之间不会互相污染 */
function createConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kila-settings-test-'))
  tempDirs.push(dir)
  process.env.KILA_CONFIG_DIR = dir
  return dir
}

describe('应用设置持久化', () => {
  test('Given 配置目录为空，When 读取设置，Then 是可信首装而非降级', () => {
    createConfigDir()

    const result = readSettings()

    expect(result.degraded).toBe(false)
    expect(result.settings.unifiedSessionsBootstrapped).toBe(false)
    expect(isSettingsDegraded()).toBe(false)
  })

  test('Given 更新设置，When 写入磁盘，Then 同时产出主文件与备份且内容完整', () => {
    const configDir = createConfigDir()
    const settingsPath = join(configDir, 'settings.json')

    updateSettings({ onboardingCompleted: true, unifiedSessionsBootstrapped: true })

    expect(existsSync(settingsPath)).toBe(true)
    expect(existsSync(`${settingsPath}.bak`)).toBe(true)
    expect(readFileSync(`${settingsPath}.bak`, 'utf-8')).toBe(readFileSync(settingsPath, 'utf-8'))
    // 原子写不会留下半截文件：内容一定是可解析的完整 JSON
    expect(JSON.parse(readFileSync(settingsPath, 'utf-8'))).toMatchObject({
      onboardingCompleted: true,
      unifiedSessionsBootstrapped: true,
    })
    // 临时文件必须已经 rename 掉，不允许残留
    expect(readdirSync(configDir).filter((name) => name.endsWith('.tmp'))).toHaveLength(0)
  })

  test('Given 主文件损坏但备份有效，When 读取设置，Then 从备份恢复且不进入降级', () => {
    const configDir = createConfigDir()
    const settingsPath = join(configDir, 'settings.json')
    updateSettings({ onboardingCompleted: true })
    writeFileSync(settingsPath, '{ 半截写入', 'utf-8')

    const result = readSettings()

    expect(result.degraded).toBe(false)
    expect(result.settings.onboardingCompleted).toBe(true)
    expect(JSON.parse(readFileSync(settingsPath, 'utf-8'))).toMatchObject({ onboardingCompleted: true })
  })

  test('Given 主备双双损坏，When 读取设置，Then 标记降级并把损坏文件留档', () => {
    const configDir = createConfigDir()
    const settingsPath = join(configDir, 'settings.json')
    writeFileSync(settingsPath, '{ 主文件坏了', 'utf-8')
    writeFileSync(`${settingsPath}.bak`, '{ 备份也坏了', 'utf-8')

    const result = readSettings()

    expect(result.degraded).toBe(true)
    expect(isSettingsDegraded()).toBe(true)
    expect(result.settings.unifiedSessionsBootstrapped).toBe(false)
    // 损坏文件必须改名留档，避免下一次写入把损坏状态固化，同时保留人工恢复的原始字节
    const archived = readdirSync(configDir).filter((name) => name.includes('settings.json.corrupt-'))
    expect(archived).toHaveLength(2)
    expect(existsSync(settingsPath)).toBe(false)
  })

  test('Given 设置曾经损坏，When 留档重建后再次读取，Then 降级标记保持粘性', () => {
    createConfigDir()
    const settingsPath = join(process.env.KILA_CONFIG_DIR!, 'settings.json')
    writeFileSync(settingsPath, '{ 坏', 'utf-8')

    expect(readSettings().degraded).toBe(true)

    // 留档后文件已不存在，看起来像首装；但本进程必须继续把它当成不可信状态
    updateSettings({ themeMode: 'dark' })

    expect(getSettings().themeMode).toBe('dark')
    expect(isSettingsDegraded()).toBe(true)
    expect(readSettings().degraded).toBe(true)
  })
})
