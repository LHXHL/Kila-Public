import { describe, expect, test } from 'bun:test'
import {
  CODEX_GPT_54_55_CONTEXT_WINDOW,
  CODEX_GPT_54_MINI_CONTEXT_WINDOW,
  CODEX_GPT_56_CONTEXT_WINDOW,
  DEFAULT_CONTEXT_WINDOW,
  ONE_MILLION_CONTEXT_WINDOW,
  inferCodexAlignedGPT5ContextWindow,
  inferContextWindow,
  supports1MContext,
} from './context-window'

describe('inferContextWindow 模型上下文窗口推断', () => {
  test('Given 已确认 1M 能力的模型 When 推断窗口 Then 返回 1M', () => {
    expect(inferContextWindow('claude-sonnet-4-6')).toBe(ONE_MILLION_CONTEXT_WINDOW)
    expect(inferContextWindow('claude-opus-4-8')).toBe(ONE_MILLION_CONTEXT_WINDOW)
    expect(inferContextWindow('claude-fable-5')).toBe(ONE_MILLION_CONTEXT_WINDOW)
    expect(inferContextWindow('deepseek-v4-flash')).toBe(ONE_MILLION_CONTEXT_WINDOW)
    expect(inferContextWindow('glm-5.2')).toBe(ONE_MILLION_CONTEXT_WINDOW)
    expect(inferContextWindow('mimo-v2.5')).toBe(ONE_MILLION_CONTEXT_WINDOW)
    expect(inferContextWindow('minimax-m3')).toBe(ONE_MILLION_CONTEXT_WINDOW)
    expect(inferContextWindow('kimi-k3')).toBe(ONE_MILLION_CONTEXT_WINDOW)
    expect(inferContextWindow('qwen3.6-plus')).toBe(ONE_MILLION_CONTEXT_WINDOW)
  })

  test('Given k3 是精确匹配 When 推断 k3 系列 Then 只有同名模型命中 1M', () => {
    expect(supports1MContext('k3')).toBe(true)
    expect(supports1MContext('kimi-k3')).toBe(true)
    expect(supports1MContext('k3.2')).toBe(false)
    expect(supports1MContext('k3-thinking')).toBe(false)
  })

  test('Given exclude 命中 haiku When 推断 Then 始终回默认窗口而非 1M', () => {
    expect(inferContextWindow('claude-haiku-4-5')).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(inferContextWindow('claude-sonnet-4-6-haiku')).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(supports1MContext('claude-haiku-4-5')).toBe(false)
  })

  test('Given Codex 对齐 GPT-5.x When 推断 Then 返回已验证窗口', () => {
    expect(inferContextWindow('gpt-5.4')).toBe(CODEX_GPT_54_55_CONTEXT_WINDOW)
    expect(inferContextWindow('gpt-5.5')).toBe(CODEX_GPT_54_55_CONTEXT_WINDOW)
    expect(inferContextWindow('gpt-5.4-mini')).toBe(CODEX_GPT_54_MINI_CONTEXT_WINDOW)
    expect(inferContextWindow('gpt-5.6-sol')).toBe(CODEX_GPT_56_CONTEXT_WINDOW)
    expect(inferContextWindow('gpt-5.6-terra')).toBe(CODEX_GPT_56_CONTEXT_WINDOW)
    expect(inferCodexAlignedGPT5ContextWindow('gpt-5.7')).toBeUndefined()
  })

  test('Given [1m] 后缀 When 推断 Then 剥离后缀后匹配 Codex 规则', () => {
    expect(inferContextWindow('gpt-5.5[1m]')).toBe(CODEX_GPT_54_55_CONTEXT_WINDOW)
  })

  test('Given 无法识别的模型 When 推断 Then 回默认 200K 窗口', () => {
    expect(inferContextWindow('deepseek-chat')).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(inferContextWindow('gpt-4o')).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(inferContextWindow('local-8k-model')).toBe(DEFAULT_CONTEXT_WINDOW)
  })

  test('Given 空模型 ID When 推断 Then 返回 undefined 而非默认值', () => {
    expect(inferContextWindow(undefined)).toBeUndefined()
    expect(inferContextWindow('')).toBeUndefined()
  })
})
