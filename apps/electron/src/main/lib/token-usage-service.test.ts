import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getTokenUsageStats,
  recordTokenUsage,
} from './token-usage-service'

describe('token usage service', () => {
  test('增量缓存能读取同进程中新追加的 usage 记录', () => {
    const originalConfigDir = process.env.KILA_CONFIG_DIR
    const dir = mkdtempSync(join(tmpdir(), 'kila-token-usage-test-'))
    process.env.KILA_CONFIG_DIR = dir

    try {
      const now = new Date('2026-05-30T12:00:00.000Z')
      recordTokenUsage({
        sessionId: 'session-a',
        channelId: 'channel-a',
        provider: 'openai',
        modelId: 'gpt-4o',
        recordedAt: now.getTime(),
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 150,
        costUsd: 0.001,
      })

      const first = getTokenUsageStats(7, now)
      expect(first.totals.requestCount).toBe(1)
      expect(first.totals.totalTokens).toBe(150)

      recordTokenUsage({
        sessionId: 'session-a',
        channelId: 'channel-a',
        provider: 'openai',
        modelId: 'gpt-4o',
        recordedAt: now.getTime() - 1000,
        inputTokens: 200,
        outputTokens: 75,
        cacheReadTokens: 25,
        cacheCreationTokens: 0,
        totalTokens: 300,
        costUsd: 0.002,
      })

      const second = getTokenUsageStats(7, now)
      expect(second.totals.requestCount).toBe(2)
      expect(second.totals.totalTokens).toBe(450)
      expect(second.models[0]?.modelId).toBe('gpt-4o')
      expect(second.models[0]?.requestCount).toBe(2)
      expect(second.totals.cacheCoverageRate).toBeCloseTo(25 / 325)
      expect(existsSync(join(dir, 'token-usage-2026-05.jsonl'))).toBe(true)
    } finally {
      if (originalConfigDir === undefined) {
        delete process.env.KILA_CONFIG_DIR
      } else {
        process.env.KILA_CONFIG_DIR = originalConfigDir
      }
      rmSync(dir, { recursive: true, force: true })
    }
  })
  test('完全重复记录去重，但同秒不同毫秒的真实请求都会统计', () => {
    const originalConfigDir = process.env.KILA_CONFIG_DIR
    const dir = mkdtempSync(join(tmpdir(), 'kila-token-usage-dedupe-test-'))
    process.env.KILA_CONFIG_DIR = dir

    try {
      const now = new Date('2026-05-30T12:00:01.000Z')
      const baseRecord = {
        sessionId: 'session-dedupe',
        channelId: 'channel-a',
        provider: 'openai',
        modelId: 'gpt-4o',
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 150,
        costUsd: 0.001,
      }

      recordTokenUsage({ ...baseRecord, recordedAt: now.getTime() - 900 })
      recordTokenUsage({ ...baseRecord, recordedAt: now.getTime() - 900 })
      recordTokenUsage({ ...baseRecord, recordedAt: now.getTime() - 100 })

      const stats = getTokenUsageStats(7, now)
      expect(stats.totals.requestCount).toBe(2)
      expect(stats.totals.totalTokens).toBe(300)
    } finally {
      if (originalConfigDir === undefined) {
        delete process.env.KILA_CONFIG_DIR
      } else {
        process.env.KILA_CONFIG_DIR = originalConfigDir
      }
      rmSync(dir, { recursive: true, force: true })
    }
  })

})
