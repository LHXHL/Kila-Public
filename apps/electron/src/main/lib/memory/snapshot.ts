import { memoryProviderManager } from './provider-manager'
import { memoryStateStore } from './state-store'
import type { MemoryRecallTraceItem, MemoryRunTrace } from '@kila/shared'
import type {
  MemoryEntry,
  MemorySnapshotCacheEntry,
  MemoryThreadSearchResult,
  NotebookEntry,
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

function renderNotebookLines(entries: NotebookEntry[]): string[] {
  return entries.map((entry, index) => {
    const title = entry.title ? ` title="${escapeXml(entry.title)}"` : ''
    return `    <note index="${index + 1}" uri="${escapeXml(entry.uri)}"${title}>${escapeXml(entry.content)}</note>`
  })
}

function renderSnapshotXml(input: {
  indexContext: string
  globalWorkingMemory: WorkingMemory | null
  projectWorkingMemory: WorkingMemory | null
  recalledMemories: MemoryEntry[]
  relatedThreads: MemoryThreadSearchResult[]
  notebookEntries: NotebookEntry[]
}): string {
  const lines: string[] = ['<memory_context>']
  if (input.indexContext.trim()) {
    lines.push(`  <local_memory_index>${escapeXml(input.indexContext.slice(0, 4_000))}</local_memory_index>`)
  }
  const globalLine = buildWorkingMemoryLine('global_working_memory', input.globalWorkingMemory)
  if (globalLine) lines.push(globalLine)
  const projectLine = buildWorkingMemoryLine('project_working_memory', input.projectWorkingMemory)
  if (projectLine) lines.push(projectLine)

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

  if (input.notebookEntries.length > 0) {
    lines.push('  <notebook_supplement>')
    lines.push(...renderNotebookLines(input.notebookEntries))
    lines.push('  </notebook_supplement>')
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
  async buildPromptContext(input: BuildPromptContextInput): Promise<MemoryPromptContextResult> {
    const providerStatus = await memoryProviderManager.getStatus()
    const query = buildRecallQuery(input)
    if (!query) {
      const cached = memoryStateStore.getSnapshotCache('session', input.sessionId)
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

    const indexContext = memoryProviderManager.getIndexContext(input.projectPath)
    const [globalWorkingMemory, projectWorkingMemory, recalledMemoryResults, relatedThreads, notebookEntries] = await Promise.all([
      memoryProviderManager.getWorkingMemory({ scope: 'global' }),
      input.projectPath
        ? memoryProviderManager.getWorkingMemory({ scope: 'project', projectPath: input.projectPath })
        : Promise.resolve(null),
      memoryProviderManager.search({ query, limit: 4, projectPath: input.projectPath, sessionId: input.sessionId }),
      memoryProviderManager.searchThreads({ query, limit: 3 }),
      memoryProviderManager.listNotebookEntries(input.projectPath ? { limit: 2, projectPath: input.projectPath } : { limit: 2 }),
    ])
    const recalledMemories = recalledMemoryResults.map((item) => item.entry)
    const recallItems = buildMemoryRecallTraceItems({
      memoryResults: recalledMemoryResults,
      relatedThreads,
      notebookEntries,
    })

    const snapshotText = renderSnapshotXml({
      indexContext,
      globalWorkingMemory,
      projectWorkingMemory,
      recalledMemories,
      relatedThreads,
      notebookEntries,
    })

    memoryStateStore.upsertSnapshotCache({
      scopeType: 'session',
      scopeKey: input.sessionId,
      snapshotText,
      snapshotSourceJson: JSON.stringify({
        query,
        indexContext: Boolean(indexContext.trim()),
        globalWorkingMemory: Boolean(globalWorkingMemory?.content?.trim()),
        projectWorkingMemory: Boolean(projectWorkingMemory?.content?.trim()),
        recalledMemoryCount: recalledMemories.length,
        relatedThreadCount: relatedThreads.length,
        notebookCount: notebookEntries.length,
        recallItems,
      }),
      updatedAt: Date.now(),
    })
    memoryStateStore.appendRuntimeEvent({
      sessionId: input.sessionId,
      threadId: input.sessionId,
      eventType: 'snapshot_built',
      status: 'success',
      detail: `prompt snapshot built with query: ${query.slice(0, 120)}`,
    })

    return {
      text: snapshotText ? `${snapshotText}\n\n` : '',
      trace: {
        enabled: true,
        provider: providerStatus.activeProvider,
        recalledMemoryCount: recalledMemories.length,
        relatedThreadCount: relatedThreads.length,
        notebookCount: notebookEntries.length,
        recallItems,
        usedGlobalWorkingMemory: Boolean(globalWorkingMemory?.content?.trim()),
        usedProjectWorkingMemory: Boolean(projectWorkingMemory?.content?.trim()),
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
    const indexContext = memoryProviderManager.getIndexContext(input.projectPath)
    const [globalWorkingMemory, projectWorkingMemory, memories, notebookEntries] = await Promise.all([
      memoryProviderManager.getWorkingMemory({ scope: 'global' }),
      input.projectPath
        ? memoryProviderManager.getWorkingMemory({ scope: 'project', projectPath: input.projectPath })
        : Promise.resolve(null),
      memoryProviderManager.list(input.projectPath ? { limit: 6, projectPath: input.projectPath } : { limit: 6 }),
      memoryProviderManager.listNotebookEntries(input.projectPath ? { limit: 3, projectPath: input.projectPath } : { limit: 3 }),
    ])
    const recallItems = buildMemoryRecallTraceItems({
      memoryResults: memories.map((entry) => ({ entry, score: 0 })),
      relatedThreads: [],
      notebookEntries,
    })

    const snapshotText = renderSnapshotXml({
      indexContext,
      globalWorkingMemory,
      projectWorkingMemory,
      recalledMemories: memories,
      relatedThreads: [],
      notebookEntries,
    })

    memoryStateStore.upsertSnapshotCache({
      scopeType: 'global',
      scopeKey: toScopeKey('global', input),
      snapshotText,
      snapshotSourceJson: JSON.stringify({
        globalWorkingMemory: Boolean(globalWorkingMemory?.content?.trim()),
        recalledMemoryCount: memories.length,
        notebookCount: notebookEntries.length,
        recallItems,
      }),
      updatedAt: Date.now(),
    })

    if (input.projectPath) {
      memoryStateStore.upsertSnapshotCache({
        scopeType: 'project',
        scopeKey: toScopeKey('project', input),
        snapshotText,
        snapshotSourceJson: JSON.stringify({
          projectWorkingMemory: Boolean(projectWorkingMemory?.content?.trim()),
          recalledMemoryCount: memories.length,
          notebookCount: notebookEntries.length,
          recallItems,
        }),
        updatedAt: Date.now(),
      })
    }

    if (input.sessionId) {
      memoryStateStore.upsertSnapshotCache({
        scopeType: 'session',
        scopeKey: toScopeKey('session', input),
        snapshotText,
        snapshotSourceJson: JSON.stringify({
          messageCount: input.messages?.length ?? 0,
          recalledMemoryCount: memories.length,
          notebookCount: notebookEntries.length,
          recallItems,
        }),
        updatedAt: Date.now(),
      })
    }

    memoryStateStore.appendRuntimeEvent({
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
      ? memoryStateStore.getSnapshotCache('session', input.sessionId)
      : null
    if (sessionSnapshot?.snapshotText) return sessionSnapshot.snapshotText

    const projectSnapshot = input.projectPath
      ? memoryStateStore.getSnapshotCache('project', input.projectPath)
      : null
    if (projectSnapshot?.snapshotText) return projectSnapshot.snapshotText

    return memoryStateStore.getSnapshotCache('global', 'global')?.snapshotText ?? ''
  }

  getCachedSnapshotEntry(input: { projectPath?: string; sessionId?: string } = {}): MemorySnapshotCacheEntry | null {
    if (input.sessionId) {
      const sessionSnapshot = memoryStateStore.getSnapshotCache('session', input.sessionId)
      if (sessionSnapshot) return sessionSnapshot
    }
    if (input.projectPath) {
      const projectSnapshot = memoryStateStore.getSnapshotCache('project', input.projectPath)
      if (projectSnapshot) return projectSnapshot
    }
    return memoryStateStore.getSnapshotCache('global', 'global')
  }
}

export const memorySnapshotManager = new MemorySnapshotManager()
