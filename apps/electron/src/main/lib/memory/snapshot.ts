import { memoryProviderManager, type MemoryProviderManager } from './provider-manager'
import { memoryStateStore, type MemoryStateStore } from './state-store'
import type { MemoryRecallTraceItem, MemoryRunTrace } from '@kila/shared'
import type {
  MemoryEntry,
  MemorySnapshotCacheEntry,
  MemoryThreadSearchResult,
  WorkingMemory,
} from './types'
import { buildMemoryRecallTraceItems } from './recall-trace'

interface MemorySourceMessage {
  role: string
  content: string
}

interface BuildPromptContextInput {
  sessionId: string
  projectPath?: string
  userMessage: string
  messages: MemorySourceMessage[]
  incognito?: boolean
}

export interface MemoryPromptContextResult {
  text: string
  trace: MemoryRunTrace
}

/** 快照构建只依赖 Provider Manager 的读接口与状态存储的缓存接口 */
export interface MemorySnapshotManagerDeps {
  providerManager: Pick<MemoryProviderManager, 'getStatus' | 'getWorkingMemory' | 'search' | 'searchThreads' | 'list'>
  stateStore: Pick<MemoryStateStore, 'getSnapshotCache' | 'upsertSnapshotCache' | 'appendRuntimeEvent'>
}

/**
 * 历史快照缓存的来源摘要。
 *
 * 读取侧要兼容旧版本写入的字段（indexContext / notebookCount / projectWorkingMemory），
 * 但写入侧已经不再产生这些字段——对应能力随本地存储一起移除。
 */
interface SnapshotSourceSummary {
  indexContext?: boolean
  globalWorkingMemory?: boolean
  projectWorkingMemory?: boolean
  recalledMemoryCount?: number
  relatedThreadCount?: number
  notebookCount?: number
  recallItems?: MemoryRecallTraceItem[]
}

function readSnapshotSourceSummary(value?: string): SnapshotSourceSummary {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return typeof parsed === 'object' && parsed ? parsed as SnapshotSourceSummary : {}
  } catch {
    return {}
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function buildRecallQuery(input: BuildPromptContextInput): string {
  const latest = input.userMessage.trim()
  if (latest.length >= 40) {
    return latest.slice(0, 500)
  }

  const contextParts = input.messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-3)
    .map((message) => message.content.trim())
    .filter(Boolean)
    .map((text) => text.length > 150 ? `${text.slice(0, 150)}…` : text)

  const merged = [latest, ...contextParts].filter(Boolean).join('\n\n').trim()
  return merged.slice(0, 500)
}

function buildWorkingMemoryLine(tagName: string, entry: WorkingMemory | null): string | null {
  const content = entry?.content?.trim()
  if (!content) return null
  return `  <${tagName}>${escapeXml(content)}</${tagName}>`
}

function renderMemoryLines(entries: MemoryEntry[]): string[] {
  return entries.map((entry, index) => {
    const tags = entry.tags.length > 0 ? ` tags="${escapeXml(entry.tags.join(', '))}"` : ''
    const title = entry.title ? ` title="${escapeXml(entry.title)}"` : ''
    return `    <item index="${index + 1}" uri="${escapeXml(entry.uri)}"${title}${tags}>${escapeXml(entry.content)}</item>`
  })
}

function renderThreadLines(threads: MemoryThreadSearchResult[]): string[] {
  return threads.map((thread, index) => {
    const topHit = thread.matchedMessages[0]
    const title = thread.title || '(untitled)'
    const snippet = topHit?.snippet?.trim()
    return `    <thread index="${index + 1}" id="${escapeXml(thread.threadId)}" score="${thread.relevanceScore.toFixed(3)}">${escapeXml(`${title}${snippet ? ` — ${snippet}` : ''}`)}</thread>`
  })
}

