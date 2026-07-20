import { describe, expect, test } from 'bun:test'
import type { AgentEvent, AgentMessage } from '@kila/shared'
import { buildSessionToolCallActivities } from './ToolCallsPanel'

describe('工具调用侧栏聚合性能', () => {
  test('Given 大量思考与正文事件 When 聚合工具调用 Then 只生成工具记录', () => {
    const events: AgentEvent[] = Array.from({ length: 2_000 }, (_, index) => ({
      type: 'thinking_delta' as const,
      contentIndex: 0,
      text: `思考 ${index}`,
    }))
    events.push(
      { type: 'tool_start', toolUseId: 'tool-1', toolName: 'read', input: { path: '/tmp/a' }, timestamp: 1_000 },
      { type: 'tool_result', toolUseId: 'tool-1', toolName: 'read', result: 'ok', isError: false, timestamp: 2_000 },
    )

    const messages: AgentMessage[] = [{
      id: 'message-1',
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      events,
    }]

    expect(buildSessionToolCallActivities(messages)).toEqual([
      expect.objectContaining({
        toolUseId: 'tool-1',
        result: 'ok',
        done: true,
        elapsedSeconds: 1,
      }),
    ])
  })

  test('Given 超长流式工具输出 When 尚未结束 Then 侧栏仅保留受限临时结果', () => {
    const events: AgentEvent[] = [
      { type: 'tool_start', toolUseId: 'tool-1', toolName: 'shell', input: {} },
      { type: 'tool_update', toolUseId: 'tool-1', partialText: 'x'.repeat(60_000) },
    ]

    const activities = buildSessionToolCallActivities([], events)

    expect(activities[0]?.partialResult?.length).toBe(48_000)
    expect(activities[0]?.done).toBe(false)
  })
})
