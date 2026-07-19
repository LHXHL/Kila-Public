import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PendingWriteBuffer } from './pending-write-buffer'

let rootDir = ''

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'kila-memory-queue-'))
})

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true })
})

function createBuffer(): PendingWriteBuffer {
  return new PendingWriteBuffer(join(rootDir, 'write-events.jsonl'))
}

describe('PendingWriteBuffer durable journal', () => {
  test('Given 待写入记忆，When 重建 buffer，Then 从 JSONL 恢复未确认项', () => {
    const first = createBuffer()
    first.append('session-1', { content: '必须保留', sourceSessionId: 'session-1', queueId: 'queue-1' })

    const restored = createBuffer()
    expect(restored.list('session-1')).toHaveLength(1)
    expect(restored.list('session-1')[0]?.content).toBe('必须保留')
  })

  test('Given 两条待写入记忆，When 只确认第一条，Then 重启后仍保留第二条', () => {
    const first = createBuffer()
    first.append('session-1', { content: '第一条', sourceSessionId: 'session-1', queueId: 'queue-1' })
    first.append('session-1', { content: '第二条', sourceSessionId: 'session-1', queueId: 'queue-2' })
    first.acknowledge('session-1', 'queue-1')

    const restored = createBuffer()
    expect(restored.list('session-1').map((entry) => entry.queueId)).toEqual(['queue-2'])
  })

  test('Given 写入失败，When 记录失败事件，Then 队列项不会被删除', () => {
    const buffer = createBuffer()
    buffer.append('session-1', { content: '稍后重试', sourceSessionId: 'session-1', queueId: 'queue-1' })
    buffer.markFailed('session-1', 'queue-1', 'disk busy')
    expect(buffer.drain('session-1')).toHaveLength(1)
  })
})
