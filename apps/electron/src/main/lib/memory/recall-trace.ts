import type { MemoryRecallTraceItem } from '@kila/shared'
import type {
  MemorySearchResult,
  MemoryThreadSearchResult,
} from './types'

const TRACE_CONTENT_LIMIT = 1_600

function limitTraceContent(value: string): { content: string; truncated: boolean } {
  const normalized = value.trim()
  if (normalized.length <= TRACE_CONTENT_LIMIT) {
    return { content: normalized, truncated: false }
  }
  return {
    content: normalized.slice(0, TRACE_CONTENT_LIMIT).trimEnd(),
    truncated: true,
  }
}

function resolveMemoryProvider(uri: string): MemoryRecallTraceItem['provider'] {
  return uri.startsWith('memory://global/') || uri.startsWith('memory://project/')
    ? 'local'
    : 'nowledge'
}

/**
 * 把本轮真正参与上下文构建的召回结果转成可持久化的受限摘要。
 * 内容有单项长度上限，避免 memory_trace 让 JSONL 消息无限膨胀。
 *
 * 注意：`MemoryRecallTraceItem` 仍保留 `kind: 'notebook'` 与 `provider: 'local'`，
 * 那是为了解析历史 JSONL；本地笔记随本地存储移除后，这里不再构造它们。
 */
export function buildMemoryRecallTraceItems(input: {
  memoryResults: MemorySearchResult[]
  relatedThreads: MemoryThreadSearchResult[]
}): MemoryRecallTraceItem[] {
  const memoryItems = input.memoryResults.map((result): MemoryRecallTraceItem => {
    const limited = limitTraceContent(result.entry.content)
    return {
      kind: 'memory',
      id: result.entry.uri,
      title: result.entry.title?.trim() || result.entry.category || '未命名长期记忆',
      content: limited.content,
      truncated: limited.truncated || undefined,
      provider: resolveMemoryProvider(result.entry.uri),
      category: result.entry.category,
      tags: result.entry.tags.length > 0 ? result.entry.tags : undefined,
      relevanceScore: Number.isFinite(result.score) ? result.score : undefined,
    }
  })

  const threadItems = input.relatedThreads.map((thread): MemoryRecallTraceItem => {
    const snippet = thread.matchedMessages[0]?.snippet ?? ''
    const limited = limitTraceContent(snippet)
    return {
      kind: 'thread',
      id: thread.threadId,
      title: thread.title.trim() || '未命名相关会话',
      content: limited.content,
      truncated: limited.truncated || undefined,
      provider: 'nowledge',
      source: thread.source,
      relevanceScore: Number.isFinite(thread.relevanceScore) ? thread.relevanceScore : undefined,
    }
  })

  return [...memoryItems, ...threadItems]
}
