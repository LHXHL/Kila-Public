/**
 * Nowledge HTTP 响应收窄
 *
 * Nowledge 本地 API 的响应结构在不同版本之间会漂移（裸数组 / `{ memories }` / `{ items }` …），
 * 字段命名也 snake_case 与 camelCase 混用。这里集中放置所有「unknown → 领域类型」的收窄逻辑，
 * 让 Provider 只负责请求编排，不再对未校验的响应直接点取属性。
 */

import type {
  MemoryCategory,
  MemoryConnectionItem,
  MemoryThreadFetchResult,
  MemoryThreadSearchResult,
  MemoryTimelineEvent,
} from './types'

export type NowledgeUnitType =
  | 'fact'
  | 'preference'
  | 'decision'
  | 'plan'
  | 'procedure'
  | 'learning'
  | 'context'
  | 'event'

export const CATEGORY_TO_UNIT_TYPE: Record<MemoryCategory, NowledgeUnitType> = {
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

// ===== 基础收窄工具 =====

export function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function toStringArray(value: unknown): string[] {
  return asArray(value)
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item))
}

/** 兼容 Nowledge 把 ID 回传成数字的情况 */
export function toIdArray(value: unknown): string[] {
  return asArray(value)
    .map((item) => (typeof item === 'string' || typeof item === 'number' ? String(item).trim() : ''))
    .filter(Boolean)
}

export function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function toOptionalTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

export function toTimestamp(value: unknown): number {
  return toOptionalTimestamp(value) ?? Date.now()
}

export function normalizeCategory(value: unknown): MemoryCategory | undefined {
  return value === 'general'
    || value === 'decision'
    || value === 'preference'
    || value === 'fact'
    || value === 'task'
    || value === 'insight'
    ? value
    : undefined
}

export function categoryFromUnitType(value: unknown): MemoryCategory {
  const unitType = normalizeText(value) as NowledgeUnitType | undefined
  return unitType && UNIT_TYPE_TO_CATEGORY[unitType]
    ? UNIT_TYPE_TO_CATEGORY[unitType]
    : 'general'
}

/**
 * 从「裸数组 / 带包装字段的对象」两种响应形态里取出列表。
 * `keys` 按优先级依次尝试，例如 `['memories', 'results']`。
 */
export function pickListPayload(response: unknown, keys: readonly string[]): unknown[] {
  if (Array.isArray(response)) return response
  const record = asRecord(response)
  if (!record) return []
  for (const key of keys) {
    const candidate = record[key]
    if (Array.isArray(candidate)) return candidate
  }
  return []
}

// ===== 错误解析 =====

interface NowledgeErrorPayload {
  detail: string
  requestId?: string
}

export type NowledgeRequestErrorCode = 'remote_embedding_auth_failed' | 'local_auth_failed' | 'request_failed'

