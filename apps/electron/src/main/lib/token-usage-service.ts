import { existsSync, openSync, readFileSync, closeSync, readSync, statSync } from 'node:fs'
import type {
  RecordTokenUsageInput,
  TokenUsageDailyStat,
  TokenUsageModelStat,
  TokenUsageProviderStat,
  TokenUsageSessionStat,
  TokenUsageRecord,
  TokenUsageStats,
  TokenUsageTotals,
} from '@kila/shared'
import { getTokenUsageMonthPath, getTokenUsagePath } from './config-paths'
import { getChannelById } from './channel-manager'
import { estimateTokenUsageCostUsd } from './model-pricing'
import { appendTextDurably } from './safe-json-file'
import { getSessionMessages, getSessionMeta } from './session-manager'

const DAY_MS = 24 * 60 * 60 * 1000
const MIN_DAYS = 1
const MAX_DAYS = 365

interface TokenUsageCache {
  path: string
  lastReadOffset: number
  lastModifiedMs: number
  records: TokenUsageRecord[]
}

const tokenUsageCaches = new Map<string, TokenUsageCache>()

function toNonNegativeNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return value > 0 ? value : 0
}

function normalizeDays(days: number): number {
  const value = Number.isFinite(days) ? Math.floor(days) : MIN_DAYS
  if (value < MIN_DAYS) return MIN_DAYS
  if (value > MAX_DAYS) return MAX_DAYS
  return value
}

function toDateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function toMonthKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 7)
}

