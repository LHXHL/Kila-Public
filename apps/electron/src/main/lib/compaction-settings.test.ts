/**
 * compaction-settings 纯函数测试
 *
 * 覆盖各档上下文窗口下的压缩参数推导、CJK 低估补偿、
 * 手动 /compact 解析、noop 判定与 Pi usage 映射。
 */

import { describe, expect, it } from 'bun:test'
import {
  cjkKeepRecentScale,
  deriveCompactionSettings,
  estimateCjkRatio,
  FALLBACK_CONTEXT_WINDOW_TOKENS,
  getCompactionNoopMessage,
  mapPiUsageToAgentEventUsage,
  MIN_AUTO_COMPACTION_WINDOW_TOKENS,
  parseManualCompactCommand,
  resolveEffectiveContextWindow,
  toPiCompactionSettings,
} from './compaction-settings'

describe('deriveCompactionSettings', () => {
  it('Given 200K 大窗口 When 推导 Then 沿用默认档 reserve=16384 keepRecent=20000', () => {
    const derived = deriveCompactionSettings({ contextWindowTokens: 200_000 })
    expect(derived.enabled).toBe(true)
    expect(derived.reserveTokens).toBe(16384)
    expect(derived.keepRecentTokens).toBe(20000)
    expect(derived.disabledReason).toBeUndefined()
  })

  it('Given 窗口低于自动压缩下限 When 推导 Then 关闭自动压缩并标记原因', () => {
    const derived = deriveCompactionSettings({ contextWindowTokens: MIN_AUTO_COMPACTION_WINDOW_TOKENS - 1 })
    expect(derived.enabled).toBe(false)
    expect(derived.disabledReason).toBe('window-too-small')
    // 关闭也要给出合法预算，手动 /compact 仍可用
    expect(derived.reserveTokens).toBeGreaterThan(0)
    expect(derived.keepRecentTokens).toBeGreaterThan(0)
  })

  it('Given 8K 边界窗口 When 推导 Then 保持开启且预算显著小于窗口', () => {
    const derived = deriveCompactionSettings({ contextWindowTokens: 8192 })
    expect(derived.enabled).toBe(true)
    expect(derived.reserveTokens + derived.keepRecentTokens).toBeLessThan(8192)
  })

  it('Given 非法窗口（0/负数/NaN）When 推导 Then 退回保守窗口并关闭自动压缩', () => {
    for (const bad of [0, -1, Number.NaN]) {
      const derived = deriveCompactionSettings({ contextWindowTokens: bad })
      expect(derived.enabled).toBe(false)
      expect(derived.disabledReason).toBe('invalid-window')
      expect(derived.contextWindowTokens).toBe(FALLBACK_CONTEXT_WINDOW_TOKENS)
    }
  })

  it('Given 任意窗口 When 推导 Then 硬不变量 reserve+keepRecent 不超过窗口 60%', () => {
    for (const window of [8192, 16_384, 32_768, 131_072, 1_000_000]) {
      const derived = deriveCompactionSettings({ contextWindowTokens: window })
      expect(derived.reserveTokens + derived.keepRecentTokens).toBeLessThanOrEqual(
        Math.floor(window * 0.6) + 2, // 允许 shrink 取整误差
      )
    }
  })

  it('Given 纯中文会话 When 推导 Then keepRecent 按 CJK 补偿系数下调', () => {
    const latin = deriveCompactionSettings({ contextWindowTokens: 200_000, cjkRatio: 0 })
    const cjk = deriveCompactionSettings({ contextWindowTokens: 200_000, cjkRatio: 1 })
    expect(cjk.keepRecentTokens).toBeLessThan(latin.keepRecentTokens)
    expect(cjk.cjkKeepRecentScale).toBe(0.3) // 纯中文命中补偿下限
    expect(cjk.reserveTokens).toBe(latin.reserveTokens) // reserve 不受语言影响
  })
})

describe('cjkKeepRecentScale', () => {
  it('Given 无样本或非法占比 When 计算 Then 不缩放', () => {
    expect(cjkKeepRecentScale(undefined)).toBe(1)
    expect(cjkKeepRecentScale(0)).toBe(1)
    expect(cjkKeepRecentScale(Number.NaN)).toBe(1)
  })

  it('Given 占比超界 When 计算 Then 先归一化再缩放', () => {
    expect(cjkKeepRecentScale(2)).toBe(0.3)
    expect(cjkKeepRecentScale(0.5)).toBeCloseTo(1 / 2.5, 5)
  })
})

