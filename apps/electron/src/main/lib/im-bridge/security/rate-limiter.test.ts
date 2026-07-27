import { describe, expect, test } from 'bun:test'
import { BridgeRateLimiter } from './rate-limiter'

describe('BridgeRateLimiter 限流窗口', () => {
  test('Given 窗口内超过阈值 When 继续请求 Then 拒绝', () => {
    let now = 0
    const limiter = new BridgeRateLimiter({ limit: 2, windowMs: 1_000, now: () => now })

    expect(limiter.allow('a')).toBe(true)
    expect(limiter.allow('a')).toBe(true)
    expect(limiter.allow('a')).toBe(false)
  })

  test('Given 窗口滑过 When 再次请求 Then 放行', () => {
    let now = 0
    const limiter = new BridgeRateLimiter({ limit: 1, windowMs: 1_000, now: () => now })

    expect(limiter.allow('a')).toBe(true)
    now = 2_000
    expect(limiter.allow('a')).toBe(true)
  })
})

describe('BridgeRateLimiter 惰性 GC', () => {
  test('Given 大量一次性 endpoint When 超过 GC 间隔 Then 过期记录被清理，Map 不再只增不删', () => {
    let now = 0
    const limiter = new BridgeRateLimiter({
      limit: 6,
      windowMs: 30_000,
      gcIntervalMs: 60_000,
      now: () => now,
    })

    for (let index = 0; index < 500; index += 1) {
      limiter.allow(`endpoint-${index}`)
    }
    expect(limiter.trackedKeyCount).toBe(500)

    // 越过窗口与 GC 间隔后，下一次调用触发清理
    now = 200_000
    limiter.allow('endpoint-fresh')

    expect(limiter.trackedKeyCount).toBe(1)
  })

  test('Given 仍在窗口内的记录 When 触发 GC Then 不会被误删', () => {
    let now = 0
    const limiter = new BridgeRateLimiter({
      limit: 6,
      windowMs: 30_000,
      gcIntervalMs: 10_000,
      now: () => now,
    })

    limiter.allow('keep-me')
    now = 20_000
    limiter.allow('other')

    expect(limiter.trackedKeyCount).toBe(2)
  })
})
