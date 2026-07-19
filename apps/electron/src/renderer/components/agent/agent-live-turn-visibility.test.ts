import { describe, expect, test } from 'bun:test'
import { shouldShowLiveAssistantTurn } from './agent-live-turn-visibility'

const baseInput = {
  streaming: false,
  hydratingMessages: false,
  hasVisibleStreamingContent: false,
  hasTimelineEntries: false,
  retrying: false,
  messages: [],
} as const

describe('流式 assistant 与持久化消息交接', () => {
  test('Given 回复仍在流式输出 When 已有思考事件 Then 展示实时 assistant turn', () => {
    expect(shouldShowLiveAssistantTurn({
      ...baseInput,
      streaming: true,
      hasTimelineEntries: true,
    })).toBe(true)
  })

  test('Given 回复完成且消息仍在水合 When 保留思考事件 Then 暂时保留实时 assistant turn', () => {
    expect(shouldShowLiveAssistantTurn({
      ...baseInput,
      hydratingMessages: true,
      hasTimelineEntries: true,
      messages: [{ role: 'user' }],
    })).toBe(true)
  })

  test('Given 持久化 assistant 已加载 When 残留相同思考事件 Then 不再渲染实时 assistant turn', () => {
    expect(shouldShowLiveAssistantTurn({
      ...baseInput,
      hydratingMessages: true,
      hasVisibleStreamingContent: true,
      hasTimelineEntries: true,
      messages: [{ role: 'user' }, { role: 'assistant' }],
    })).toBe(false)
  })

  test('Given 回复完成但持久化 assistant 尚未出现 When 仍有实时内容 Then 保留内容避免闪空', () => {
    expect(shouldShowLiveAssistantTurn({
      ...baseInput,
      hasVisibleStreamingContent: true,
      messages: [{ role: 'user' }],
    })).toBe(true)
  })

  test('Given 错误状态尚未持久化 assistant When 有重试提示 Then 继续展示实时 assistant turn', () => {
    expect(shouldShowLiveAssistantTurn({
      ...baseInput,
      retrying: true,
      messages: [{ role: 'user' }, { role: 'status' }],
    })).toBe(true)
  })
})
