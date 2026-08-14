import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NowledgeMemoryProvider } from './nowledge-provider'
import { MemoryStateStore } from './state-store'

type FetchCall = {
  url: string
  init?: RequestInit
}

const originalFetch = globalThis.fetch

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function createProvider(): NowledgeMemoryProvider {
  return new NowledgeMemoryProvider({
    baseUrl: 'http://127.0.0.1:14242',
    timeoutMs: 1_000,
    mode: 'nowledge',
  })
}

/** 线程同步分批测试的临时状态目录（MemoryStateStore 每次 patch 都会持久化写文件） */
const tempDirs: string[] = []

afterEach(() => {
  globalThis.fetch = originalFetch
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('NowledgeMemoryProvider API mapping', () => {
  test('Given Kila 记忆输入，When 写入 Nowledge，Then 使用 Nowledge 字段而不是旧本地字段', async () => {
    const calls: FetchCall[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return jsonResponse({
        id: 'memory-1',
        title: '语言偏好',
        content: '回复优先使用中文',
        labels: ['偏好'],
        unit_type: 'preference',
        metadata: {
          kila_key: 'preferred-language',
          kila_category: 'preference',
          kila_project_path: '/tmp/project',
          kila_source_session_id: 'session-1',
        },
        created_at: '2026-07-15T10:00:00.000Z',
        updated_at: '2026-07-15T10:01:00.000Z',
      })
    }) as unknown as typeof fetch

    const entry = await createProvider().write({
      content: '回复优先使用中文',
      title: '语言偏好',
      tags: ['偏好'],
      category: 'preference',
      key: 'preferred-language',
      projectPath: '/tmp/project',
      sourceSessionId: 'session-1',
    })

    const requestBody = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>
    expect(calls[0]?.url).toBe('http://127.0.0.1:14242/memories')
    expect(requestBody.labels).toEqual(['偏好'])
    expect(requestBody.unit_type).toBe('preference')
    expect(requestBody.source).toBe('kila')
    expect(requestBody.source_thread_id).toBe('session-1')
    expect(requestBody.metadata).toMatchObject({
      kila_key: 'preferred-language',
      kila_category: 'preference',
      kila_project_path: '/tmp/project',
      kila_source_session_id: 'session-1',
    })
    expect(typeof (requestBody.metadata as Record<string, unknown>).kila_write_id).toBe('string')
    expect(requestBody).not.toHaveProperty('tags')
    expect(requestBody).not.toHaveProperty('category')
    expect(requestBody).not.toHaveProperty('key')
    expect(entry.uri).toBe('memory://memory-1')
    expect(entry.category).toBe('preference')
    expect(entry.key).toBe('preferred-language')
  })

  test('Given Nowledge 搜索直接返回数组，When 执行搜索，Then 正确提取 memory 与相似度', async () => {
    let callCount = 0
    globalThis.fetch = (async () => {
      callCount += 1
      return jsonResponse([
        {
          memory: {
            id: 'memory-1',
            content: '回复优先使用中文',
            unit_type: 'preference',
            labels: ['偏好'],
            metadata: {
              kila_project_path: '/tmp/project',
              kila_key: 'preferred-language',
              kila_category: 'preference',
              kila_source_session_id: 'session-1',
            },
          },
          similarity_score: 0.91,
          relevance_reason: '用户语言偏好',
        },
      ])
    }) as unknown as typeof fetch

    const results = await createProvider().search({ query: '语言', limit: 4 })

    expect(callCount).toBe(1)
    expect(results).toHaveLength(1)
    expect(results[0]?.score).toBe(0.91)
    expect(results[0]?.relevanceReason).toBe('用户语言偏好')
    expect(results[0]?.entry.category).toBe('preference')
    expect(results[0]?.entry.key).toBe('preferred-language')
    expect(results[0]?.entry.projectPath).toBe('/tmp/project')
    expect(results[0]?.entry.sourceSessionId).toBe('session-1')
  })

  test('Given 列表返回 time 与 label_ids，When 读取长期记忆，Then 正确映射分类和时间', async () => {
    globalThis.fetch = (async () => jsonResponse([
      {
        id: 'memory-2',
        title: '测试',
        content: '测试内容',
        time: '2026-07-15T10:00:00.000Z',
        unit_type: 'learning',
        label_ids: ['测试'],
        metadata: {
          kila_category: 'insight',
        },
      },
    ])) as unknown as typeof fetch

    const entries = await createProvider().list({ limit: 10 })

    expect(entries).toHaveLength(1)
    expect(entries[0]?.tags).toEqual(['测试'])
    expect(entries[0]?.category).toBe('insight')
    expect(entries[0]?.createdAt).toBe(Date.parse('2026-07-15T10:00:00.000Z'))
    expect(entries[0]?.updatedAt).toBe(Date.parse('2026-07-15T10:00:00.000Z'))
  })

  test('Given ModelScope Token 无效但 Nowledge 已先落库，When 写入记忆，Then 回查确认后按成功处理', async () => {
    let writeId = ''
    let callCount = 0
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      callCount += 1
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { metadata?: { kila_write_id?: string } }
        writeId = body.metadata?.kila_write_id ?? ''
        return jsonResponse({
          detail: 'remote embedding failed: 401 Unauthorized {"errors":{"message":"Authentication failed, please make sure that a valid ModelScope token is supplied."},"request_id":"request-modelscope-1"}',
        }, 500)
      }

      return jsonResponse([{
        id: 'memory-after-embedding-error',
        title: '测试记忆',
        content: '测试记忆',
        metadata: { kila_write_id: writeId },
        unit_type: 'context',
      }])
    }) as unknown as typeof fetch

    const entry = await createProvider().write({ content: '测试记忆', title: '测试记忆' })

    expect(callCount).toBe(2)
    expect(entry.uri).toBe('memory://memory-after-embedding-error')
  })

  test('Given ModelScope Token 无效且回查不到新条目，When 写入记忆，Then 保留真实认证错误', async () => {
    let callCount = 0
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      callCount += 1
      if (init?.method === 'POST') {
        return jsonResponse({
          detail: 'remote embedding failed: 401 Unauthorized {"errors":{"message":"Authentication failed, please make sure that a valid ModelScope token is supplied."},"request_id":"request-modelscope-2"}',
        }, 500)
      }

      return jsonResponse([])
    }) as unknown as typeof fetch

    await expect(createProvider().write({ content: '未落库记忆' })).rejects.toThrow(
      'Nowledge 本地服务连接正常，但 ModelScope 认证失败',
    )
    expect(callCount).toBe(2)
  })

  test('Given 回查只有无时间的历史同内容条目，When Embedding 失败，Then 不误判为本次写入成功', async () => {
    let callCount = 0
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      callCount += 1
      if (init?.method === 'POST') {
        return jsonResponse({
          detail: 'remote embedding failed: 401 Unauthorized {"errors":{"message":"Authentication failed, please make sure that a valid ModelScope token is supplied."},"request_id":"request-modelscope-3"}',
        }, 500)
      }

      return jsonResponse([{
        id: 'old-memory-without-timestamp',
        title: '重复记忆',
        content: '重复记忆',
        unit_type: 'context',
      }])
    }) as unknown as typeof fetch

    await expect(createProvider().write({ content: '重复记忆', title: '重复记忆' })).rejects.toThrow(
      'Nowledge 本地服务连接正常，但 ModelScope 认证失败',
    )
    expect(callCount).toBe(2)
  })

  test('Given Nowledge 本地 API Key 无效，When 写入记忆，Then 提示重新自动检测同步 API Key', async () => {
    globalThis.fetch = (async () => jsonResponse({ detail: 'Unauthorized' }, 401)) as unknown as typeof fetch

    await expect(createProvider().write({ content: '测试记忆' })).rejects.toThrow(
      'Kila 无法通过 Nowledge 本地 API 认证。请重新执行“自动检测并启用”，同步最新的本地 API Key。',
    )
  })
})

