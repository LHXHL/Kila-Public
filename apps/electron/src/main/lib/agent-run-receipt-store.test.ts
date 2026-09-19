import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readAgentRunReceipt, readPiRunJournal, writeAgentRunReceipt, writePiRunJournal } from './agent-run-receipt-store'

const originalConfigDir = process.env.KILA_CONFIG_DIR
const createdDirs: string[] = []

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.KILA_CONFIG_DIR
  else process.env.KILA_CONFIG_DIR = originalConfigDir
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('Agent run receipt 与 Pi journal', () => {
  test('Given 一轮产品消息已完整持久化 When 写入 receipt Then 下次可以恢复安全边界', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'kila-receipt-'))
    createdDirs.push(configDir)
    process.env.KILA_CONFIG_DIR = configDir

    writeAgentRunReceipt('session-1', {
      runId: 'run-1',
      sessionId: 'session-1',
      outcome: 'success',
      lastMessageId: 'message-1',
      fullyPersisted: true,
      runtimeSettled: true,
      completedAt: 123,
    })
    writePiRunJournal('session-1', {
      version: 1,
      sessionId: 'session-1',
      runId: 'run-1',
      state: 'clean',
      safeProductMessageId: 'message-1',
      appBootId: 'app-1',
      bootId: 'boot-1',
      generation: 0,
      updatedAt: 123,
    })

    expect(readAgentRunReceipt('session-1')).toMatchObject({ fullyPersisted: true, lastMessageId: 'message-1' })
    expect(readPiRunJournal('session-1')).toMatchObject({ state: 'clean', safeProductMessageId: 'message-1' })
  })
})
