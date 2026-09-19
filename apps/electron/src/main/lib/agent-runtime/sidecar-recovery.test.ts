import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, lstatSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PiRunJournalV1 } from '@kila/shared'
import { getPiSessionDir, getPiSessionQuarantinePath, getPiSessionRuntimeLockPath } from '../config-paths'
import { writeAgentRunReceipt, writePiRunJournal } from '../agent-run-receipt-store'
import { recoverPiSidecar } from './sidecar-recovery'

const originalConfigDir = process.env.KILA_CONFIG_DIR
const createdDirs: string[] = []

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.KILA_CONFIG_DIR
  else process.env.KILA_CONFIG_DIR = originalConfigDir
  for (const dir of createdDirs.splice(0)) {
    restoreWritable(dir)
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Pi sidecar recovery', () => {
  test('Given 空 sidecar When recovery Then 不制造 dirty quarantine', () => {
    setupConfigDir('kila-sidecar-recovery-empty-')
    getPiSessionDir('session-1')

    const result = recoverPiSidecar('session-1', {
      appBootId: 'app-1',
      bootId: 'boot-1',
      generation: 0,
      now: 100,
    })

    expect(result).toEqual({ action: 'clean' })
    expect(existsSync(getPiSessionQuarantinePath('session-1', 'anything'))).toBe(false)
  })

  test('Given submitted journal When recovery Then whole sidecar is moved to read-only quarantine', () => {
    const configDir = setupConfigDir('kila-sidecar-recovery-')
    const sidecarDir = getPiSessionDir('session-1')
    writeFileSync(join(sidecarDir, 'pi-session.json'), '{"partial":true}', { mode: 0o600 })
    writePiRunJournal('session-1', createJournal('submitted'))

    const result = recoverPiSidecar('session-1', {
      appBootId: 'app-2',
      bootId: 'boot-2',
      generation: 1,
      now: Date.now(),
    })

    expect(result.action).toBe('quarantined')
    expect(result.quarantinePath).toBeDefined()
    expect(existsSync(result.quarantinePath as string)).toBe(true)
    expect(statSync(result.quarantinePath as string).mode & 0o777).toBe(0o555)
    expect(statSync(join(result.quarantinePath as string, 'pi-session.json')).mode & 0o777).toBe(0o444)
    expect(readFileSync(join(getPiSessionDir('session-1'), 'kila-run-journal.json'), 'utf8')).toContain('"state": "clean"')
  })

  test('Given settled-awaiting-persist and a fully persisted boundary When recovery Then repair clean without quarantine', () => {
    setupConfigDir('kila-sidecar-recovery-repair-')
    getPiSessionDir('session-1')
    writeAgentRunReceipt('session-1', {
      runId: 'run-1',
      sessionId: 'session-1',
      outcome: 'success',
      lastMessageId: 'message-1',
      fullyPersisted: true,
      runtimeSettled: true,
      completedAt: 100,
    })
    writePiRunJournal('session-1', {
      ...createJournal('settled-awaiting-persist'),
      runId: 'run-1',
      safeProductMessageId: 'message-1',
    })

    const result = recoverPiSidecar('session-1', {
      appBootId: 'app-2',
      bootId: 'boot-2',
      generation: 1,
      now: 200,
      isProductMessagePersisted: (messageId) => messageId === 'message-1',
    })

    expect(result).toEqual({
      action: 'repaired',
      safeProductMessageId: 'message-1',
      reason: 'settled-boundary-already-persisted',
    })
    expect(existsSync(getPiSessionQuarantinePath('session-1', 'anything'))).toBe(false)
  })

  test('Given settled-awaiting-persist 中 journal 仍是旧边界 When 当前 receipt 已完整落盘 Then 使用当前 receipt 边界修复', () => {
    setupConfigDir('kila-sidecar-recovery-latest-receipt-')
    getPiSessionDir('session-1')
    writeAgentRunReceipt('session-1', {
      runId: 'run-2',
      sessionId: 'session-1',
      outcome: 'success',
      lastMessageId: 'message-2',
      fullyPersisted: true,
      runtimeSettled: true,
      completedAt: 200,
    })
    writePiRunJournal('session-1', {
      ...createJournal('settled-awaiting-persist'),
      runId: 'run-2',
      safeProductMessageId: 'message-1',
    })

    const result = recoverPiSidecar('session-1', {
      appBootId: 'app-2',
      bootId: 'boot-2',
      generation: 1,
      now: 300,
      isProductMessagePersisted: (messageId) => ['message-1', 'message-2'].includes(messageId),
    })

    expect(result).toMatchObject({
      action: 'repaired',
      safeProductMessageId: 'message-2',
      reason: 'settled-boundary-already-persisted',
    })
  })

  test('Given receipt 已持久化但 Runtime 未 settled When recovery Then 不把崩溃 run 当成安全边界', () => {
    setupConfigDir('kila-sidecar-recovery-unsettled-')
    const sidecarDir = getPiSessionDir('session-1')
    writeFileSync(join(sidecarDir, 'pi-session.json'), '{"partial":true}', { mode: 0o600 })
    writeAgentRunReceipt('session-1', {
      runId: 'run-crashed',
      sessionId: 'session-1',
      outcome: 'error',
      lastMessageId: 'crash-status',
      fullyPersisted: true,
      runtimeSettled: false,
      completedAt: 100,
    })
    writePiRunJournal('session-1', {
      ...createJournal('submitted'),
      runId: 'run-crashed',
      safeProductMessageId: 'crash-status',
    })

    const result = recoverPiSidecar('session-1', {
      appBootId: 'app-2',
      bootId: 'boot-2',
      generation: 1,
      now: 200,
      isProductMessagePersisted: () => true,
    })

    expect(result.action).toBe('quarantined')
    expect(result.safeProductMessageId).toBeUndefined()
  })

  test('Given submitted journal 保留上一轮安全边界 When 当前 run 未 settled Then 从上一轮边界重建', () => {
    setupConfigDir('kila-sidecar-recovery-previous-boundary-')
    const sidecarDir = getPiSessionDir('session-1')
    writeFileSync(join(sidecarDir, 'pi-session.json'), '{"partial":true}', { mode: 0o600 })
    writeAgentRunReceipt('session-1', {
      runId: 'run-crashed',
      sessionId: 'session-1',
      outcome: 'error',
      lastMessageId: 'crash-status',
      fullyPersisted: true,
      runtimeSettled: false,
      completedAt: 100,
    })
    writePiRunJournal('session-1', {
      ...createJournal('submitted'),
      runId: 'run-crashed',
      safeProductMessageId: 'previous-safe-message',
    })

    const result = recoverPiSidecar('session-1', {
      appBootId: 'app-2',
      bootId: 'boot-2',
      generation: 1,
      now: 200,
      isProductMessagePersisted: (messageId) => messageId === 'previous-safe-message',
    })

    expect(result.action).toBe('quarantined')
    expect(result.safeProductMessageId).toBe('previous-safe-message')
  })

  test('Given runtime.lock exists When recovery Then refuse to move sidecar', () => {
    setupConfigDir('kila-sidecar-recovery-lock-')
    const sidecarDir = getPiSessionDir('session-1')
    writeFileSync(join(sidecarDir, 'partial.txt'), 'partial')
    writePiRunJournal('session-1', createJournal('dirty'))
    writeFileSync(getPiSessionRuntimeLockPath('session-1'), '{}')

    try {
      recoverPiSidecar('session-1', {
        appBootId: 'app-2',
        bootId: 'boot-2',
        generation: 1,
      })
      throw new Error('expected runtime_sidecar_locked')
    } catch (error) {
      expect(error).toMatchObject({ code: 'runtime_sidecar_locked' })
    }
    expect(existsSync(join(sidecarDir, 'partial.txt'))).toBe(true)
  })
})

function setupConfigDir(prefix: string): string {
  const configDir = mkdtempSync(join(tmpdir(), prefix))
  createdDirs.push(configDir)
  process.env.KILA_CONFIG_DIR = configDir
  return configDir
}

function createJournal(state: PiRunJournalV1['state']): PiRunJournalV1 {
  return {
    version: 1,
    sessionId: 'session-1',
    state,
    appBootId: 'app-1',
    bootId: 'boot-1',
    generation: 0,
    updatedAt: 100,
  }
}

function restoreWritable(path: string): void {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) return
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) restoreWritable(join(path, entry))
    chmodSync(path, 0o755)
    return
  }
  chmodSync(path, 0o644)
}