function getUtcDayStartMs(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function createEmptyTotals(): TokenUsageTotals {
  return {
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  }
}

function getTokenUsagePathCached(): string {
  return getTokenUsagePath()
}

function getTokenUsageWritePath(recordedAt: number): string {
  return getTokenUsageMonthPath(toMonthKey(recordedAt))
}

function mergeIntoTotals(totals: TokenUsageTotals, record: TokenUsageRecord): void {
  totals.requestCount += 1
  totals.inputTokens += record.inputTokens
  totals.outputTokens += record.outputTokens
  totals.cacheReadTokens += record.cacheReadTokens
  totals.cacheCreationTokens += record.cacheCreationTokens
  totals.totalTokens += record.totalTokens
  totals.costUsd += record.costUsd
  const cacheTotal = totals.cacheReadTokens + totals.cacheCreationTokens
  totals.cacheHitRate = cacheTotal > 0 ? totals.cacheReadTokens / cacheTotal : 0
}

function normalizeTokenUsageRecord(input: TokenUsageRecord): TokenUsageRecord {
  const inputTokens = toNonNegativeNumber(input.inputTokens)
  const outputTokens = toNonNegativeNumber(input.outputTokens)
  const cacheReadTokens = toNonNegativeNumber(input.cacheReadTokens)
  const cacheCreationTokens = toNonNegativeNumber(input.cacheCreationTokens)
  const totalTokens = toNonNegativeNumber(input.totalTokens)
    || inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens

  return {
    sessionId: input.sessionId,
    channelId: input.channelId?.trim() || undefined,
    provider: input.provider?.trim() || undefined,
    modelId: input.modelId?.trim() || 'unknown',
    recordedAt: Number.isFinite(input.recordedAt) ? input.recordedAt : Date.now(),
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens,
    costUsd: toNonNegativeNumber(input.costUsd),
  }
}

function estimateRecordCostUsd(record: TokenUsageRecord, channelBaseUrl?: string): number {
  if (record.costUsd > 0) return record.costUsd
  const channel = record.channelId ? getChannelById(record.channelId) : undefined
  return estimateTokenUsageCostUsd({
    channelProvider: record.provider ?? channel?.provider,
    channelBaseUrl: channelBaseUrl ?? channel?.baseUrl,
    modelId: record.modelId,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cacheReadTokens: record.cacheReadTokens,
    cacheCreationTokens: record.cacheCreationTokens,
  })
}

function withEstimatedCost(record: TokenUsageRecord): TokenUsageRecord {
  const costUsd = estimateRecordCostUsd(record)
  if (costUsd <= 0 || costUsd === record.costUsd) return record
  return { ...record, costUsd }
}

function createUsageDedupeKey(record: TokenUsageRecord): string {
  return [
    record.sessionId,
    record.channelId ?? '',
    record.provider ?? '',
    record.modelId,
    record.recordedAt,
    record.inputTokens,
    record.outputTokens,
    record.cacheReadTokens,
    record.cacheCreationTokens,
    record.totalTokens,
  ].join('|')
}

function resolveUsageGroup(record: TokenUsageRecord): {
  key: string
  label: string
  providerType?: string
  channelId?: string
  channelName?: string
} {
  const channel = record.channelId ? getChannelById(record.channelId) : undefined
  const channelName = channel?.name.trim() || undefined
  const providerType = channel?.provider ?? record.provider
  const key = channel?.id
    ?? record.provider?.trim()
    ?? record.channelId?.trim()
    ?? 'unknown'
  const label = channelName
    ?? record.provider?.trim()
    ?? record.channelId?.trim()
    ?? 'Unknown'

  return {
    key,
    label,
    providerType,
    channelId: channel?.id ?? record.channelId,
    channelName,
  }
}

function parseRecord(rawLine: string): TokenUsageRecord | null {
  const line = rawLine.trim()
  if (!line) return null

  try {
    const parsed = JSON.parse(line) as Partial<TokenUsageRecord>
    if (typeof parsed.sessionId !== 'string' || !parsed.sessionId.trim()) {
      return null
    }
    if (typeof parsed.recordedAt !== 'number' || !Number.isFinite(parsed.recordedAt)) {
      return null
    }

    return normalizeTokenUsageRecord({
      sessionId: parsed.sessionId,
      channelId: typeof parsed.channelId === 'string' ? parsed.channelId : undefined,
      provider: typeof parsed.provider === 'string' ? parsed.provider : undefined,
      modelId: typeof parsed.modelId === 'string' ? parsed.modelId : 'unknown',
      recordedAt: parsed.recordedAt,
      inputTokens: toNonNegativeNumber(parsed.inputTokens),
      outputTokens: toNonNegativeNumber(parsed.outputTokens),
      cacheReadTokens: toNonNegativeNumber(parsed.cacheReadTokens),
      cacheCreationTokens: toNonNegativeNumber(parsed.cacheCreationTokens),
      totalTokens: toNonNegativeNumber(parsed.totalTokens),
      costUsd: toNonNegativeNumber(parsed.costUsd),
    })
  } catch {
    return null
  }
}

export function recordTokenUsage(record: TokenUsageRecord): TokenUsageRecord {
  const normalized = normalizeTokenUsageRecord(record)
  const path = getTokenUsageWritePath(normalized.recordedAt)
  appendTextDurably(path, `${JSON.stringify(normalized)}\n`)
  const cache = tokenUsageCaches.get(path)
  if (cache) {
    cache.records.push(normalized)
    try {
      const stat = statSync(path)
      cache.lastModifiedMs = stat.mtimeMs
      cache.lastReadOffset = stat.size
    } catch {
      tokenUsageCaches.delete(path)
    }
  }
  return normalized
}

export function recordTokenUsageFromCompleteEvent(input: RecordTokenUsageInput): TokenUsageRecord {
  const usage = {
    inputTokens: toNonNegativeNumber(input.usage.inputTokens),
    outputTokens: toNonNegativeNumber(input.usage.outputTokens),
    cacheReadTokens: toNonNegativeNumber(input.usage.cacheReadTokens),
    cacheCreationTokens: toNonNegativeNumber(input.usage.cacheCreationTokens),
  }
  const modelId = input.modelId?.trim() || 'unknown'
  const rawCostUsd = toNonNegativeNumber(input.usage.costUsd)
  const estimatedCostUsd = rawCostUsd > 0
    ? rawCostUsd
    : estimateTokenUsageCostUsd({
      channelProvider: input.provider,
      channelBaseUrl: input.channelBaseUrl,
      modelId,
      ...usage,
    })

  return recordTokenUsage({
    sessionId: input.sessionId,
    channelId: input.channelId,
    provider: input.provider,
    modelId,
    recordedAt: input.recordedAt ?? Date.now(),
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    totalTokens:
      usage.inputTokens
      + usage.outputTokens
      + usage.cacheReadTokens
      + usage.cacheCreationTokens,
    costUsd: estimatedCostUsd,
  })
}

export function getTokenUsageStats(daysInput: number, nowDate = new Date()): TokenUsageStats {
  const days = normalizeDays(daysInput)
  const nowMs = nowDate.getTime()
  const todayStartMs = getUtcDayStartMs(nowDate)
  const startMs = todayStartMs - (days - 1) * DAY_MS
  const fromDate = toDateKey(startMs)
  const toDate = toDateKey(nowMs)

  const dailyMap = new Map<string, TokenUsageDailyStat>()
  for (let index = 0; index < days; index += 1) {
    const date = toDateKey(startMs + index * DAY_MS)
    dailyMap.set(date, { date, ...createEmptyTotals() })
  }

  const providerMap = new Map<string, TokenUsageProviderStat>()
  const modelMap = new Map<string, TokenUsageModelStat>()
  const sessionMap = new Map<string, TokenUsageSessionStat>()
  const seenRecordKeys = new Set<string>()
  const totals = createEmptyTotals()

  for (const parsedRecord of readTokenUsageRecordsCached(startMs, nowMs)) {
    if (parsedRecord.recordedAt < startMs || parsedRecord.recordedAt > nowMs) continue
    const dedupeKey = createUsageDedupeKey(parsedRecord)
    if (seenRecordKeys.has(dedupeKey)) continue
    seenRecordKeys.add(dedupeKey)
    const record = withEstimatedCost(parsedRecord)

    const dateKey = toDateKey(record.recordedAt)
    const dailyStat = dailyMap.get(dateKey)
    if (!dailyStat) continue

    mergeIntoTotals(dailyStat, record)
    mergeIntoTotals(totals, record)

    const sessionStat = sessionMap.get(record.sessionId) ?? {
      sessionId: record.sessionId,
      title: getSessionMeta(record.sessionId)?.title,
      ...createEmptyTotals(),
    }
    mergeIntoTotals(sessionStat, record)
    sessionMap.set(record.sessionId, sessionStat)

    const group = resolveUsageGroup(record)
    const providerKey = group.key
    const providerStat = providerMap.get(providerKey) ?? {
      provider: providerKey,
      providerLabel: group.label,
      providerType: group.providerType,
      channelId: group.channelId,
      channelName: group.channelName,
      ...createEmptyTotals(),
    }
    mergeIntoTotals(providerStat, record)
    providerMap.set(providerKey, providerStat)

    const modelKey = `${providerKey}::${record.modelId || 'unknown'}`
    const modelStat = modelMap.get(modelKey) ?? {
      provider: providerKey,
      providerLabel: group.label,
      providerType: group.providerType,
      channelId: group.channelId,
      channelName: group.channelName,
      modelId: record.modelId || 'unknown',
      ...createEmptyTotals(),
    }
    mergeIntoTotals(modelStat, record)
    modelMap.set(modelKey, modelStat)
  }

  const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date))
  const providers = Array.from(providerMap.values()).sort((a, b) => {
    if (b.totalTokens !== a.totalTokens) return b.totalTokens - a.totalTokens
    return a.provider.localeCompare(b.provider)
  })
  const models = Array.from(modelMap.values()).sort((a, b) => {
    if (b.totalTokens !== a.totalTokens) return b.totalTokens - a.totalTokens
    return `${a.provider}:${a.modelId}`.localeCompare(`${b.provider}:${b.modelId}`)
  })
  const sessions = Array.from(sessionMap.values()).sort((a, b) => {
    if (b.totalTokens !== a.totalTokens) return b.totalTokens - a.totalTokens
    return (a.title ?? a.sessionId).localeCompare(b.title ?? b.sessionId)
  }).slice(0, 100)
  const compaction = getCompactionStats(sessions.map((session) => session.sessionId), startMs, nowMs)

  return {
    days,
    fromDate,
    toDate,
    totals,
    daily,
    providers,
    models,
    sessions,
    compaction,
  }
}