describe('NowledgeMemoryProvider 线程同步分批', () => {
  function createBatchMessages(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      role: 'user' as const,
      content: `message-${i}`,
    }))
  }

  function createProviderWithStore() {
    // MemoryStateStore 每次 patch 都会持久化写文件，测试必须用独立临时文件
    // 隔离状态，避免测试间串扰（共享路径会读到上一轮残留）。
    const dir = mkdtempSync(join(tmpdir(), 'kila-memory-test-'))
    tempDirs.push(dir)
    const store = new MemoryStateStore(join(dir, 'memory-state.json'))
    return {
      provider: new NowledgeMemoryProvider(
        {
          baseUrl: 'http://127.0.0.1:14242',
          timeoutMs: 1_000,
          mode: 'nowledge',
        },
        { stateStore: store },
      ),
      store,
    }
  }

  test('Given 首次同步 15 条消息，When captureThread，Then 创建线程带第一批，剩余批次逐个 append，状态推进到 15', async () => {
    const calls: FetchCall[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return jsonResponse({ success: true })
    }) as unknown as typeof fetch

    const { provider, store } = createProviderWithStore()
    await provider.captureThread({
      sessionId: 'session-batch-1',
      threadId: 'thread-batch-1',
      threadTitle: '分批测试',
      messages: createBatchMessages(15),
    })

    expect(calls).toHaveLength(2)
    expect(calls[0]!.url).toBe('http://127.0.0.1:14242/threads')
    expect(calls[0]!.init?.method).toBe('POST')
    const createBody = JSON.parse(String(calls[0]!.init?.body)) as { messages: unknown[] }
    expect(createBody.messages).toHaveLength(10)

    expect(calls[1]!.url).toBe('http://127.0.0.1:14242/threads/thread-batch-1/append')
    const appendBody = JSON.parse(String(calls[1]!.init?.body)) as { messages: unknown[]; idempotency_key: string }
    expect(appendBody.messages).toHaveLength(5)
    expect(appendBody.idempotency_key).toBe('thread-batch-1:15')

    expect(store.getThreadState('session-batch-1')?.lastAppendedMessageSeq).toBe(15)
  })

  test('Given 已有同步进度 seq=10，When 再同步 10 条新消息，Then 只发一次 append，不重复创建线程', async () => {
    const calls: FetchCall[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return jsonResponse({ success: true })
    }) as unknown as typeof fetch

    const { provider, store } = createProviderWithStore()
    await provider.captureThread({
      sessionId: 'session-batch-2',
      threadId: 'thread-batch-2',
      messages: createBatchMessages(10),
    })
    calls.length = 0

    await provider.captureThread({
      sessionId: 'session-batch-2',
      threadId: 'thread-batch-2',
      messages: createBatchMessages(20),
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('http://127.0.0.1:14242/threads/thread-batch-2/append')
    const body = JSON.parse(String(calls[0]!.init?.body)) as { messages: unknown[] }
    expect(body.messages).toHaveLength(10)
    expect(store.getThreadState('session-batch-2')?.lastAppendedMessageSeq).toBe(20)
  })

  test('Given 线程已存在返回 409，When 首次同步，Then 全部批次走 append 路径', async () => {
    const calls: FetchCall[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      if (String(input).endsWith('/threads') && init?.method === 'POST') {
        return jsonResponse({ detail: 'Thread already exists' }, 409)
      }
      return jsonResponse({ success: true })
    }) as unknown as typeof fetch

    const { provider, store } = createProviderWithStore()
    await provider.captureThread({
      sessionId: 'session-batch-3',
      threadId: 'thread-batch-3',
      messages: createBatchMessages(12),
    })

    expect(calls).toHaveLength(3) // 1 次创建(409) + 2 批 append(10+2)
    expect(calls[0]!.url).toBe('http://127.0.0.1:14242/threads')
    expect(calls[1]!.url).toBe('http://127.0.0.1:14242/threads/thread-batch-3/append')
    const body = JSON.parse(String(calls[1]!.init?.body)) as { messages: unknown[] }
    expect(body.messages).toHaveLength(10)
    expect(store.getThreadState('session-batch-3')?.lastAppendedMessageSeq).toBe(12)
  })

  test('Given 中间批次 append 失败，When captureThread 抛错，Then 已成功批次的状态已推进，失败批次不推进', async () => {
    let callCount = 0
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      callCount += 1
      if (init?.method === 'POST' && callCount === 2) {
        return jsonResponse({ detail: 'Internal error' }, 500)
      }
      return jsonResponse({ success: true })
    }) as unknown as typeof fetch

    const { provider, store } = createProviderWithStore()
    await expect(provider.captureThread({
      sessionId: 'session-batch-4',
      threadId: 'thread-batch-4',
      messages: createBatchMessages(15),
    })).rejects.toThrow('Nowledge request failed')

    // 创建成功（第一批 10 条）后第二批失败：seq 应停在 10
    expect(store.getThreadState('session-batch-4')?.lastAppendedMessageSeq).toBe(10)
  })
})