describe('estimateCjkRatio', () => {
  it('Given 中英文混合样本 When 估算 Then 占比只统计非空白字符', () => {
    const ratio = estimateCjkRatio(['你好 world'])
    // 非空白 7 个字符中 2 个 CJK
    expect(ratio).toBeCloseTo(2 / 7, 5)
  })

  it('Given 空样本 When 估算 Then 返回 0', () => {
    expect(estimateCjkRatio([undefined, '', '   '])).toBe(0)
  })

  it('Given 全角标点 When 估算 Then 不计入 CJK（避免高估）', () => {
    expect(estimateCjkRatio(['，。！'])).toBe(0)
  })
})

describe('toPiCompactionSettings', () => {
  it('Given 推导结果 When 转换 Then 剥掉诊断字段只留 Pi 三要素', () => {
    const derived = deriveCompactionSettings({ contextWindowTokens: 200_000 })
    expect(toPiCompactionSettings(derived)).toEqual({
      enabled: true,
      reserveTokens: 16384,
      keepRecentTokens: 20000,
    })
  })
})

describe('parseManualCompactCommand', () => {
  it('Given /compact 命令 When 解析 Then 提取自定义说明', () => {
    expect(parseManualCompactCommand('/compact')).toBe('')
    expect(parseManualCompactCommand('/compact 保留最近的决策')).toBe('保留最近的决策')
    expect(parseManualCompactCommand('  /COMPACT  多空格  ')).toBe('多空格')
  })

  it('Given 普通消息 When 解析 Then 返回 null', () => {
    expect(parseManualCompactCommand('帮我压缩一下')).toBeNull()
    expect(parseManualCompactCommand(undefined)).toBeNull()
    expect(parseManualCompactCommand('/compactx 不是命令')).toBeNull()
  })
})

describe('getCompactionNoopMessage', () => {
  it('Given Pi 良性 reject When 判定 Then 还原为 noop 文案', () => {
    expect(getCompactionNoopMessage(new Error('Nothing to compact'))).toContain('无需压缩')
    expect(getCompactionNoopMessage('already compacted')).toContain('无需重复压缩')
  })

  it('Given 真实错误 When 判定 Then 返回 null', () => {
    expect(getCompactionNoopMessage(new Error('rate limit exceeded'))).toBeNull()
    expect(getCompactionNoopMessage(undefined)).toBeNull()
  })
})

describe('mapPiUsageToAgentEventUsage', () => {
  it('Given Pi 摘要 usage When 映射 Then 聚合 cache token 且不污染上下文校准', () => {
    const mapped = mapPiUsageToAgentEventUsage(
      { input: 1000, output: 200, cacheRead: 300, cacheWrite: 100, cost: { total: 0.05 } } as never,
      200_000,
    )
    expect(mapped).toEqual({
      inputTokens: 1400,
      outputTokens: 200,
      cacheReadTokens: 300,
      cacheCreationTokens: 100,
      costUsd: 0.05,
      contextWindow: 200_000,
    })
    expect(mapped).not.toHaveProperty('contextInputTokens')
  })

  it('Given 无 usage When 映射 Then 返回 undefined', () => {
    expect(mapPiUsageToAgentEventUsage(undefined)).toBeUndefined()
  })
})

describe('resolveEffectiveContextWindow', () => {
  it('Given 合法窗口（含推断来源的 200K）When 解析 Then 原样返回且标记 known', () => {
    const resolved = resolveEffectiveContextWindow({
      contextWindowTokens: 200_000,
    })
    expect(resolved).toEqual({ contextWindowTokens: 200_000, source: 'known' })
  })

  it('Given 非法窗口（undefined/0/负数）When 解析 Then 守卫兜底并标记 fallback', () => {
    for (const bad of [undefined, 0, -100]) {
      const resolved = resolveEffectiveContextWindow({ contextWindowTokens: bad })
      expect(resolved).toEqual({ contextWindowTokens: FALLBACK_CONTEXT_WINDOW_TOKENS, source: 'fallback' })
    }
  })
})
