import { describe, expect, test } from 'bun:test'
import {
  BridgeHttpError,
  classifyPollFailure,
  computePollBackoffDelayMs,
  sleepWithSignal,
} from './poll-backoff'

describe('classifyPollFailure 错误分级', () => {
  test('Given 401 Unauthorized When 分级 Then 判定为不可重试', () => {
    expect(classifyPollFailure(new BridgeHttpError('Telegram 轮询失败 (401)', 401)).retryable).toBe(false)
  })

  test('Given 403 Forbidden When 分级 Then 判定为不可重试', () => {
    expect(classifyPollFailure(new BridgeHttpError('forbidden', 403)).retryable).toBe(false)
  })

  test('Given 429 限流 When 分级 Then 判定为可重试（交给指数退避）', () => {
    expect(classifyPollFailure(new BridgeHttpError('too many requests', 429)).retryable).toBe(true)
  })

  test('Given 502 网关错误 When 分级 Then 判定为可重试', () => {
    expect(classifyPollFailure(new BridgeHttpError('bad gateway', 502)).retryable).toBe(true)
  })

  test('Given 普通网络异常 When 分级 Then 判定为可重试', () => {
    expect(classifyPollFailure(new Error('fetch failed')).retryable).toBe(true)
  })

  test('Given 只带状态码文本的 Error When 分级 Then 仍能识别出 401', () => {
    const classification = classifyPollFailure(new Error('Telegram 轮询失败 (401: Unauthorized)'))

    expect(classification.retryable).toBe(false)
    expect(classification.status).toBe(401)
  })
})

describe('computePollBackoffDelayMs 指数退避', () => {
  test('Given 连续失败 When 计算退避 Then 从 1s 起按 2 的幂增长', () => {
    const noJitter = () => 0.5

    expect(computePollBackoffDelayMs(1, { random: noJitter })).toBe(1_000)
    expect(computePollBackoffDelayMs(2, { random: noJitter })).toBe(2_000)
    expect(computePollBackoffDelayMs(3, { random: noJitter })).toBe(4_000)
    expect(computePollBackoffDelayMs(4, { random: noJitter })).toBe(8_000)
  })

  test('Given 失败次数很多 When 计算退避 Then 封顶 60s', () => {
    expect(computePollBackoffDelayMs(20, { random: () => 0.5 })).toBe(60_000)
  })

  test('Given 抖动取极值 When 计算退避 Then 结果仍落在 [base, max] 区间', () => {
    expect(computePollBackoffDelayMs(5, { random: () => 0 })).toBeGreaterThanOrEqual(1_000)
    expect(computePollBackoffDelayMs(5, { random: () => 0.999 })).toBeLessThanOrEqual(60_000)
  })

  test('Given 退避不再是固定 1.5s When 对比旧实现 Then 第 3 次失败已明显拉长', () => {
    expect(computePollBackoffDelayMs(3, { random: () => 0.5 })).toBeGreaterThan(1_500)
  })
})

describe('sleepWithSignal', () => {
  test('Given signal 已中止 When 调用 Then 立即返回不再等待', async () => {
    const controller = new AbortController()
    controller.abort()

    const startedAt = Date.now()
    await sleepWithSignal(5_000, controller.signal)

    expect(Date.now() - startedAt).toBeLessThan(200)
  })

  test('Given 等待过程中被中止 When 调用 Then 提前唤醒', async () => {
    const controller = new AbortController()
    const startedAt = Date.now()
    setTimeout(() => controller.abort(), 20)

    await sleepWithSignal(5_000, controller.signal)

    expect(Date.now() - startedAt).toBeLessThan(500)
  })
})