function renderSnapshotXml(input: {
  globalWorkingMemory: WorkingMemory | null
  recalledMemories: MemoryEntry[]
  relatedThreads: MemoryThreadSearchResult[]
}): string {
  const lines: string[] = ['<memory_context>']
  const globalLine = buildWorkingMemoryLine('global_working_memory', input.globalWorkingMemory)
  if (globalLine) lines.push(globalLine)

  if (input.recalledMemories.length > 0) {
    lines.push('  <recalled_memories>')
    lines.push(...renderMemoryLines(input.recalledMemories))
    lines.push('  </recalled_memories>')
  }

  if (input.relatedThreads.length > 0) {
    lines.push('  <related_threads>')
    lines.push(...renderThreadLines(input.relatedThreads))
    lines.push('  </related_threads>')
  }

  lines.push('</memory_context>')
  const rendered = lines.join('\n')
  if (rendered.length <= 12_000) return rendered
  return `${rendered.slice(0, 11_960)}\n</memory_context>`
}

function toScopeKey(scopeType: MemorySnapshotCacheEntry['scopeType'], input: { sessionId?: string; projectPath?: string }): string {
  if (scopeType === 'session') return input.sessionId ?? 'session'
  if (scopeType === 'project') return input.projectPath ?? 'project'
  return 'global'
}

export class MemorySnapshotManager {
  constructor(private readonly deps: MemorySnapshotManagerDeps = {
    providerManager: memoryProviderManager,
    stateStore: memoryStateStore,
  }) {}

  async buildPromptContext(input: BuildPromptContextInput): Promise<MemoryPromptContextResult> {
    const providerStatus = await this.deps.providerManager.getStatus()
    const query = buildRecallQuery(input)
    if (!query) {
      const cached = this.deps.stateStore.getSnapshotCache('session', input.sessionId)
      const source = readSnapshotSourceSummary(cached?.snapshotSourceJson)
      return {
        text: cached?.snapshotText ? `${cached.snapshotText}\n\n` : '',
        trace: {
          enabled: true,
          provider: providerStatus.activeProvider,
          recalledMemoryCount: source.recalledMemoryCount ?? 0,
          relatedThreadCount: source.relatedThreadCount ?? 0,
          notebookCount: source.notebookCount ?? 0,
          recallItems: source.recallItems,
          usedGlobalWorkingMemory: source.globalWorkingMemory === true,
          usedProjectWorkingMemory: source.projectWorkingMemory === true,
          incognito: input.incognito === true,
          recallStatus: 'cached',
        },
      }
    }

    const [globalWorkingMemory, recalledMemoryResults, relatedThreads] = await Promise.all([
      this.deps.providerManager.getWorkingMemory({ scope: 'global' }),
      this.deps.providerManager.search({ query, limit: 4, projectPath: input.projectPath, sessionId: input.sessionId }),
      this.deps.providerManager.searchThreads({ query, limit: 3 }),
    ])
    const recalledMemories = recalledMemoryResults.map((item) => item.entry)
    const recallItems = buildMemoryRecallTraceItems({
      memoryResults: recalledMemoryResults,
      relatedThreads,
    })

    const snapshotText = renderSnapshotXml({
      globalWorkingMemory,
      recalledMemories,
      relatedThreads,
    })

    // 隐身会话只允许「召回」，不允许留痕：快照缓存与 runtime event 都会落到
    // memory-state.json，写进去等于把隐身会话的用户消息原文持久化到磁盘。
    if (input.incognito !== true) {
      this.deps.stateStore.upsertSnapshotCache({
        scopeType: 'session',
        scopeKey: input.sessionId,
        snapshotText,
        snapshotSourceJson: JSON.stringify({
          globalWorkingMemory: Boolean(globalWorkingMemory?.content?.trim()),
          recalledMemoryCount: recalledMemories.length,
          relatedThreadCount: relatedThreads.length,
          recallItems,
        }),
        updatedAt: Date.now(),
      })
      this.deps.stateStore.appendRuntimeEvent({
        sessionId: input.sessionId,
        threadId: input.sessionId,
        eventType: 'snapshot_built',
        status: 'success',
        // 诊断只需要规模信息；查询原文来自用户消息，禁止写进日志与状态文件。
        detail: `prompt snapshot built (queryLength=${query.length}, memories=${recalledMemories.length}, threads=${relatedThreads.length})`,
      })
    }

    return {
      text: snapshotText ? `${snapshotText}\n\n` : '',
      trace: {
        enabled: true,
        provider: providerStatus.activeProvider,
        recalledMemoryCount: recalledMemories.length,
        relatedThreadCount: relatedThreads.length,
        notebookCount: 0,
        recallItems,
        usedGlobalWorkingMemory: Boolean(globalWorkingMemory?.content?.trim()),
        usedProjectWorkingMemory: false,
        incognito: input.incognito === true,
        recallStatus: 'success',
      },
    }
  }

