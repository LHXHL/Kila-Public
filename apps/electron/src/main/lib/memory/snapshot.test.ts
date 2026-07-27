import { describe, expect, test } from 'bun:test'
import { MemorySnapshotManager, type MemorySnapshotManagerDeps } from './snapshot'
import type {
  MemoryEntry,
  MemoryProviderStatus,
  MemoryRuntimeEvent,
  MemorySnapshotCacheEntry,
} from './types'

/** 用户消息原文：必须 ≥ 40 字符才会直接成为召回 query */
const USER_SECRET_MESSAGE = '请帮我排查生产库里 order_items 表的死锁问题，涉及客户张三的订单号 SO-20260726-0001'

function providerStatus(): MemoryProviderStatus {
  return {
    mode: 'nowledge',
    activeProvider: 'nowledge',
    localReady: false,
    memoryDirectory: '',
    nowledgeEnabled: true,
    nowledgeConfigured: true,
    nowledgeHealthy: true,
    checkedAt: 1,
  }
}

function recalledMemory(): MemoryEntry {
  return {
    kind: 'memory',
    id: 'memory-1',
    uri: 'memory://memory-1',
    title: '数据库排查约定',
    content: '排查死锁优先看 innodb_lock_waits。',
    tags: ['数据库'],
    category: 'fact',
    createdAt: 1,
    updatedAt: 1,
  }
}

interface SnapshotSpy {
  deps: MemorySnapshotManagerDeps
  snapshotWrites: MemorySnapshotCacheEntry[]
  runtimeEvents: Array<Omit<MemoryRuntimeEvent, 'id' | 'createdAt'>>
}

function createSpyDeps(): SnapshotSpy {
  const snapshotWrites: MemorySnapshotCacheEntry[] = []
  const runtimeEvents: Array<Omit<MemoryRuntimeEvent, 'id' | 'createdAt'>> = []

  return {
    snapshotWrites,
    runtimeEvents,
    deps: {
      providerManager: {
        getStatus: async () => providerStatus(),
        getWorkingMemory: async () => null,
        search: async () => [{ entry: recalledMemory(), score: 0.8 }],
        searchThreads: async () => [],
        list: async () => [recalledMemory()],
      },
      stateStore: {
        getSnapshotCache: () => null,
        upsertSnapshotCache: (input) => {
          snapshotWrites.push(input)
          return input
        },
        appendRuntimeEvent: (input) => {
          runtimeEvents.push(input)
          return { ...input, id: 'event-1', createdAt: 1 }
        },
      },
    },
  }
}

describe('隐身会话的记忆快照落盘', () => {
  test('Given 隐身会话，When 构建记忆召回上下文，Then 不把召回 query 写进 memory-state.json', async () => {
    const spy = createSpyDeps()
    const result = await new MemorySnapshotManager(spy.deps).buildPromptContext({
      sessionId: 'session-incognito',
      userMessage: USER_SECRET_MESSAGE,
      messages: [{ role: 'user', content: USER_SECRET_MESSAGE }],
      incognito: true,
    })

    expect(spy.snapshotWrites).toHaveLength(0)
    expect(spy.runtimeEvents).toHaveLength(0)
    expect(JSON.stringify([spy.snapshotWrites, spy.runtimeEvents])).not.toContain('SO-20260726-0001')
    // 召回本身保留：隐身只影响留痕，不影响这一轮能否用上记忆。
    expect(result.text).toContain('排查死锁优先看 innodb_lock_waits。')
    expect(result.trace.incognito).toBe(true)
    expect(result.trace.recalledMemoryCount).toBe(1)
  })

  test('Given 普通会话，When 构建记忆召回上下文，Then 快照缓存与 runtime event 都不含用户消息原文', async () => {
    const spy = createSpyDeps()
    await new MemorySnapshotManager(spy.deps).buildPromptContext({
      sessionId: 'session-normal',
      userMessage: USER_SECRET_MESSAGE,
      messages: [{ role: 'user', content: USER_SECRET_MESSAGE }],
      incognito: false,
    })

    expect(spy.snapshotWrites).toHaveLength(1)
    expect(spy.runtimeEvents).toHaveLength(1)

    const persisted = JSON.stringify([spy.snapshotWrites, spy.runtimeEvents])
    expect(persisted).not.toContain('SO-20260726-0001')
    expect(persisted).not.toContain('张三')
    expect(spy.snapshotWrites[0]?.snapshotSourceJson).not.toContain('"query"')
  })

  test('Given 普通会话，When 记录 snapshot_built 事件，Then detail 只保留 query 长度与命中数', async () => {
    const spy = createSpyDeps()
    await new MemorySnapshotManager(spy.deps).buildPromptContext({
      sessionId: 'session-detail',
      userMessage: USER_SECRET_MESSAGE,
      messages: [],
      incognito: false,
    })

    const event = spy.runtimeEvents[0]
    expect(event?.eventType).toBe('snapshot_built')
    expect(event?.detail).toBe(
      `prompt snapshot built (queryLength=${USER_SECRET_MESSAGE.length}, memories=1, threads=0)`,
    )
  })
})

describe('记忆快照渲染', () => {
  test('Given 本地索引与笔记能力已移除，When 渲染快照，Then 不再输出 local_memory_index 与 notebook_supplement', async () => {
    const spy = createSpyDeps()
    const result = await new MemorySnapshotManager(spy.deps).buildPromptContext({
      sessionId: 'session-render',
      userMessage: USER_SECRET_MESSAGE,
      messages: [],
    })

    expect(result.text).not.toContain('local_memory_index')
    expect(result.text).not.toContain('notebook_supplement')
    expect(result.text).not.toContain('project_working_memory')
    expect(result.trace.notebookCount).toBe(0)
    expect(result.trace.usedProjectWorkingMemory).toBe(false)
  })
})
