import { describe, expect, test } from 'bun:test'
import type { AgentEvent } from '@kila/shared'
import { applyAgentEvent, buildAssistantTurnTimelineEntries } from './agent-stream-utils'

function lateThinkingEndEvents(): AgentEvent[] {
  return [
    { type: 'turn_start' },
    { type: 'thinking_start', contentIndex: 0, timestamp: 1000 },
    { type: 'thinking_delta', contentIndex: 0, text: '先分析', timestamp: 1100 },
    { type: 'thinking_delta', contentIndex: 0, text: '问题。', timestamp: 1200 },
    { type: 'text_delta', text: '这是' },
    { type: 'text_delta', text: '回复。' },
    {
      type: 'thinking_end',
      contentIndex: 0,
      text: '先分析问题。',
      timestamp: 2000,
    },
    { type: 'text_complete', text: '这是回复。', isIntermediate: false },
    { type: 'turn_end', toolResultCount: 0 },
  ]
}

describe('assistant turn 时间线', () => {
  test('Given Pi 在正文后发送 thinking_end When 构建时间线 Then 思考只在正文前出现一次', () => {
    const entries = buildAssistantTurnTimelineEntries(lateThinkingEndEvents(), '这是回复。')

    expect(entries).toHaveLength(2)
    expect(entries[0]?.kind).toBe('process')
    expect(entries[1]).toEqual({
      kind: 'assistantText',
      id: 'assistant-text-1',
      text: '这是回复。',
    })

    const processEntry = entries[0]
    if (processEntry?.kind !== 'process') throw new Error('首个时间线条目应为过程块')
    expect(processEntry.entries).toHaveLength(1)
    expect(processEntry.entries[0]).toMatchObject({
      kind: 'thinking',
      fullText: '先分析问题。',
      done: true,
      elapsedSeconds: 1,
    })
  })

  test('Given thinking_end 正常位于正文前 When 构建时间线 Then 保持原有思考与正文顺序', () => {
    const events = lateThinkingEndEvents()
    const thinkingEnd = events.splice(6, 1)[0]!
    events.splice(4, 0, thinkingEnd)

    const entries = buildAssistantTurnTimelineEntries(events, '这是回复。')

    expect(entries.map((entry) => entry.kind)).toEqual(['process', 'assistantText'])
    const processEntry = entries[0]
    if (processEntry?.kind !== 'process') throw new Error('首个时间线条目应为过程块')
    expect(processEntry.entries).toHaveLength(1)
    expect(processEntry.entries[0]).toMatchObject({
      kind: 'thinking',
      fullText: '先分析问题。',
      done: true,
    })
  })

  test('Given 两个 turn 复用 contentIndex When 第二个 thinking_end 延迟 Then 不与前一轮思考合并', () => {
    const firstTurn: AgentEvent[] = [
      { type: 'turn_start' },
      { type: 'thinking_start', contentIndex: 0 },
      { type: 'thinking_delta', contentIndex: 0, text: '第一轮' },
      { type: 'thinking_end', contentIndex: 0, text: '第一轮' },
      { type: 'text_delta', text: '第一段' },
      { type: 'turn_end', toolResultCount: 0 },
    ]
    const secondTurn = lateThinkingEndEvents()

    const entries = buildAssistantTurnTimelineEntries([...firstTurn, ...secondTurn])

    expect(entries.map((entry) => entry.kind)).toEqual([
      'process',
      'assistantText',
      'process',
      'assistantText',
    ])
    const thinkingTexts = entries.flatMap((entry) => (
      entry.kind === 'process'
        ? entry.entries.filter((item) => item.kind === 'thinking').map((item) => item.fullText)
        : []
    ))
    expect(thinkingTexts).toEqual(['第一轮', '先分析问题。'])
  })

  test('Given thinking_end 晚于 turn_end When 构建时间线 Then 不在正文后重复创建思考块', () => {
    const events: AgentEvent[] = [
      { type: 'turn_start' },
      { type: 'thinking_start', contentIndex: 0, timestamp: 1000, turnId: 'pi-turn-1' },
      { type: 'thinking_delta', contentIndex: 0, text: '先分析', timestamp: 1100, turnId: 'pi-turn-1' },
      { type: 'text_delta', text: '回答。', turnId: 'pi-turn-1' },
      { type: 'turn_end', toolResultCount: 0, turnId: 'pi-turn-1' },
      { type: 'thinking_end', contentIndex: 0, text: '先分析', timestamp: 2000 },
      { type: 'text_complete', text: '回答。', isIntermediate: false },
    ]

    const entries = buildAssistantTurnTimelineEntries(events, '回答。')

    expect(entries.map((entry) => entry.kind)).toEqual(['process', 'assistantText'])
    const thinkingTexts = entries.flatMap((entry) => (
      entry.kind === 'process'
        ? entry.entries.filter((item) => item.kind === 'thinking').map((item) => item.fullText)
        : []
    ))
    expect(thinkingTexts).toEqual(['先分析'])
  })
})

