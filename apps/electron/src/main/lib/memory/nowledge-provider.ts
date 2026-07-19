import { randomUUID } from 'node:crypto'
import type { MemoryProvider } from './provider'
import { memoryStateStore, type MemoryStateStore } from './state-store'
import type {
  MemoryConnectionsInput,
  MemoryConnectionsResult,
  MemoryCategory,
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

interface NormalizedMemoryRecord {
  id: string
  title: string
  content: string
  labels: string[]
  sourceThreadId?: string
}

type NowledgeUnitType = 'fact' | 'preference' | 'decision' | 'plan' | 'procedure' | 'learning' | 'context' | 'event'

const CATEGORY_TO_UNIT_TYPE: Record<MemoryCategory, NowledgeUnitType> = {
  general: 'context',
  decision: 'decision',
  preference: 'preference',
  fact: 'fact',
  task: 'plan',
  insight: 'learning',
}

const UNIT_TYPE_TO_CATEGORY: Record<NowledgeUnitType, MemoryCategory> = {
  fact: 'fact',
  preference: 'preference',
  decision: 'decision',
  plan: 'task',
  procedure: 'task',
  learning: 'insight',
  context: 'general',
  event: 'general',
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item))
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function toOptionalTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function normalizeCategory(value: unknown): MemoryCategory | undefined {
  return value === 'general'
    || value === 'decision'
    || value === 'preference'
    || value === 'fact'
    || value === 'task'
    || value === 'insight'
    ? value
    : undefined
}

function categoryFromUnitType(value: unknown): MemoryCategory {
  const unitType = normalizeText(value) as NowledgeUnitType | undefined
  return unitType && UNIT_TYPE_TO_CATEGORY[unitType]
    ? UNIT_TYPE_TO_CATEGORY[unitType]
    : 'general'
}

interface NowledgeErrorPayload {
  detail: string
  requestId?: string
}

type NowledgeRequestErrorCode = 'remote_embedding_auth_failed' | 'local_auth_failed' | 'request_failed'

class NowledgeRequestError extends Error {
  constructor(
    readonly code: NowledgeRequestErrorCode,
    readonly status: number,
    message: string,
    readonly requestId?: string,
  ) {
    super(message)
    this.name = 'NowledgeRequestError'
  }
}

