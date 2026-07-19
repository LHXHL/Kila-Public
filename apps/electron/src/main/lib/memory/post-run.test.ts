import { describe, expect, test } from 'bun:test'
import { postRunMemoryFlush, type PostRunMemoryFlushDeps } from './post-run'
import type { MemoryWriteInput } from './types'
import type { QueuedMemoryWrite } from './pending-write-buffer'

function createDeps(overrides: Partial<PostRunMemoryFlushDeps> = {}): PostRunMemoryFlushDeps {
  return {
    drainWrites: () => [],
    acknowledgeWrite: () => {},
    failWrite: () => {},
    writeMemory: async () => ({}) as never,
    appendRuntimeEvent: () => ({}) as never,
    rebuildSnapshot: async () => '',
    captureThread: async () => null,
    ...overrides,
  }
}

describe('post-run memory flush', () => {
  test('Given 两条待写记忆，When flush 成功，Then 返回 written 与准确数量', async () => {
    const writes: QueuedMemoryWrite[] = [
      { queueId: 'queue-1', content: '第一条', sourceSessionId: 'session-success' },
      { queueId: 'queue-2', content: '第二条', sourceSessionId: 'session-success' },
    ]
    const persisted: MemoryWriteInput[] = []
    let rebuilt = false

    const result = await postRunMemoryFlush({
      sessionId: 'session-success',
      messages: [{ role: 'assistant', content: 'done' }],
    }, createDeps({
      drainWrites: () => writes,
      writeMemory: async (entry) => {
        persisted.push(entry)
        return {} as never
      },
      rebuildSnapshot: async () => {
        rebuilt = true
        return '<memory_context />'
      },
    }))

    expect(result).toEqual({ status: 'written', writtenCount: 2 })
    expect(persisted).toEqual(writes)
    expect(rebuilt).toBe(true)
  })

  test('Given 第二条写入失败，When flush，Then 保留成功计数并返回错误', async () => {
    const runtimeEvents: Array<{ eventType: string; detail?: string }> = []
    const failedQueueIds: string[] = []
    let callCount = 0

    const result = await postRunMemoryFlush({
      sessionId: 'session-failure',
      messages: [],
    }, createDeps({
      drainWrites: () => [
        { queueId: 'queue-1', content: '第一条', sourceSessionId: 'session-failure' },
        { queueId: 'queue-2', content: '第二条', sourceSessionId: 'session-failure' },
      ],
      writeMemory: async () => {
        callCount += 1
        if (callCount === 2) throw new Error('provider offline')
        return {} as never
      },
      appendRuntimeEvent: (event) => {
        runtimeEvents.push(event)
        return {} as never
      },
      failWrite: (_sessionId, queueId) => { failedQueueIds.push(queueId) },
    }))

    expect(result).toEqual({
      status: 'failed',
      writtenCount: 1,
      error: 'provider offline',
    })
    expect(runtimeEvents.some((event) => (
      event.eventType === 'post_run_flush_failed' && event.detail === 'provider offline'
    ))).toBe(true)
    expect(failedQueueIds).toEqual(['queue-2'])
  })
})
