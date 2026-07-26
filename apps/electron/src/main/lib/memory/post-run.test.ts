import { describe, expect, test } from 'bun:test'
import { postRunMemoryFlush, type PostRunMemoryFlushDeps } from './post-run'

function createDeps(overrides: Partial<PostRunMemoryFlushDeps> = {}): PostRunMemoryFlushDeps {
  return {
    appendRuntimeEvent: () => ({}) as never,
    rebuildSnapshot: async () => '',
    captureThread: async () => null,
    ...overrides,
  }
}

describe('post-run memory flush（仅线程归档 + 快照重建）', () => {
  test('Given 线程归档与快照重建成功，When flush，Then 返回 written', async () => {
    let captured = false
    let rebuilt = false

    const result = await postRunMemoryFlush({
      sessionId: 'session-success',
      messages: [{ role: 'assistant', content: 'done' }],
    }, createDeps({
      captureThread: async () => {
        captured = true
        return null
      },
      rebuildSnapshot: async () => {
        rebuilt = true
        return '<memory_context />'
      },
    }))

    expect(result).toEqual({ status: 'written', writtenCount: 0 })
    expect(captured).toBe(true)
    expect(rebuilt).toBe(true)
  })

  test('Given 线程归档失败，When flush，Then 记录 warn 但仍完成快照重建', async () => {
    const runtimeEvents: Array<{ eventType: string; status?: string }> = []
    let rebuilt = false

    const result = await postRunMemoryFlush({
      sessionId: 'session-thread-fail',
      messages: [],
    }, createDeps({
      captureThread: async () => { throw new Error('thread sync offline') },
      appendRuntimeEvent: (event) => {
        runtimeEvents.push(event)
        return {} as never
      },
      rebuildSnapshot: async () => {
        rebuilt = true
        return ''
      },
    }))

    expect(result.status).toBe('written')
    expect(rebuilt).toBe(true)
    expect(runtimeEvents.some((event) => event.eventType === 'nowledge_thread_sync_failed')).toBe(true)
  })

  test('Given 快照重建抛错，When flush，Then 返回 failed 并记录错误', async () => {
    const runtimeEvents: Array<{ eventType: string; detail?: string }> = []

    const result = await postRunMemoryFlush({
      sessionId: 'session-rebuild-fail',
      messages: [],
    }, createDeps({
      rebuildSnapshot: async () => { throw new Error('snapshot offline') },
      appendRuntimeEvent: (event) => {
        runtimeEvents.push(event)
        return {} as never
      },
    }))

    expect(result).toEqual({ status: 'failed', writtenCount: 0, error: 'snapshot offline' })
    expect(runtimeEvents.some((event) => (
      event.eventType === 'post_run_flush_failed' && event.detail === 'snapshot offline'
    ))).toBe(true)
  })
})
