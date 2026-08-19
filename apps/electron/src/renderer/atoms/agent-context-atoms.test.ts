import { describe, expect, test } from 'bun:test'
import { deriveSessionCacheHitRate } from './agent-context-atoms'
import type { AgentEventUsage } from '@kila/shared'

function usage(cacheRead: number, cacheCreation: number): AgentEventUsage {
  return {
    inputTokens: cacheRead + cacheCreation + 1000,
    outputTokens: 200,
    cacheReadTokens: cacheRead,
    cacheCreationTokens: cacheCreation,
    costUsd: 0.01,
  }
}

describe('deriveSessionCacheHitRate 会话平均缓存命中率', () => {
  test('Given 有 cache 读写 When 计算 Then 返回 cacheRead 占已写缓存的比例', () => {
    expect(deriveSessionCacheHitRate(usage(950, 50))).toBeCloseTo(0.95)
  })

  test('Given provider 未上报 cache（两项为 0）When 计算 Then 返回 undefined 而非 0', () => {
    expect(deriveSessionCacheHitRate(usage(0, 0))).toBeUndefined()
  })

  test('Given 尚无累计 usage When 计算 Then 返回 undefined', () => {
    expect(deriveSessionCacheHitRate(undefined)).toBeUndefined()
  })
})