describe('Agent 流式重试与终态', () => {
  const initialState = {
    running: true,
    content: '旧答案',
    toolActivities: [{
      toolUseId: 'old-tool',
      toolName: '旧工具',
      input: {},
      done: true,
      result: '旧结果',
    }],
    processEvents: [
      { type: 'thinking_delta', contentIndex: 0, text: '旧思考' },
    ] as AgentEvent[],
    memoryTrace: {
      enabled: true,
      recalledMemoryCount: 0,
      relatedThreadCount: 0,
      notebookCount: 0,
      usedGlobalWorkingMemory: false,
      usedProjectWorkingMemory: false,
      incognito: false,
      recallStatus: 'success' as const,
    },
    isCompacting: true,
    retrying: {
      currentAttempt: 1,
      maxAttempts: 3,
      history: [],
      failed: false,
    },
  }

  test('Given 新 retry attempt When 应用 retrying Then 清空旧正文/思考/工具但保留 retry history', () => {
    const withHistory = applyAgentEvent(initialState, {
      type: 'retry_attempt',
      attemptData: {
        attempt: 1,
        timestamp: 100,
        reason: 'network',
        errorMessage: 'network',
        delaySeconds: 1,
      },
    })
    const next = applyAgentEvent(withHistory, {
      type: 'retrying',
      attempt: 2,
      maxAttempts: 3,
      delaySeconds: 1,
      reason: 'network',
    })

    expect(next.content).toBe('')
    expect(next.processEvents).toEqual([])
    expect(next.toolActivities).toEqual([])
    expect(next.toolActivityIndex).toBeUndefined()
    expect(next.memoryTrace).toBeUndefined()
    expect(next.retrying?.history).toHaveLength(1)
    expect(next.running).toBe(true)
  })

  test('Given 空的最终 text_complete When 应用 Then 不清空已有正文', () => {
    const next = applyAgentEvent({
      ...initialState,
      isCompacting: false,
      retrying: undefined,
    }, { type: 'text_complete', text: '', isIntermediate: false })

    expect(next.content).toBe('旧答案')
  })

  test('Given complete/普通 error When 应用 Then 清除 compacting 和未失败 retry UI 状态', () => {
    const complete = applyAgentEvent(initialState, { type: 'complete', stopReason: 'stop' })
    const error = applyAgentEvent(initialState, { type: 'error', message: '失败' })

    expect(complete.isCompacting).toBe(false)
    expect(complete.retrying).toBeUndefined()
    expect(error.isCompacting).toBe(false)
    expect(error.retrying).toBeUndefined()
  })

  test('Given Pi retry_failed 后紧接 typed_error When 应用 Then 保留失败历史且不重复最终 attempt', () => {
    const withAttempt = applyAgentEvent(initialState, {
      type: 'retry_attempt',
      attemptData: {
        attempt: 1,
        timestamp: 100,
        reason: 'provider overloaded',
        errorMessage: 'provider overloaded',
        delaySeconds: 1,
      },
    })
    const failed = applyAgentEvent(withAttempt, {
      type: 'retry_failed',
      finalAttempt: {
        attempt: 1,
        timestamp: 200,
        reason: 'retry budget exhausted',
        errorMessage: 'retry budget exhausted',
        delaySeconds: 0,
      },
    })
    const terminal = applyAgentEvent(failed, {
      type: 'typed_error',
      error: {
        code: 'provider_error',
        title: '服务繁忙',
        message: 'retry budget exhausted',
        canRetry: true,
        actions: [],
      },
    })

    expect(terminal.retrying?.failed).toBe(true)
    expect(terminal.retrying?.history).toHaveLength(1)
    expect(terminal.retrying?.history[0]).toMatchObject({
      attempt: 1,
      reason: 'retry budget exhausted',
    })
    expect(terminal.running).toBe(false)
    expect(terminal.isCompacting).toBe(false)
  })
})
