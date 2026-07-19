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
})
