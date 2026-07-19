import type { AgentEventUsage } from './agent'

export interface TokenUsageRecord {
  sessionId: string
  channelId?: string
  provider?: string
  modelId: string
  recordedAt: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
  costUsd: number
}

export interface RecordTokenUsageInput {
  sessionId: string
  channelId?: string
  channelBaseUrl?: string
  provider?: string
  modelId?: string
  usage: AgentEventUsage
  recordedAt?: number
}

export interface TokenUsageTotals {
  requestCount: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
  costUsd: number
  cacheHitRate?: number
}

export interface TokenUsageDailyStat extends TokenUsageTotals {
  date: string
}

export interface TokenUsageModelStat extends TokenUsageTotals {
  provider: string
  providerLabel?: string
  providerType?: string
  channelId?: string
  channelName?: string
  modelId: string
}

export interface TokenUsageProviderStat extends TokenUsageTotals {
  provider: string
  providerLabel?: string
  providerType?: string
  channelId?: string
  channelName?: string
}

export interface TokenUsageSessionStat extends TokenUsageTotals {
  sessionId: string
  title?: string
}

export interface TokenUsageCompactionStat {
  count: number
  tokensBefore: number
  summaryChars: number
  lastCompactedAt?: number
}

export interface TokenUsageStats {
  days: number
  fromDate: string
  toDate: string
  totals: TokenUsageTotals
  daily: TokenUsageDailyStat[]
  providers: TokenUsageProviderStat[]
  models: TokenUsageModelStat[]
  sessions: TokenUsageSessionStat[]
  compaction: TokenUsageCompactionStat
}

export const TOKEN_USAGE_IPC_CHANNELS = {
  GET_STATS: 'token-usage:get-stats',
} as const
