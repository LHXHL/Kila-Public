import { afterEach, describe, expect, test } from 'bun:test'
import { NowledgeMemoryProvider } from './nowledge-provider'

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

afterEach(() => {
  globalThis.fetch = originalFetch
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