  async rebuild(input: {
    sessionId?: string
    projectPath?: string
    messages?: MemorySourceMessage[]
  } = {}): Promise<string> {
    const [globalWorkingMemory, memories] = await Promise.all([
      this.deps.providerManager.getWorkingMemory({ scope: 'global' }),
      this.deps.providerManager.list(input.projectPath ? { limit: 6, projectPath: input.projectPath } : { limit: 6 }),
    ])
    const recallItems = buildMemoryRecallTraceItems({
      memoryResults: memories.map((entry) => ({ entry, score: 0 })),
      relatedThreads: [],
    })

    const snapshotText = renderSnapshotXml({
      globalWorkingMemory,
      recalledMemories: memories,
      relatedThreads: [],
    })

    this.deps.stateStore.upsertSnapshotCache({
      scopeType: 'global',
      scopeKey: toScopeKey('global', input),
      snapshotText,
      snapshotSourceJson: JSON.stringify({
        globalWorkingMemory: Boolean(globalWorkingMemory?.content?.trim()),
        recalledMemoryCount: memories.length,
        recallItems,
      }),
      updatedAt: Date.now(),
    })

    if (input.projectPath) {
      this.deps.stateStore.upsertSnapshotCache({
        scopeType: 'project',
        scopeKey: toScopeKey('project', input),
        snapshotText,
        snapshotSourceJson: JSON.stringify({
          recalledMemoryCount: memories.length,
          recallItems,
        }),
        updatedAt: Date.now(),
      })
    }

    if (input.sessionId) {
      this.deps.stateStore.upsertSnapshotCache({
        scopeType: 'session',
        scopeKey: toScopeKey('session', input),
        snapshotText,
        snapshotSourceJson: JSON.stringify({
          messageCount: input.messages?.length ?? 0,
          recalledMemoryCount: memories.length,
          recallItems,
        }),
        updatedAt: Date.now(),
      })
    }

    this.deps.stateStore.appendRuntimeEvent({
      sessionId: input.sessionId,
      threadId: input.sessionId,
      eventType: 'snapshot_rebuilt',
      status: 'success',
      detail: `snapshot cache rebuilt${input.projectPath ? ` for ${input.projectPath}` : ''}`,
    })

    return snapshotText
  }

  getCachedSnapshot(input: { projectPath?: string; sessionId?: string } = {}): string {
    const sessionSnapshot = input.sessionId
      ? this.deps.stateStore.getSnapshotCache('session', input.sessionId)
      : null
    if (sessionSnapshot?.snapshotText) return sessionSnapshot.snapshotText

    const projectSnapshot = input.projectPath
      ? this.deps.stateStore.getSnapshotCache('project', input.projectPath)
      : null
    if (projectSnapshot?.snapshotText) return projectSnapshot.snapshotText

    return this.deps.stateStore.getSnapshotCache('global', 'global')?.snapshotText ?? ''
  }

  getCachedSnapshotEntry(input: { projectPath?: string; sessionId?: string } = {}): MemorySnapshotCacheEntry | null {
    if (input.sessionId) {
      const sessionSnapshot = this.deps.stateStore.getSnapshotCache('session', input.sessionId)
      if (sessionSnapshot) return sessionSnapshot
    }
    if (input.projectPath) {
      const projectSnapshot = this.deps.stateStore.getSnapshotCache('project', input.projectPath)
      if (projectSnapshot) return projectSnapshot
    }
    return this.deps.stateStore.getSnapshotCache('global', 'global')
  }
}

export const memorySnapshotManager = new MemorySnapshotManager()
