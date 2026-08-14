import { randomUUID } from 'node:crypto'
import {
  asRecord,
  CATEGORY_TO_UNIT_TYPE,
  categoryFromUnitType,
  createNowledgeRequestError,
  normalizeCategory,
  normalizeText,
  NowledgeRequestError,
  parseConnectionItems,
  parseHealthVersion,
  parseThreadFetchResult,
  parseThreadSearchResults,
  parseTimelineEvents,
  parseWorkingMemoryPayload,
  pickListPayload,
  toFiniteNumber,
  toOptionalTimestamp,
  toStringArray,
  toTimestamp,
} from './nowledge-payload'
import type { MemoryProvider } from './provider'
import { memoryStateStore, type MemoryStateStore } from './state-store'
import { chunkThreadMessages } from './thread-batch'
import { patchMarkdownSection } from './working-memory-patch'
import type {
  MemoryConnectionsInput,
  MemoryConnectionsResult,
  MemoryEditInput,
  MemoryEntry,
  MemoryListInput,
  MemoryProviderStatus,
  MemorySearchInput,
  MemorySearchResult,
  MemoryThreadFetchInput,
  MemoryThreadFetchResult,
  MemoryThreadSearchInput,
  MemoryThreadSearchResult,
  MemoryTimelineEvent,
  MemoryTimelineInput,
  MemoryThreadCaptureInput,
  MemoryWriteInput,
  WorkingMemory,
  WorkingMemoryInput,
  WorkingMemoryPatchInput,
  WorkingMemoryUpdateInput,
} from './types'

interface NowledgeProviderOptions {
  baseUrl: string
  apiKey?: string
  timeoutMs: number
  mode: 'nowledge'
}

interface NowledgeMemoryProviderDeps {
  stateStore?: MemoryStateStore
}

const MIN_THREAD_SYNC_TIMEOUT_MS = 30_000

/**
 * 幂等读请求的重试次数。
 *
 * Kila 是本地优先应用但记忆依赖 Nowledge 本地服务：读路径偶发超时（服务刚启动、
 * 正在重建索引）时重试一次能显著降低「记忆突然为空」的体感。
 * 写入侧保持快速失败，避免重复落库。
 */
const READ_RETRIES = 1

/** 读请求重试的退避基数，按尝试次数线性放大 */
const RETRY_BACKOFF_MS = 300

/** 记忆列表响应的包装字段（不同 Nowledge 版本命名不一致） */
const MEMORY_LIST_KEYS = ['memories', 'items', 'results'] as const