function readNewTokenUsageChunk(path: string, startOffset: number, endOffset: number): string {
  const length = endOffset - startOffset
  if (length <= 0) return ''

  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    readSync(fd, buffer, 0, length, startOffset)
    return buffer.toString('utf-8')
  } finally {
    closeSync(fd)
  }
}

function parseTokenUsageLines(content: string): TokenUsageRecord[] {
  const records: TokenUsageRecord[] = []
  for (const line of content.split('\n')) {
    const parsed = parseRecord(line)
    if (parsed) records.push(parsed)
  }
  return records
}

function readTokenUsageFileCached(path: string): TokenUsageRecord[] {
  if (!existsSync(path)) {
    tokenUsageCaches.set(path, {
      path,
      lastReadOffset: 0,
      lastModifiedMs: 0,
      records: [],
    })
    return []
  }

  const stat = statSync(path)
  const cache = tokenUsageCaches.get(path)

  if (!cache || cache.path !== path || stat.size < cache.lastReadOffset) {
    const content = readFileSync(path, 'utf-8')
    const records = parseTokenUsageLines(content)
    tokenUsageCaches.set(path, {
      path,
      lastReadOffset: stat.size,
      lastModifiedMs: stat.mtimeMs,
      records,
    })
    return records
  }

  if (stat.mtimeMs === cache.lastModifiedMs && stat.size === cache.lastReadOffset) {
    return cache.records
  }

  const content = readNewTokenUsageChunk(path, cache.lastReadOffset, stat.size)
  const newRecords = parseTokenUsageLines(content)
  cache.records.push(...newRecords)
  cache.lastReadOffset = stat.size
  cache.lastModifiedMs = stat.mtimeMs
  return cache.records
}

