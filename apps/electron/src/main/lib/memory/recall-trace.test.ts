import { describe, expect, test } from 'bun:test'
import { buildMemoryRecallTraceItems } from './recall-trace'
import type { MemoryEntry, MemoryThreadSearchResult, NotebookEntry } from './types'

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

function notebook(overrides: Partial<NotebookEntry> = {}): NotebookEntry {
  return {
    id: 'note-1',
    uri: 'notebook://global/note-1',
    kind: 'notebook',
    title: '发布清单',
    content: '发布前运行类型检查。',
    tags: ['发布'],
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
  test('按长期记忆、相关会话、笔记记录本轮实际召回项', () => {
    const items = buildMemoryRecallTraceItems({
      memoryResults: [{ entry: memory(), score: 7.5 }],
      relatedThreads: [thread()],
      notebookEntries: [notebook()],
    })

    expect(items.map((item) => item.kind)).toEqual(['memory', 'thread', 'notebook'])
    expect(items[0]).toMatchObject({
      id: 'memory://global/memory-1',
      title: '代码风格偏好',
      provider: 'local',
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
    expect(items[2]).toMatchObject({
      id: 'notebook://global/note-1',
      title: '发布清单',
      provider: 'local',
    })
  })

  test('限制单项内容长度并标记截断，避免消息记录无限膨胀', () => {
    const items = buildMemoryRecallTraceItems({
      memoryResults: [{ entry: memory({ content: '长'.repeat(2_000) }), score: 1 }],
      relatedThreads: [],
      notebookEntries: [],
    })

    expect(items[0]?.content.length).toBe(1_600)
    expect(items[0]?.truncated).toBe(true)
  })
})
