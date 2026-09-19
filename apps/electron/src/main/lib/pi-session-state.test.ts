import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getPiSessionDir } from './config-paths'
import { clearPiSessionState } from './pi-session-state'

const originalConfigDir = process.env.KILA_CONFIG_DIR
const createdDirs: string[] = []

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.KILA_CONFIG_DIR
  else process.env.KILA_CONFIG_DIR = originalConfigDir
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('Pi Session sidecar 清理', () => {
  test('Given sidecar 包含嵌套目录, When 清理, Then 整个 Session 目录被删除', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'kila-pi-state-'))
    createdDirs.push(configDir)
    process.env.KILA_CONFIG_DIR = configDir
    const sessionDir = getPiSessionDir('session-1')
    mkdirSync(join(sessionDir, 'nested'), { recursive: true })
    writeFileSync(join(sessionDir, 'nested', 'state.jsonl'), '{}')

    clearPiSessionState('session-1')

    expect(existsSync(sessionDir)).toBe(false)
  })

  test('Given sidecar 仍存在 runtime.lock, When 清理, Then 拒绝强删并保留 sidecar', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'kila-pi-state-lock-'))
    createdDirs.push(configDir)
    process.env.KILA_CONFIG_DIR = configDir
    const sessionDir = getPiSessionDir('session-locked')
    writeFileSync(join(sessionDir, 'runtime.lock'), '{}')

    expect(() => clearPiSessionState('session-locked')).toThrow('runtime_sidecar_locked')
    expect(existsSync(sessionDir)).toBe(true)
  })

  test('Given runtime.lock owner PID 已退出 When 清理 Then 回收 stale lock 后删除 sidecar', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'kila-pi-state-stale-'))
    createdDirs.push(configDir)
    process.env.KILA_CONFIG_DIR = configDir
    const sessionDir = getPiSessionDir('session-stale')
    writeFileSync(join(sessionDir, 'runtime.lock'), JSON.stringify({
      pid: 999_999,
      parentPid: 999_998,
      processStartTime: 1,
      appBootId: 'app',
      bootId: 'boot',
      generation: 0,
    }))

    clearPiSessionState('session-stale')

    expect(existsSync(sessionDir)).toBe(false)
  })
})
