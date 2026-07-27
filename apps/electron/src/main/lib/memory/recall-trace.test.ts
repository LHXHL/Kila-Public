import { describe, expect, test } from 'bun:test'
import { buildMemoryRecallTraceItems } from './recall-trace'
import type { MemoryEntry, MemoryThreadSearchResult } from './types'

const now = Date.now()

function memory(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: 'memory-1',
    uri: 'memory://global/memory-1',
    kind: 'memory',
    category: 'preference',
    title: '代码风格偏好',
    content: '优先使用中文注释。',
    tags: ['代码'],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function thread(overrides: Partial<MemoryThreadSearchResult> = {}): MemoryThreadSearchResult {
  return {
    threadId: 'thread-1',
    title: '高亮问题排查',
    source: 'Kila',
    messageCount: 8,
    relevanceScore: 0.92,
    matchedMessages: [{ role: 'user', snippet: 'Shiki 在 CSP 下无法加载 WASM。' }],
    ...overrides,
  }
}

describe('buildMemoryRecallTraceItems', () => {
  test('Given 本轮召回了长期记忆与相关会话，When 构建召回轨迹，Then 只记录这两类真实来源', () => {
    const items = buildMemoryRecallTraceItems({
      memoryResults: [{ entry: memory(), score: 7.5 }],
      relatedThreads: [thread()],
    })

    expect(items.map((item) => item.kind)).toEqual(['memory', 'thread'])
    expect(items[0]).toMatchObject({
      id: 'memory://global/memory-1',
      title: '代码风格偏好',
      category: 'preference',
      relevanceScore: 7.5,
    })
    expect(items[1]).toMatchObject({
      id: 'thread-1',
      title: '高亮问题排查',
      provider: 'nowledge',
      source: 'Kila',
      content: 'Shiki 在 CSP 下无法加载 WASM。',
    })
  })

  test('Given 本地笔记能力已随本地存储移除，When 构建召回轨迹，Then 不再产出 notebook 项', () => {
    const items = buildMemoryRecallTraceItems({
      memoryResults: [{ entry: memory(), score: 1 }],
      relatedThreads: [thread()],
    })

    expect(items.some((item) => item.kind === 'notebook')).toBe(false)
  })

  test('Given 单条记忆内容超长，When 构建召回轨迹，Then 截断并标记，避免消息记录无限膨胀', () => {
    const items = buildMemoryRecallTraceItems({
      memoryResults: [{ entry: memory({ content: '长'.repeat(2_000) }), score: 1 }],
      relatedThreads: [],
    })

    expect(items[0]?.content.length).toBe(1_600)
    expect(items[0]?.truncated).toBe(true)
  })
})
