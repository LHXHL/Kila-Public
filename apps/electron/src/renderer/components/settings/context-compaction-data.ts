import type {
  AgentEvent,
  SessionMessage,
  SessionMessagesPageInput,
  SessionMessagesPageResult,
  SessionMeta,
} from '@kila/shared'

type CompactCompleteEvent = Extract<AgentEvent, { type: 'compact_complete' }>

export interface CompactionRecord {
  id: string
  sessionId: string
  sessionTitle: string
  messageId: string
  createdAt: number
  reason: CompactCompleteEvent['reason']
  summaryText?: string
  firstKeptEntryId?: string
  tokensBefore?: number
  /** 压缩后的估算上下文 token，用于展示"省了多少"。 */
  estimatedTokensAfter?: number
  /** 生成摘要那次 LLM 调用消耗的 token 合计。 */
  summaryTokens?: number
  willRetry?: boolean
}


export interface CompactionSessionFailure {
  sessionId: string
  sessionTitle: string
  error: string
}

export interface CompactionRecordsLoadResult {
  records: CompactionRecord[]
  failures: CompactionSessionFailure[]
}

export interface CompactionSummary {
  count: number
  overflowCount: number
  retryCount: number
  tokensBefore: number
  summaryChars: number
  /** 压缩自身消耗的 token 合计（生成摘要的 LLM 调用）。 */
  summaryTokens: number
  lastCompactedAt?: number
}

export interface CompactionRecordsApi {
  listSessions: () => Promise<SessionMeta[]>
  getSessionMessagesPage: (input: SessionMessagesPageInput) => Promise<SessionMessagesPageResult>
}

export interface LoadCompactionRecordsOptions {
  /** 同时扫描的 Session 数。限制 IPC 与 JSONL 解析峰值。 */
  concurrency?: number
  /** 单次 IPC 返回的消息数。每页处理后即可释放消息数组。 */
  pageSize?: number
}

const DEFAULT_CONCURRENCY = 4
const DEFAULT_PAGE_SIZE = 200

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(1, Math.floor(value as number))
}

export function collectCompactionRecords(
  session: SessionMeta,
  messages: SessionMessage[],
  recordOffset = 0,
): CompactionRecord[] {
  const records: CompactionRecord[] = []
  for (const message of messages) {
    for (const event of message.events ?? []) {
      if (event.type !== 'compact_complete') continue
      records.push({
        id: `${session.id}:${message.id}:${recordOffset + records.length}`,
        sessionId: session.id,
        sessionTitle: session.title,
        messageId: message.id,
        createdAt: message.createdAt,
        reason: event.reason,
        summaryText: event.summaryText,
        firstKeptEntryId: event.firstKeptEntryId,
        tokensBefore: event.tokensBefore,
        estimatedTokensAfter: event.estimatedTokensAfter,
        summaryTokens: sumEventUsageTokens(event),
        willRetry: event.willRetry,
      })
    }
  }
  return records
}

/** 压缩摘要那次模型调用的 token 合计，与主进程状态卡的口径一致。 */
function sumEventUsageTokens(event: CompactCompleteEvent): number | undefined {
  const usage = event.usage
  if (!usage) return undefined
  const total = (usage.inputTokens || 0)
    + (usage.outputTokens || 0)
    + (usage.cacheReadTokens || 0)
    + (usage.cacheCreationTokens || 0)
  return total > 0 ? total : undefined
}

async function loadSessionCompactionRecords(
  api: CompactionRecordsApi,
  session: SessionMeta,
  pageSize: number,
): Promise<CompactionRecord[]> {
  const records: CompactionRecord[] = []
  let offset = 0

  while (true) {
    const page = await api.getSessionMessagesPage({
      sessionId: session.id,
      offset,
      limit: pageSize,
    })
    records.push(...collectCompactionRecords(session, page.messages, records.length))

    if (!page.hasMore) break
    if (page.messages.length === 0) {
      throw new Error(`Session ${session.id} 的消息分页未推进`)
    }

    // 使用服务端归一化后的 offset，避免调用方输入和实际分页边界不一致。
    offset = page.offset + page.messages.length
  }

  return records
}

/**
 * 以固定并发和分页方式扫描压缩记录。
 *
 * 旧实现会对所有 Session 同时调用 getSessionMessages()，几百个历史会话会造成
 * Renderer/Main IPC 洪峰，并让所有完整 transcript 同时驻留内存。
 */
export async function loadCompactionRecords(
  api: CompactionRecordsApi,
  options: LoadCompactionRecordsOptions = {},
): Promise<CompactionRecordsLoadResult> {
  const sessions = await api.listSessions()
  if (sessions.length === 0) return { records: [], failures: [] }

  const concurrency = Math.min(
    sessions.length,
    normalizePositiveInteger(options.concurrency, DEFAULT_CONCURRENCY),
  )
  const pageSize = normalizePositiveInteger(options.pageSize, DEFAULT_PAGE_SIZE)
  const collected: CompactionRecord[][] = Array.from({ length: sessions.length }, () => [])
  const failures: CompactionSessionFailure[] = []
  let nextIndex = 0

  const worker = async (): Promise<void> => {
    while (nextIndex < sessions.length) {
      const index = nextIndex
      nextIndex += 1
      const session = sessions[index]
      if (!session) return
      try {
        collected[index] = await loadSessionCompactionRecords(api, session, pageSize)
      } catch (error) {
        failures.push({
          sessionId: session.id,
          sessionTitle: session.title,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  return {
    records: collected.flat().sort((a, b) => b.createdAt - a.createdAt),
    failures,
  }
}

export function summarizeCompactionRecords(records: CompactionRecord[]): CompactionSummary {
  return records.reduce<CompactionSummary>((acc, record) => {
    acc.count += 1
    if (record.reason === 'overflow') acc.overflowCount += 1
    if (record.willRetry) acc.retryCount += 1
    acc.tokensBefore += record.tokensBefore ?? 0
    acc.summaryChars += record.summaryText?.length ?? 0
    acc.summaryTokens += record.summaryTokens ?? 0
    acc.lastCompactedAt = Math.max(acc.lastCompactedAt ?? 0, record.createdAt)
    return acc
  }, {
    count: 0,
    overflowCount: 0,
    retryCount: 0,
    tokensBefore: 0,
    summaryChars: 0,
    summaryTokens: 0,
  })
}