function parseNowledgeErrorPayload(responseText: string): NowledgeErrorPayload {
  let detail = responseText.trim()

  try {
    const payload = asRecord(JSON.parse(detail))
    detail = normalizeText(payload?.detail)
      ?? normalizeText(payload?.message)
      ?? detail
  } catch {
    // 非 JSON 响应保留原始文本，避免掩盖 Nowledge 返回的诊断信息。
  }

  const requestId = detail.match(/["']request_id["']\s*:\s*["']([^"']+)["']/i)?.[1]
  return { detail, requestId }
}

function createNowledgeRequestError(status: number, responseText: string): Error {
  const { detail, requestId } = parseNowledgeErrorPayload(responseText)
  const normalizedDetail = detail.toLowerCase()
  const requestSuffix = requestId ? `（request_id: ${requestId}）` : ''
  const embeddingAuthFailed = normalizedDetail.includes('remote embedding failed')
    && (normalizedDetail.includes('401 unauthorized') || normalizedDetail.includes('authentication failed'))

  if (embeddingAuthFailed) {
    const providerName = normalizedDetail.includes('modelscope') ? 'ModelScope' : '远程 Embedding 服务'
    const credentialName = providerName === 'ModelScope' ? 'ModelScope Token' : 'Embedding 凭证'
    return new NowledgeRequestError(
      'remote_embedding_auth_failed',
      status,
      `Nowledge 本地服务连接正常，但 ${providerName} 认证失败。请在 Nowledge Mem 中更新有效的 ${credentialName}，重启 Nowledge Mem 后重试。${requestSuffix}`,
      requestId,
    )
  }

  if (status === 401 || status === 403) {
    return new NowledgeRequestError(
      'local_auth_failed',
      status,
      `Kila 无法通过 Nowledge 本地 API 认证。请重新执行“自动检测并启用”，同步最新的本地 API Key。${requestSuffix}`,
      requestId,
    )
  }

  return new NowledgeRequestError('request_failed', status, `Nowledge request failed: ${status} ${detail}`, requestId)
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
      const response = await this.request('/health', { method: 'GET', timeoutMs: 5_000 })
      this.backendVersion = typeof response?.version === 'string'
        ? response.version
        : typeof response?.server_version === 'string'
          ? response.server_version
          : this.backendVersion
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
      localReady: true,
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
    const response = await this.request('/memories/search', {
      method: 'POST',
      body: {
        query: input.query,
        limit: input.limit,
      },
    })
    const responseRecord = asRecord(response)
    const items = Array.isArray(response)
      ? response
      : Array.isArray(responseRecord?.memories)
        ? responseRecord.memories
        : Array.isArray(responseRecord?.results)
          ? responseRecord.results
          : []
    return items
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
      .filter((item: MemorySearchResult | null): item is MemorySearchResult => Boolean(item))
  }

  async read(uri: string): Promise<MemoryEntry | null> {
    const id = this.idFromUri(uri)
    if (!id) return null
    const response = await this.request(`/memories/${encodeURIComponent(id)}`, { method: 'GET' })
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
    const response = await this.request(`/memories${params.size ? `?${params.toString()}` : ''}`, { method: 'GET' })
    const responseRecord = asRecord(response)
    const items = Array.isArray(response)
      ? response
      : Array.isArray(responseRecord?.memories)
        ? responseRecord.memories
        : Array.isArray(responseRecord?.items)
          ? responseRecord.items
          : []
    return items
      .map((item) => this.toMemoryEntry(item))
      .filter((item: MemoryEntry | null): item is MemoryEntry => Boolean(item))
  }

  async captureThread(input: MemoryThreadCaptureInput): Promise<void> {
    await this.syncThread(input)
  }

  async getWorkingMemory(input: WorkingMemoryInput): Promise<WorkingMemory | null> {
    if (input.scope === 'project') return null
    const params = new URLSearchParams()
    params.set('date', new Date().toISOString().slice(0, 10))
    const response = await this.request(`/agent/working-memory?${params.toString()}`, { method: 'GET' })
    const payload = response.working_memory ?? response.workingMemory ?? response
    if (!payload || typeof payload.content !== 'string') return null
    return {
      scope: 'global',
      content: payload.content,
      updatedAt: this.toTimestamp(payload.updated_at ?? payload.updatedAt),
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
    const payload = response.working_memory ?? response.workingMemory ?? response
    return {
      scope: 'global',
      content: typeof payload.content === 'string' ? payload.content : input.content,
      updatedAt: this.toTimestamp(payload.updated_at ?? payload.updatedAt),
    }
  }

  async patchWorkingMemory(input: WorkingMemoryPatchInput): Promise<WorkingMemory> {
    const current = await this.getWorkingMemory(input)
    const nextContent = this.patchWorkingMemorySection(current?.content ?? '', input.heading, input)
    return this.setWorkingMemory({
      scope: input.scope,
      projectPath: input.projectPath,
      content: nextContent,
    })
  }

  async searchThreads(input: MemoryThreadSearchInput): Promise<MemoryThreadSearchResult[]> {
    const params = new URLSearchParams({
      query: input.query,
      mode: 'full',
      limit: String(Math.min(Math.max(input.limit ?? 5, 1), 20)),
    })
    if (input.source) params.set('source', input.source)

    const response = await this.request(`/threads/search?${params.toString()}`, { method: 'GET' })
    const items = Array.isArray(response.threads) ? response.threads : []
    return items.map((item: any) => ({
      threadId: String(item.thread_id ?? item.id ?? ''),
      title: String(item.title ?? '(untitled thread)'),
      source: normalizeText(item.source),
      messageCount: Number(item.message_count ?? 0),
      lastActivity: typeof item.last_activity === 'string' ? item.last_activity : undefined,
      relevanceScore: Number(item.relevance_score ?? 0),
      matchedMessages: Array.isArray(item.matched_messages)
        ? item.matched_messages.slice(0, 3).map((message: any) => ({
          role: String(message.role ?? 'unknown'),
          snippet: String(message.snippet ?? '').trim(),
        }))
        : [],
    })).filter((item: MemoryThreadSearchResult) => Boolean(item.threadId))
  }

  async fetchThread(input: MemoryThreadFetchInput): Promise<MemoryThreadFetchResult | null> {
    const params = new URLSearchParams({
      limit: String(Math.min(Math.max(input.limit ?? 50, 1), 200)),
    })
    if ((input.offset ?? 0) > 0) params.set('offset', String(input.offset))
    const response = await this.request(`/threads/${encodeURIComponent(input.threadId)}?${params.toString()}`, { method: 'GET' })
    return {
      threadId: String(response.thread_id ?? response.id ?? input.threadId),
      title: String(response.title ?? '(untitled)'),
      source: normalizeText(response.source),
      messageCount: Number(response.message_count ?? response.total_messages ?? 0),
      messages: Array.isArray(response.messages)
        ? response.messages.map((message: any) => ({
          role: String(message.role ?? 'unknown'),
          content: String(message.content ?? ''),
          timestamp: message.timestamp ?? message.created_at ?? null,
        }))
        : [],
    }
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

    const response = await this.request(`/agent/feed/events?${params.toString()}`, { method: 'GET' })
    const items = Array.isArray(response) ? response : Array.isArray(response.events) ? response.events : []
    return items.map((item: any) => ({
      id: normalizeText(item.id),
      eventType: String(item.event_type ?? item.type ?? 'unknown'),
      createdAt: String(item.created_at ?? item.timestamp ?? new Date().toISOString()),
      title: normalizeText(item.title),
      description: normalizeText(item.description ?? item.summary ?? item.detail),
      memoryId: normalizeText(item.memory_id),
      relatedMemoryIds: Array.isArray(item.related_memory_ids)
        ? item.related_memory_ids.map((value: unknown) => String(value ?? '')).filter(Boolean)
        : [],
    }))
  }

  async getConnections(input: MemoryConnectionsInput): Promise<MemoryConnectionsResult | null> {
    let memoryId = normalizeText(input.memoryId)
    if (!memoryId && input.query) {
      const searchResults = await this.search({ query: input.query, limit: 1 })
      memoryId = searchResults[0]?.entry.id
    }
    if (!memoryId) return null

    const response = await this.request(`/graph/expand/${encodeURIComponent(memoryId)}?depth=1&limit=20`, { method: 'GET' })
    const neighbors = Array.isArray(response.neighbors) ? response.neighbors : []
    const edges = Array.isArray(response.edges) ? response.edges : []
    const nodeMap = new Map<string, any>()
    for (const node of neighbors) {
      const id = String(node.id ?? '')
      if (id) nodeMap.set(id, node)
    }

    const items = edges.flatMap((edge: any) => {
      const source = String(edge.source ?? '')
      const target = String(edge.target ?? '')
      const neighborId = source === memoryId ? target : source
      const node = nodeMap.get(neighborId)
      if (!node) return []
      return [{
        nodeId: neighborId,
        nodeType: String(node.node_type ?? node.type ?? 'unknown'),
        title: String(node.title ?? node.name ?? node.label ?? neighborId),
        snippet: normalizeText(node.content ?? node.snippet),
        edgeType: String(edge.edge_type ?? edge.type ?? 'RELATED'),
        relation: normalizeText(edge.metadata?.relation_type ?? edge.content_relation),
        weight: typeof edge.weight === 'number' ? edge.weight : typeof edge.relevance_score === 'number' ? edge.relevance_score : undefined,
      }]
    })

    return {
      targetMemoryId: memoryId,
      items,
    }
  }

  private async syncThread(input: MemoryThreadCaptureInput): Promise<void> {
    const existingState = this.stateStore.getThreadState(input.sessionId)
    const syncedCount = existingState?.lastAppendedMessageSeq ?? 0
    const nextMessages = input.messages.slice(syncedCount)

    if (syncedCount === 0) {
      try {
        await this.request('/threads', {
          method: 'POST',
          timeoutMs: Math.max(this.options.timeoutMs, MIN_THREAD_SYNC_TIMEOUT_MS),
          body: {
            thread_id: input.threadId,
            title: input.threadTitle,
            messages: input.messages,
            source: 'kila',
            project: input.projectPath,
            workspace: input.projectPath,
          },
        })
        this.stateStore.patchThreadState(input.sessionId, {
          threadId: input.threadId,
          threadTitle: input.threadTitle,
          projectPath: input.projectPath,
          lastAppendedMessageSeq: input.messages.length,
          lastError: undefined,
        })
        this.stateStore.appendRuntimeEvent({
          sessionId: input.sessionId,
          threadId: input.threadId,
          eventType: 'thread_created',
          status: 'success',
          detail: `created thread with ${input.messages.length} messages`,
        })
        return
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
      }
    }

    if (nextMessages.length === 0) {
      return
    }

    await this.request(`/threads/${encodeURIComponent(input.threadId)}/append`, {
      method: 'POST',
      timeoutMs: Math.max(this.options.timeoutMs, MIN_THREAD_SYNC_TIMEOUT_MS),
      body: {
        messages: nextMessages,
        deduplicate: true,
        idempotency_key: `${input.threadId}:${input.messages.length}`,
      },
    })
    this.stateStore.patchThreadState(input.sessionId, {
      threadId: input.threadId,
      threadTitle: input.threadTitle,
      projectPath: input.projectPath,
      lastAppendedMessageSeq: input.messages.length,
      lastError: undefined,
    })
    this.stateStore.appendRuntimeEvent({
      sessionId: input.sessionId,
      threadId: input.threadId,
      eventType: 'thread_appended',
      status: 'success',
      detail: `appended ${nextMessages.length} messages`,
    })
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
    const response = await this.request('/memories?limit=100&offset=0', { method: 'GET' })
    const responseRecord = asRecord(response)
    const items = Array.isArray(response)
      ? response
      : Array.isArray(responseRecord?.memories)
        ? responseRecord.memories
        : Array.isArray(responseRecord?.items)
          ? responseRecord.items
          : []

    for (const item of items) {
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
      createdAt: this.toTimestamp(record.createdAt ?? record.created_at ?? record.time),
      updatedAt: this.toTimestamp(record.updatedAt ?? record.updated_at ?? record.time),
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

  private patchWorkingMemorySection(currentContent: string, heading: string, input: Pick<WorkingMemoryPatchInput, 'content' | 'append'>): string {
    const trimmedHeading = heading.trim()
    if (!currentContent.trim()) {
      return `${trimmedHeading}\n${(input.append ?? input.content ?? '').trim()}`.trim()
    }

    const lines = currentContent.split('\n')
    const headingLc = trimmedHeading.toLowerCase()
    let startIndex = -1
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index]!.trim().toLowerCase() === headingLc) {
        startIndex = index
        break
      }
    }

    if (startIndex < 0) {
      return `${currentContent.trimEnd()}\n\n${trimmedHeading}\n${(input.append ?? input.content ?? '').trim()}`.trim()
    }

    let endIndex = lines.length
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      if (/^#{1,6}\s/.test(lines[index]!)) {
        endIndex = index
        break
      }
    }

    const existingBody = lines.slice(startIndex + 1, endIndex).join('\n').trimEnd()
    const nextBody = typeof input.append === 'string'
      ? [existingBody, input.append.trim()].filter(Boolean).join('\n')
      : (input.content ?? '').trim()

    return [
      ...lines.slice(0, startIndex),
      lines[startIndex]!,
      nextBody,
      ...lines.slice(endIndex),
    ].join('\n').trim()
  }

  private toTimestamp(value: unknown): number {
    return toOptionalTimestamp(value) ?? Date.now()
  }

  private async request(pathname: string, options: {
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
    body?: Record<string, unknown>
    timeoutMs?: number
    retries?: number
  }): Promise<any> {
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
        if (this.isAbortError(error)) {
          if (attempt < retries) {
            continue
          }
          throw new Error(`Nowledge request timed out after ${timeoutMs}ms: ${pathname}`)
        }
        throw error
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