interface NormalizedMemoryRecord {
  id: string
  title: string
  content: string
  labels: string[]
  sourceThreadId?: string
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class NowledgeMemoryProvider implements MemoryProvider {
  private readonly stateStore: MemoryStateStore
  private backendVersion: string | undefined

  constructor(
    private readonly options: NowledgeProviderOptions,
    deps: NowledgeMemoryProviderDeps = {},
  ) {
    this.stateStore = deps.stateStore ?? memoryStateStore
  }

  initialize(): void {}

  dispose(): void {}

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.requestRead('/health', { timeoutMs: 5_000 })
      this.backendVersion = parseHealthVersion(response) ?? this.backendVersion
      return true
    } catch {
      return false
    }
  }

  async getStatus(): Promise<MemoryProviderStatus> {
    const healthy = await this.healthCheck()
    return {
      mode: 'nowledge',
      activeProvider: 'nowledge',
      // 本地 Markdown 存储已移除：这两个字段只为兼容既有状态类型保留，恒为不可用。
      localReady: false,
      memoryDirectory: '',
      nowledgeEnabled: true,
      nowledgeConfigured: true,
      nowledgeHealthy: healthy,
      nowledgeBackendVersion: this.backendVersion,
      checkedAt: Date.now(),
      detail: healthy ? 'Nowledge provider healthy' : 'Nowledge provider unavailable',
    }
  }

  async search(input: MemorySearchInput): Promise<MemorySearchResult[]> {
    // 语义上是读操作，只是 Nowledge 用 POST 传查询体，因此同样允许一次重试。
    const response = await this.request('/memories/search', {
      method: 'POST',
      retries: READ_RETRIES,
      body: {
        query: input.query,
        limit: input.limit,
      },
    })
    return pickListPayload(response, MEMORY_LIST_KEYS)
      .map((item): MemorySearchResult | null => {
        const result = asRecord(item)
        if (!result) return null
        const rawMemory = asRecord(result.memory) ?? result
        const normalized = this.normalizeMemory(rawMemory)
        const entry = this.toMemoryEntry(rawMemory)
        if (!entry) return null
        return {
          entry,
          score: toFiniteNumber(result.similarity_score)
            ?? toFiniteNumber(result.score)
            ?? toFiniteNumber(result.confidence)
            ?? 0,
          relevanceReason: normalizeText(result.relevance_reason),
          labels: normalized.labels,
          sourceThreadId: normalized.sourceThreadId,
          matchedSnippet: normalizeText(result.snippet),
        }
      })
      .filter((item): item is MemorySearchResult => item !== null)
  }

  async read(uri: string): Promise<MemoryEntry | null> {
    const id = this.idFromUri(uri)
    if (!id) return null
    const response = await this.requestRead(`/memories/${encodeURIComponent(id)}`)
    return this.toMemoryEntryFromResponse(response)
  }

  async write(input: MemoryWriteInput): Promise<MemoryEntry> {
    const writeId = randomUUID()
    const startedAt = Date.now()
    const metadata = {
      ...(this.createKilaMetadata({ ...input, category: input.category ?? 'general' }) ?? {}),
      kila_write_id: writeId,
    }

    let response: unknown
    try {
      response = await this.request('/memories', {
        method: 'POST',
        body: {
          content: input.content,
          title: input.title,
          labels: input.tags,
          unit_type: CATEGORY_TO_UNIT_TYPE[input.category ?? 'general'],
          source_thread_id: input.sourceSessionId,
          source: 'kila',
          metadata,
        },
      })
    } catch (error) {
      // Nowledge 可能先完成数据库写入，再在生成向量时返回 500。
      // 先按写入 ID回查，避免把“已落库但索引失败”误报成写入失败。
      if (error instanceof NowledgeRequestError && error.code === 'remote_embedding_auth_failed') {
        const persisted = await this.findPersistedWrite(input, writeId, startedAt).catch(() => null)
        if (persisted) return persisted
      }
      throw error
    }

    const entry = this.toMemoryEntryFromResponse(response)
    if (!entry) {
      throw new Error('Nowledge returned invalid memory payload')
    }
    return entry
  }

  async edit(input: MemoryEditInput): Promise<MemoryEntry | null> {
    const id = this.idFromUri(input.uri)
    if (!id) return null
    const response = await this.request(`/memories/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: {
        content: input.content,
        title: input.title,
        labels: input.tags,
        unit_type: input.category ? CATEGORY_TO_UNIT_TYPE[input.category] : undefined,
        metadata: this.createKilaMetadata(input),
      },
    })
    return this.toMemoryEntryFromResponse(response)
  }

  async forget(uri: string): Promise<boolean> {
    const id = this.idFromUri(uri)
    if (!id) return false
    await this.request(`/memories/${encodeURIComponent(id)}`, { method: 'DELETE' })
    return true
  }

  async list(input: MemoryListInput = {}): Promise<MemoryEntry[]> {
    const params = new URLSearchParams()
    if (typeof input.limit === 'number') params.set('limit', String(input.limit))
    if (typeof input.offset === 'number') params.set('offset', String(input.offset))
    const response = await this.requestRead(`/memories${params.size ? `?${params.toString()}` : ''}`)
    return pickListPayload(response, MEMORY_LIST_KEYS)
      .map((item) => this.toMemoryEntry(item))
      .filter((item): item is MemoryEntry => item !== null)
  }

  async captureThread(input: MemoryThreadCaptureInput): Promise<void> {
    await this.syncThread(input)
  }

  async getWorkingMemory(input: WorkingMemoryInput): Promise<WorkingMemory | null> {
    if (input.scope === 'project') return null
    const params = new URLSearchParams()
    params.set('date', new Date().toISOString().slice(0, 10))
    const response = await this.requestRead(`/agent/working-memory?${params.toString()}`)
    const payload = parseWorkingMemoryPayload(response)
    if (payload.content === undefined) return null
    return {
      scope: 'global',
      content: payload.content,
      updatedAt: payload.updatedAt,
    }
  }

  async setWorkingMemory(input: WorkingMemoryUpdateInput): Promise<WorkingMemory> {
    if (input.scope === 'project') {
      return {
        scope: 'project',
        projectPath: normalizeText(input.projectPath),
        content: input.content,
        updatedAt: Date.now(),
      }
    }
    const response = await this.request('/agent/working-memory', {
      method: 'PUT',
      body: {
        content: input.content,
      },
    })
    const payload = parseWorkingMemoryPayload(response)
    return {
      scope: 'global',
      content: payload.content ?? input.content,
      updatedAt: payload.updatedAt,
    }
  }

  async patchWorkingMemory(input: WorkingMemoryPatchInput): Promise<WorkingMemory> {
    const current = await this.getWorkingMemory(input)
    return this.setWorkingMemory({
      scope: input.scope,
      projectPath: input.projectPath,
      content: patchMarkdownSection(current?.content ?? '', input.heading, input),
    })
  }

  async searchThreads(input: MemoryThreadSearchInput): Promise<MemoryThreadSearchResult[]> {
    const params = new URLSearchParams({
      query: input.query,
      mode: 'full',
      limit: String(Math.min(Math.max(input.limit ?? 5, 1), 20)),
    })
    if (input.source) params.set('source', input.source)

    const response = await this.requestRead(`/threads/search?${params.toString()}`)
    return parseThreadSearchResults(response)
  }

  async fetchThread(input: MemoryThreadFetchInput): Promise<MemoryThreadFetchResult | null> {
    const params = new URLSearchParams({
      limit: String(Math.min(Math.max(input.limit ?? 50, 1), 200)),
    })
    if ((input.offset ?? 0) > 0) params.set('offset', String(input.offset))
    const response = await this.requestRead(`/threads/${encodeURIComponent(input.threadId)}?${params.toString()}`)
    return parseThreadFetchResult(response, input.threadId)
  }

  async deleteThread(threadId: string, options?: { cascadeDeleteMemories?: boolean }): Promise<boolean> {
    const params = new URLSearchParams({
      cascade_delete_memories: options?.cascadeDeleteMemories ? 'true' : 'false',
    })
    await this.request(
      `/threads/${encodeURIComponent(threadId)}?${params.toString()}`,
      {
        method: 'DELETE',
        timeoutMs: Math.max(this.options.timeoutMs, MIN_THREAD_SYNC_TIMEOUT_MS),
      },
    )
    return true
  }

  async listTimelineEvents(input: MemoryTimelineInput): Promise<MemoryTimelineEvent[]> {
    const params = new URLSearchParams({
      last_n_days: String(Math.max(1, input.lastNDays ?? 7)),
      limit: String(Math.min(Math.max(input.limit ?? 50, 1), 200)),
    })
    if (input.eventType) params.set('event_type', input.eventType)
    if (input.dateFrom) params.set('date_from', input.dateFrom)
    if (input.dateTo) params.set('date_to', input.dateTo)
    if (input.tier1Only === false) params.set('tier1_only', 'false')

    const response = await this.requestRead(`/agent/feed/events?${params.toString()}`)
    return parseTimelineEvents(response)
  }

  async getConnections(input: MemoryConnectionsInput): Promise<MemoryConnectionsResult | null> {
    let memoryId = normalizeText(input.memoryId)
    if (!memoryId && input.query) {
      const searchResults = await this.search({ query: input.query, limit: 1 })
      memoryId = searchResults[0]?.entry.id
    }
    if (!memoryId) return null

    const response = await this.requestRead(`/graph/expand/${encodeURIComponent(memoryId)}?depth=1&limit=20`)
    return {
      targetMemoryId: memoryId,
      items: parseConnectionItems(response, memoryId),
    }
  }

  private async syncThread(input: MemoryThreadCaptureInput): Promise<void> {
    const existingState = this.stateStore.getThreadState(input.sessionId)
    const syncedCount = existingState?.lastAppendedMessageSeq ?? 0
    const nextMessages = input.messages.slice(syncedCount)

    if (nextMessages.length === 0) {
      return
    }

    // 分批发送：Nowledge 写入路径对每条消息做嵌入与索引，长会话全量一次发送
    // 容易撞客户端超时；分批后单请求负载小，每批成功即推进 lastAppendedMessageSeq，
    // 中途失败时下一轮只补发剩余批次，不再整轮全量重发。
    const batches = chunkThreadMessages(nextMessages)
    const threadTimeoutMs = Math.max(this.options.timeoutMs, MIN_THREAD_SYNC_TIMEOUT_MS)

    let seq = syncedCount
    let appendFrom = 0

    if (syncedCount === 0) {
      // nextMessages 非空时批次必然存在；守卫仅为满足严格类型检查
      const firstBatch = batches[0]
      if (!firstBatch) return
      try {
        await this.request('/threads', {
          method: 'POST',
          timeoutMs: threadTimeoutMs,
          body: {
            thread_id: input.threadId,
            title: input.threadTitle,
            messages: firstBatch.messages,
            source: 'kila',
            project: input.projectPath,
            workspace: input.projectPath,
          },
        })
        seq = syncedCount + firstBatch.endSeq
        appendFrom = 1
        this.stateStore.patchThreadState(input.sessionId, {
          threadId: input.threadId,
          threadTitle: input.threadTitle,
          projectPath: input.projectPath,
          lastAppendedMessageSeq: seq,
          lastError: undefined,
        })
        this.stateStore.appendRuntimeEvent({
          sessionId: input.sessionId,
          threadId: input.threadId,
          eventType: 'thread_created',
          status: 'success',
          detail: `created thread with ${firstBatch.messages.length} messages`,
        })
      } catch (error) {
        if (!this.isThreadAlreadyExistsError(error)) {
          this.stateStore.patchThreadState(input.sessionId, {
            threadId: input.threadId,
            threadTitle: input.threadTitle,
            projectPath: input.projectPath,
            lastError: error instanceof Error ? error.message : String(error),
          })
          this.stateStore.appendRuntimeEvent({
            sessionId: input.sessionId,
            threadId: input.threadId,
            eventType: 'thread_sync_failed',
            status: 'error',
            detail: error instanceof Error ? error.message : String(error),
          })
          throw error
        }
        // 409 线程已存在：状态丢失或并发创建，全部批次改走 append
      }
    }

    for (const batch of batches.slice(appendFrom)) {
      // endSeq 是相对 nextMessages 的偏移，转成全局序号再推进与幂等
      const batchEndSeq = syncedCount + batch.endSeq
      await this.request(`/threads/${encodeURIComponent(input.threadId)}/append`, {
        method: 'POST',
        timeoutMs: threadTimeoutMs,
        body: {
          messages: batch.messages,
          deduplicate: true,
          idempotency_key: `${input.threadId}:${batchEndSeq}`,
        },
      })
      seq = batchEndSeq
      this.stateStore.patchThreadState(input.sessionId, {
        threadId: input.threadId,
        threadTitle: input.threadTitle,
        projectPath: input.projectPath,
        lastAppendedMessageSeq: seq,
        lastError: undefined,
      })
      this.stateStore.appendRuntimeEvent({
        sessionId: input.sessionId,
        threadId: input.threadId,
        eventType: 'thread_appended',
        status: 'success',
        detail: `appended ${batch.messages.length} messages`,
      })
    }
  }

  private isThreadAlreadyExistsError(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    return error.message.includes('409') || error.message.toLowerCase().includes('already exists')
  }

  private idFromUri(uri: string): string | null {
    return uri.startsWith('memory://') ? uri.slice('memory://'.length).trim() || null : null
  }

  private createKilaMetadata(
    input: Pick<MemoryWriteInput, 'key' | 'projectPath' | 'category' | 'sourceSessionId'> | MemoryEditInput,
  ): Record<string, unknown> | undefined {
    const metadata: Record<string, unknown> = {}
    if (input.key !== undefined) metadata.kila_key = input.key
    if (input.projectPath !== undefined) metadata.kila_project_path = input.projectPath
    if (input.category !== undefined) metadata.kila_category = input.category
    if ('sourceSessionId' in input && input.sourceSessionId !== undefined) {
      metadata.kila_source_session_id = input.sourceSessionId
    }
    return Object.keys(metadata).length > 0 ? metadata : undefined
  }

  private async findPersistedWrite(
    input: MemoryWriteInput,
    writeId: string,
    startedAt: number,
  ): Promise<MemoryEntry | null> {
    const response = await this.requestRead('/memories?limit=100&offset=0')

    for (const item of pickListPayload(response, MEMORY_LIST_KEYS)) {
      const record = asRecord(item)
      const rawMemory = asRecord(record?.memory) ?? record
      const metadata = asRecord(rawMemory?.metadata)
      const entry = this.toMemoryEntry(rawMemory)
      if (!entry) continue

      if (metadata?.kila_write_id === writeId) return entry

      // 兼容 Nowledge 版本没有回传自定义 metadata 的情况，只接受刚刚创建的
      // 完全相同内容，避免误认历史上同内容的旧记忆。
      const sameContent = entry.content === input.content
      const sameTitle = (entry.title ?? '') === (input.title ?? '')
      const sameSession = entry.sourceSessionId === input.sourceSessionId
      const persistedAt = toOptionalTimestamp(
        rawMemory?.updatedAt
        ?? rawMemory?.updated_at
        ?? rawMemory?.createdAt
        ?? rawMemory?.created_at
        ?? rawMemory?.time,
      )
      const recentEnough = persistedAt !== undefined && persistedAt >= startedAt - 60_000
      if (sameContent && sameTitle && sameSession && recentEnough) return entry
    }

    return null
  }

  private toMemoryEntryFromResponse(response: unknown): MemoryEntry | null {
    const responseRecord = asRecord(response)
    const rawMemory = asRecord(responseRecord?.memory) ?? responseRecord
    if (!rawMemory) return null

    const assignedLabels = toStringArray(responseRecord?.assigned_labels)
    return this.toMemoryEntry(
      assignedLabels.length > 0 && toStringArray(rawMemory.labels).length === 0
        ? { ...rawMemory, labels: assignedLabels }
        : rawMemory,
    )
  }

  private toMemoryEntry(raw: unknown): MemoryEntry | null {
    const record = asRecord(raw)
    if (!record) return null
    const metadata = asRecord(record.metadata)
    const normalized = this.normalizeMemory(record)
    if (!normalized.id || !normalized.content) return null

    return {
      kind: 'memory',
      id: normalized.id,
      uri: normalizeText(record.uri) ?? `memory://${normalized.id}`,
      key: normalizeText(metadata?.kila_key ?? record.key),
      title: normalizeText(normalized.title || record.title),
      content: normalized.content,
      tags: normalized.labels,
      category: normalizeCategory(metadata?.kila_category ?? record.category)
        ?? categoryFromUnitType(record.unit_type),
      sourceSessionId: normalizeText(
        metadata?.kila_source_session_id
        ?? record.sourceSessionId
        ?? record.source_thread_id,
      ),
      projectPath: normalizeText(metadata?.kila_project_path ?? record.projectPath),
      createdAt: toTimestamp(record.createdAt ?? record.created_at ?? record.time),
      updatedAt: toTimestamp(record.updatedAt ?? record.updated_at ?? record.time),
    }
  }

  private normalizeMemory(raw: unknown): NormalizedMemoryRecord {
    const record = asRecord(raw)
    if (!record) {
      return { id: '', title: '', content: '', labels: [] }
    }
    const sourceThread = asRecord(record.source_thread)
    return {
      id: normalizeText(record.id) ?? '',
      title: normalizeText(record.title) ?? '',
      content: normalizeText(record.content) ?? '',
      labels: toStringArray(record.labels).length > 0
        ? toStringArray(record.labels)
        : toStringArray(record.label_ids),
      sourceThreadId: normalizeText(
        sourceThread?.id
        ?? record.source_thread
        ?? record.source_thread_id
        ?? asRecord(record.metadata)?.source_thread_id,
      ),
    }
  }

  /** 幂等读请求：超时时允许一次带退避的重试 */
  private requestRead(pathname: string, options: { timeoutMs?: number } = {}): Promise<unknown> {
    return this.request(pathname, { method: 'GET', timeoutMs: options.timeoutMs, retries: READ_RETRIES })
  }

  private async request(pathname: string, options: {
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
    body?: Record<string, unknown>
    timeoutMs?: number
    retries?: number
  }): Promise<unknown> {
    const timeoutMs = options.timeoutMs ?? this.options.timeoutMs
    const retries = options.retries ?? 0

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const headers: Record<string, string> = {
          'content-type': 'application/json',
        }
        if (this.options.apiKey?.trim()) {
          headers.authorization = `Bearer ${this.options.apiKey}`
          headers['x-nmem-api-key'] = this.options.apiKey
        }

        const response = await fetch(new URL(pathname, this.options.baseUrl).toString(), {
          method: options.method,
          headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        })

        if (!response.ok) {
          const text = await response.text()
          throw createNowledgeRequestError(response.status, text)
        }

        if (response.status === 204) return {}
        return await response.json()
      } catch (error) {
        if (!this.isAbortError(error)) throw error
        if (attempt >= retries) {
          throw new Error(`Nowledge request timed out after ${timeoutMs}ms: ${pathname}`)
        }
        // 只对幂等读路径重试；线性退避避免刚启动的 Nowledge 被连续打爆。
        await delay(RETRY_BACKOFF_MS * (attempt + 1))
      } finally {
        clearTimeout(timeout)
      }
    }

    throw new Error(`Nowledge request failed unexpectedly: ${pathname}`)
  }

  private isAbortError(error: unknown): boolean {
    if (error instanceof DOMException) {
      return error.name === 'AbortError'
    }
    return error instanceof Error && error.name === 'AbortError'
  }
}
