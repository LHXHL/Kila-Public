import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  beginSessionDeletion,
  completeSessionDeletion,
  isSessionDeletionPending,
  listPendingSessionDeletions,
  markSessionDeletionFailed,
} from './session-deletion-tombstone'

const tempDirs: string[] = []
const originalConfigDir = process.env.KILA_CONFIG_DIR

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  if (typeof originalConfigDir === 'string') process.env.KILA_CONFIG_DIR = originalConfigDir
  else delete process.env.KILA_CONFIG_DIR
})

function useTempConfig(): string {
  const root = mkdtempSync(join(tmpdir(), 'kila-session-tombstone-test-'))
  tempDirs.push(root)
  process.env.KILA_CONFIG_DIR = root
  return root
}

describe('Session 删除 tombstone', () => {
  test('Given 删除刚开始 When 应用进程退出 Then tombstone 可恢复且不被视为普通完成', () => {
    const root = useTempConfig()

    beginSessionDeletion('session-a')

    expect(isSessionDeletionPending('session-a')).toBe(true)
    expect(listPendingSessionDeletions()).toMatchObject([{
      sessionId: 'session-a',
      state: 'deleting',
    }])
    expect(existsSync(join(root, 'session-deletion-tombstones.json.bak'))).toBe(true)
  })

  test('Given 删除清理失败 When 记录错误 Then 下次启动仍保留失败 tombstone', () => {
    const root = useTempConfig()

    beginSessionDeletion('session-b')
    markSessionDeletionFailed('session-b', new Error('runtime exit timeout'))

    expect(listPendingSessionDeletions()).toEqual([expect.objectContaining({
      sessionId: 'session-b',
      state: 'failed',
      error: 'runtime exit timeout',
    })])
    expect(JSON.parse(readFileSync(join(root, 'session-deletion-tombstones.json'), 'utf-8')))
      .toMatchObject({ tombstones: [{ sessionId: 'session-b', state: 'failed' }] })
  })

  test('Given 删除重试成功 When 完成事务 Then tombstone 被原子移除', () => {
    useTempConfig()

    beginSessionDeletion('session-c')
    completeSessionDeletion('session-c')

    expect(listPendingSessionDeletions()).toEqual([])
    expect(isSessionDeletionPending('session-c')).toBe(false)
  })
})