function monthKeysBetween(startMs: number, endMs: number): string[] {
  const keys: string[] = []
  const cursor = new Date(startMs)
  cursor.setUTCDate(1)
  cursor.setUTCHours(0, 0, 0, 0)
  const end = new Date(endMs)
  end.setUTCDate(1)
  end.setUTCHours(0, 0, 0, 0)

  while (cursor.getTime() <= end.getTime()) {
    keys.push(toMonthKey(cursor.getTime()))
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }

  return keys
}

function readTokenUsageRecordsCached(startMs: number, endMs: number): TokenUsageRecord[] {
  const paths = [
    getTokenUsagePathCached(),
    ...monthKeysBetween(startMs, endMs).map(getTokenUsageMonthPath),
  ]
  const records: TokenUsageRecord[] = []
  const seenPaths = new Set<string>()

  for (const path of paths) {
    if (seenPaths.has(path)) continue
    seenPaths.add(path)
    records.push(...readTokenUsageFileCached(path))
  }

  return records
}

function getCompactionStats(sessionIds: string[], startMs: number, nowMs: number): TokenUsageStats['compaction'] {
  const seenSessionIds = new Set(sessionIds)
  let count = 0
  let tokensBefore = 0
  let summaryChars = 0
  let lastCompactedAt: number | undefined

  for (const sessionId of seenSessionIds) {
    for (const message of getSessionMessages(sessionId)) {
      if (message.createdAt < startMs || message.createdAt > nowMs) continue
      for (const event of message.events ?? []) {
        if (event.type !== 'compact_complete') continue
        count += 1
        if (typeof event.tokensBefore === 'number') tokensBefore += event.tokensBefore
        if (event.summaryText) summaryChars += event.summaryText.length
        lastCompactedAt = Math.max(lastCompactedAt ?? 0, message.createdAt)
      }
    }
  }

  return { count, tokensBefore, summaryChars, lastCompactedAt }
}
