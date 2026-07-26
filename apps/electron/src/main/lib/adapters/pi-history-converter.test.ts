import { describe, expect, it } from 'bun:test'
import type { Api, AssistantMessage, Model, ToolCall, ToolResultMessage } from '@earendil-works/pi-ai'
import type { AgentMessage } from '@kila/shared'
import { convertHistoryToPiMessages } from './pi-history-converter'

// 最小 Pi Model 桩：converter 只读取 api / provider / id。
const MODEL = { api: 'anthropic-messages' as Api, provider: 'anthropic', id: 'claude-test' } as unknown as Model<Api>

function assistantWithTool(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: 'a1',
    role: 'assistant',
    content: '我来查一下文件。',
    createdAt: 1,
    events: [
      { type: 'tool_start', toolName: 'ReadFile', toolUseId: 'tool-1', input: { path: '/a.txt' } },
      { type: 'tool_result', toolUseId: 'tool-1', toolName: 'ReadFile', result: '文件内容', isError: false },
    ],
    ...overrides,
  }
}

describe('convertHistoryToPiMessages —— 首次迁移 toolUse↔toolResult 配对', () => {
  it('为含工具结果的 assistant 消息重建配对的 toolCall 块', async () => {
    const messages: AgentMessage[] = [
      { id: 'u1', role: 'user', content: '读一下 a.txt', createdAt: 0 },
      assistantWithTool(),
    ]

    const result = await convertHistoryToPiMessages(messages, MODEL)

    const assistant = result.find((m): m is AssistantMessage => m.role === 'assistant')
    expect(assistant).toBeDefined()
    const toolCalls = assistant!.content.filter((c): c is ToolCall => c.type === 'toolCall')
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]).toMatchObject({ id: 'tool-1', name: 'ReadFile', arguments: { path: '/a.txt' } })
    // 有工具调用的历史轮次必须标记为 toolUse。
    expect(assistant!.stopReason).toBe('toolUse')
  })

  it('每个 toolResult 都有前置的 toolCall（无孤儿 toolResult）', async () => {
    const result = await convertHistoryToPiMessages([assistantWithTool()], MODEL)

    const emittedToolCallIds = new Set<string>()
    for (const message of result) {
      if (message.role === 'assistant') {
        for (const block of message.content) {
          if (block.type === 'toolCall') emittedToolCallIds.add(block.id)
        }
      }
      if (message.role === 'toolResult') {
        const toolResult = message as ToolResultMessage
        // 断言：出现 toolResult 时，其 toolCallId 必须已被前面的 assistant toolCall 声明。
        expect(emittedToolCallIds.has(toolResult.toolCallId)).toBe(true)
      }
    }
  })

  it('文本为空但有工具调用时，仍产出带 toolCall 的 assistant 消息', async () => {
    const result = await convertHistoryToPiMessages(
      [assistantWithTool({ content: '   ' })],
      MODEL,
    )

    const assistant = result.find((m): m is AssistantMessage => m.role === 'assistant')
    expect(assistant).toBeDefined()
    expect(assistant!.content.some((c) => c.type === 'toolCall')).toBe(true)
    // 空文本不应产生空 text 块。
    expect(assistant!.content.some((c) => c.type === 'text')).toBe(false)
  })

  it('纯文本 assistant 消息保持 stop 且无 toolCall', async () => {
    const result = await convertHistoryToPiMessages(
      [{ id: 'a2', role: 'assistant', content: '你好', createdAt: 2 }],
      MODEL,
    )

    const assistant = result.find((m): m is AssistantMessage => m.role === 'assistant')
    expect(assistant).toBeDefined()
    expect(assistant!.stopReason).toBe('stop')
    expect(assistant!.content.every((c) => c.type === 'text')).toBe(true)
  })
})
