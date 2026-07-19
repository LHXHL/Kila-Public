import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { getMemoryStateStorePath } from '../config-paths'
import { readJsonWithBackup, writeTextAtomicWithBackup } from '../safe-json-file'
import type { MemoryRuntimeEvent, MemorySnapshotCacheEntry, NowledgeThreadState } from './types'

interface MemoryStateStoreData {
  threadStates: Record<string, NowledgeThreadState>
  snapshotCache: Record<string, MemorySnapshotCacheEntry>
  runtimeEvents: MemoryRuntimeEvent[]
}

const EMPTY_STATE: MemoryStateStoreData = {
  threadStates: {},
  snapshotCache: {},
  runtimeEvents: [],
}

function cloneState(data: MemoryStateStoreData): MemoryStateStoreData {
  return {
    threadStates: { ...data.threadStates },
    snapshotCache: { ...data.snapshotCache },
    runtimeEvents: [...data.runtimeEvents],
  }
}

function normalizeText(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function snapshotKey(scopeType: MemorySnapshotCacheEntry['scopeType'], scopeKey: string): string {
  return `${scopeType}:${scopeKey}`
}

export class MemoryStateStore {
  private initialized = false
  private data: MemoryStateStoreData = cloneState(EMPTY_STATE)

  constructor(private readonly filePath = getMemoryStateStorePath()) {}

  initialize(): void {
    if (this.initialized) return
    this.data = this.readState()
    this.initialized = true
  }

  dispose(): void {
    this.initialized = false
    this.data = cloneState(EMPTY_STATE)
  }

  getThreadState(sessionId: string): NowledgeThreadState | null {
    this.initialize()
    return this.data.threadStates[sessionId] ?? null
  }

  listThreadStates(): NowledgeThreadState[] {
    this.initialize()
    return Object.values(this.data.threadStates).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  upsertThreadState(input: NowledgeThreadState): NowledgeThreadState {
    this.initialize()
    const next: NowledgeThreadState = {
      ...input,
      threadTitle: normalizeText(input.threadTitle),
      projectPath: normalizeText(input.projectPath),
      lastTriageResultJson: normalizeText(input.lastTriageResultJson),
      lastError: normalizeText(input.lastError),
      updatedAt: input.updatedAt || Date.now(),
    }
    this.data.threadStates[next.sessionId] = next
    this.persist()
    return next
  }

  patchThreadState(sessionId: string, patch: Partial<NowledgeThreadState> & Pick<NowledgeThreadState, 'threadId'>): NowledgeThreadState {
    const current = this.getThreadState(sessionId)
    const has = <K extends keyof NowledgeThreadState>(key: K): boolean => Object.prototype.hasOwnProperty.call(patch, key)
    return this.upsertThreadState({
      sessionId,
      threadId: patch.threadId,
      threadTitle: has('threadTitle') ? patch.threadTitle : current?.threadTitle,
      projectPath: has('projectPath') ? patch.projectPath : current?.projectPath,
      lastAppendedMessageSeq: patch.lastAppendedMessageSeq ?? current?.lastAppendedMessageSeq ?? 0,
      lastDistilledMessageSeq: patch.lastDistilledMessageSeq ?? current?.lastDistilledMessageSeq ?? 0,
      lastDistilledAt: has('lastDistilledAt') ? patch.lastDistilledAt : current?.lastDistilledAt,
      lastTriageAt: has('lastTriageAt') ? patch.lastTriageAt : current?.lastTriageAt,
      lastTriageResultJson: has('lastTriageResultJson') ? patch.lastTriageResultJson : current?.lastTriageResultJson,
      lastError: has('lastError') ? patch.lastError : current?.lastError,
      updatedAt: patch.updatedAt ?? Date.now(),
    })
  }

  getSnapshotCache(scopeType: MemorySnapshotCacheEntry['scopeType'], scopeKey: string): MemorySnapshotCacheEntry | null {
    this.initialize()
    return this.data.snapshotCache[snapshotKey(scopeType, scopeKey)] ?? null
  }

  upsertSnapshotCache(input: MemorySnapshotCacheEntry): MemorySnapshotCacheEntry {
    this.initialize()
    const next: MemorySnapshotCacheEntry = {
      ...input,
      snapshotSourceJson: normalizeText(input.snapshotSourceJson),
      updatedAt: input.updatedAt || Date.now(),
    }
    this.data.snapshotCache[snapshotKey(next.scopeType, next.scopeKey)] = next
    this.persist()
    return next
  }

  appendRuntimeEvent(input: Omit<MemoryRuntimeEvent, 'id' | 'createdAt'> & { id?: string; createdAt?: number }): MemoryRuntimeEvent {
    this.initialize()
    const event: MemoryRuntimeEvent = {
      id: input.id ?? randomUUID(),
      sessionId: normalizeText(input.sessionId),
      threadId: normalizeText(input.threadId),
      eventType: input.eventType,
      status: input.status,
      detail: input.detail,
      createdAt: input.createdAt ?? Date.now(),
    }
    this.data.runtimeEvents.unshift(event)
    this.trimRuntimeEvents()
    this.persist()
    return event
  }

  listRuntimeEvents(input: { limit?: number; sessionId?: string } = {}): MemoryRuntimeEvent[] {
    this.initialize()
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 200)
    const filtered = input.sessionId
      ? this.data.runtimeEvents.filter((event) => event.sessionId === input.sessionId)
      : this.data.runtimeEvents
    return filtered.slice(0, limit)
  }

  deleteSessionState(sessionId: string): void {
    this.initialize()
    delete this.data.threadStates[sessionId]
    delete this.data.snapshotCache[snapshotKey('session', sessionId)]
    this.data.runtimeEvents = this.data.runtimeEvents.filter((event) => event.sessionId !== sessionId)
    this.persist()
  }

  deleteThreadState(sessionId: string): void {
    this.initialize()
    delete this.data.threadStates[sessionId]
    this.persist()
  }

  getLastWorkingMemoryFetchAt(): number | undefined {
    return this.getSnapshotCache('global', 'global')?.updatedAt
  }

  private trimRuntimeEvents(maxRows = 500): void {
    if (this.data.runtimeEvents.length > maxRows) {
      this.data.runtimeEvents = this.data.runtimeEvents.slice(0, maxRows)
    }
  }

  private readState(): MemoryStateStoreData {
    if (!existsSync(this.filePath)) {
      return cloneState(EMPTY_STATE)
    }

    try {
      return readJsonWithBackup(this.filePath, (raw) => {
        const parsed = JSON.parse(raw) as Partial<MemoryStateStoreData>
        return {
          threadStates: parsed.threadStates ?? {},
          snapshotCache: parsed.snapshotCache ?? {},
          runtimeEvents: Array.isArray(parsed.runtimeEvents) ? parsed.runtimeEvents : [],
        }
      })
    } catch {
      return cloneState(EMPTY_STATE)
    }
  }

  private persist(): void {
    writeTextAtomicWithBackup(this.filePath, JSON.stringify(this.data, null, 2))
  }
}

export const memoryStateStore = new MemoryStateStore()