export class NowledgeRequestError extends Error {
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

export function createNowledgeRequestError(status: number, responseText: string): Error {
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

// ===== 领域响应解析 =====

export function parseHealthVersion(response: unknown): string | undefined {
  const record = asRecord(response)
  return normalizeText(record?.version) ?? normalizeText(record?.server_version)
}

/** working memory 响应：`{ working_memory }` / `{ workingMemory }` / 裸对象三种形态 */
export function parseWorkingMemoryPayload(response: unknown): { content?: string; updatedAt: number } {
  const record = asRecord(response)
  const payload = asRecord(record?.working_memory) ?? asRecord(record?.workingMemory) ?? record
  return {
    content: typeof payload?.content === 'string' ? payload.content : undefined,
    updatedAt: toTimestamp(payload?.updated_at ?? payload?.updatedAt),
  }
}

export function parseThreadSearchResults(response: unknown): MemoryThreadSearchResult[] {
  return asArray(asRecord(response)?.threads)
    .map((raw): MemoryThreadSearchResult | null => {
      const item = asRecord(raw)
      const threadId = normalizeText(item?.thread_id) ?? normalizeText(item?.id)
      if (!item || !threadId) return null
      return {
        threadId,
        title: normalizeText(item.title) ?? '(untitled thread)',
        source: normalizeText(item.source),
        messageCount: toFiniteNumber(item.message_count) ?? 0,
        lastActivity: normalizeText(item.last_activity),
        relevanceScore: toFiniteNumber(item.relevance_score) ?? 0,
        matchedMessages: asArray(item.matched_messages).slice(0, 3).map((rawMessage) => {
          const message = asRecord(rawMessage)
          return {
            role: normalizeText(message?.role) ?? 'unknown',
            snippet: normalizeText(message?.snippet) ?? '',
          }
        }),
      }
    })
    .filter((item): item is MemoryThreadSearchResult => item !== null)
}

/** 线程消息时间戳原样透传，Nowledge 可能给 ISO 字符串或毫秒数 */
function toThreadTimestamp(value: unknown): string | number | null {
  return typeof value === 'string' || typeof value === 'number' ? value : null
}

export function parseThreadFetchResult(response: unknown, fallbackThreadId: string): MemoryThreadFetchResult {
  const record = asRecord(response)
  return {
    threadId: normalizeText(record?.thread_id) ?? normalizeText(record?.id) ?? fallbackThreadId,
    title: normalizeText(record?.title) ?? '(untitled)',
    source: normalizeText(record?.source),
    messageCount: toFiniteNumber(record?.message_count) ?? toFiniteNumber(record?.total_messages) ?? 0,
    messages: asArray(record?.messages).map((raw) => {
      const message = asRecord(raw)
      return {
        role: normalizeText(message?.role) ?? 'unknown',
        content: typeof message?.content === 'string' ? message.content : '',
        timestamp: toThreadTimestamp(message?.timestamp ?? message?.created_at),
      }
    }),
  }
}

export function parseTimelineEvents(response: unknown): MemoryTimelineEvent[] {
  return pickListPayload(response, ['events']).map((raw): MemoryTimelineEvent => {
    const item = asRecord(raw)
    return {
      id: normalizeText(item?.id),
      eventType: normalizeText(item?.event_type) ?? normalizeText(item?.type) ?? 'unknown',
      createdAt: normalizeText(item?.created_at) ?? normalizeText(item?.timestamp) ?? new Date().toISOString(),
      title: normalizeText(item?.title),
      description: normalizeText(item?.description) ?? normalizeText(item?.summary) ?? normalizeText(item?.detail),
      memoryId: normalizeText(item?.memory_id),
      relatedMemoryIds: toIdArray(item?.related_memory_ids),
    }
  })
}

export function parseConnectionItems(response: unknown, memoryId: string): MemoryConnectionItem[] {
  const record = asRecord(response)
  const nodeMap = new Map<string, Record<string, unknown>>()
  for (const raw of asArray(record?.neighbors)) {
    const node = asRecord(raw)
    const id = normalizeText(node?.id)
    if (node && id) nodeMap.set(id, node)
  }

  return asArray(record?.edges).flatMap((raw): MemoryConnectionItem[] => {
    const edge = asRecord(raw)
    if (!edge) return []
    const source = normalizeText(edge.source) ?? ''
    const target = normalizeText(edge.target) ?? ''
    const neighborId = source === memoryId ? target : source
    const node = nodeMap.get(neighborId)
    if (!node) return []
    return [{
      nodeId: neighborId,
      nodeType: normalizeText(node.node_type) ?? normalizeText(node.type) ?? 'unknown',
      title: normalizeText(node.title) ?? normalizeText(node.name) ?? normalizeText(node.label) ?? neighborId,
      snippet: normalizeText(node.content) ?? normalizeText(node.snippet),
      edgeType: normalizeText(edge.edge_type) ?? normalizeText(edge.type) ?? 'RELATED',
      relation: normalizeText(asRecord(edge.metadata)?.relation_type) ?? normalizeText(edge.content_relation),
      weight: toFiniteNumber(edge.weight) ?? toFiniteNumber(edge.relevance_score),
    }]
  })
}
