import { describe, expect, test } from 'bun:test'
import { RuntimeResourceBudget, normalizeRuntimeResourceBudgetOptions } from './runtime-resource-budget'

const MIB = 1024 * 1024

describe('Runtime resource budget', () => {
  test('Given 默认配置 When normalize Then 使用方案中的采样与 RSS 预算', () => {
    expect(normalizeRuntimeResourceBudgetOptions()).toEqual({
      sampleIntervalMs: 10_000,
      softLimitBytes: 512 * MIB,
      hardLimitBytes: 1024 * MIB,
    })
  })

  test('Given running Runtime 连续超过 soft limit When 采样三次 Then 只发告警动作', () => {
    const budget = new RuntimeResourceBudget()
    budget.register('session-1', 'running')

    expect(budget.sample('session-1', 513 * MIB).actions).toEqual([])
    expect(budget.sample('session-1', 513 * MIB).actions).toEqual([])
    expect(budget.sample('session-1', 513 * MIB).actions).toEqual(['warn'])
  })

  test('Given hot-idle 或 hard limit When 超过预算 Then 分别立即回收或连续两次 kill', () => {
    const budget = new RuntimeResourceBudget()
    budget.register('idle', 'hot-idle')
    expect(budget.sample('idle', 513 * MIB).actions).toEqual(['dispose-hot-idle'])

    budget.register('running', 'running')
    expect(budget.sample('running', 1025 * MIB).actions).toEqual([])
    expect(budget.sample('running', 1025 * MIB).actions).toEqual(['abort-and-kill'])
  })
})
