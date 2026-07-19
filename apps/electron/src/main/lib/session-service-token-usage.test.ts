import { describe, expect, test } from 'bun:test'
import type { SessionMessage } from '@kila/shared'
import { findLatestCompleteUsage } from './session-service'

function assistantMessage(
  id: string,
  createdAt: number,
  inputTokens: number
): SessionMessage {
  return {
    id,
    role: 'assistant',
    content: '',
    createdAt,
    model: 'test-model',
    events: [{ type: 'complete', usage: { inputTokens } }],
  }
}

describe('Session Token Usage 当前轮归属', () => {
  test('当前轮没有 usage 时不会回退记录上一轮 complete', () => {
    const previous = assistantMessage('assistant-old', 1_000, 100)
    const messages: SessionMessage[] = [
      previous,
      {
        id: 'status-current',
        role: 'status',
        content: 'Nothing to compact',
        createdAt: 2_000,
      },
    ]

    expect(
      findLatestCompleteUsage(messages, new Set([previous.id]))
    ).toBeNull()
  })

  test('只返回 runtime 后新增 assistant 的 complete usage', () => {
    const previous = assistantMessage('assistant-old', 1_000, 100)
    const current = assistantMessage('assistant-current', 2_000, 250)

    const result = findLatestCompleteUsage(
      [previous, current],
      new Set([previous.id])
    )

    expect(result?.message.id).toBe('assistant-current')
    expect(result?.usage.inputTokens).toBe(250)
  })
})
