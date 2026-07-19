import { describe, expect, test } from 'bun:test'
import type { SessionMessage } from '../types'
import { buildSessionTurnReplayPlan, createOptimisticReplayUserMessage } from './session-turn-replay'

function createMessage(overrides: Partial<SessionMessage>): SessionMessage {
  return {
    id: overrides.id ?? 'message-1',
    role: overrides.role ?? 'user',
    content: overrides.content ?? 'message',
    createdAt: overrides.createdAt ?? 1,
    ...overrides,
  }
}

describe('buildSessionTurnReplayPlan', () => {
  test('keeps only the prefix before the target turn and exposes a UI optimistic replay shape', () => {
    const messages: SessionMessage[] = [
      createMessage({ id: 'u1', role: 'user', content: 'first question' }),
      createMessage({ id: 'a1', role: 'assistant', content: 'first answer' }),
      createMessage({ id: 'u2', role: 'user', content: 'second question' }),
      createMessage({ id: 'tool-1', role: 'tool', content: 'tool output' }),
      createMessage({ id: 'a2', role: 'assistant', content: 'second answer' }),
      createMessage({ id: 'u3', role: 'user', content: 'third question' }),
      createMessage({ id: 'a3', role: 'assistant', content: 'third answer' }),
    ]

    const plan = buildSessionTurnReplayPlan(messages, 'a2')

    expect(plan).not.toBeNull()
    expect(plan?.prefixBeforeTurn.map((message) => message.id)).toEqual(['u1', 'a1'])
    expect(plan?.optimisticMessages.map((message) => message.id)).toEqual(['u1', 'a1', 'u2'])
    expect(plan?.replayUserMessage.id).toBe('u2')
    expect(plan?.replacedMessages.map((message) => message.id)).toEqual(['u2', 'tool-1', 'a2', 'u3', 'a3'])
  })


  test('replays directly from the target user message when anchored on a user row', () => {
    const messages: SessionMessage[] = [
      createMessage({ id: 'u1', role: 'user', content: 'first question' }),
      createMessage({ id: 'a1', role: 'assistant', content: 'first answer' }),
      createMessage({ id: 'u2', role: 'user', content: 'second question' }),
      createMessage({ id: 'a2', role: 'assistant', content: 'second answer' }),
    ]

    const plan = buildSessionTurnReplayPlan(messages, 'u2')

    expect(plan?.prefixBeforeTurn.map((message) => message.id)).toEqual(['u1', 'a1'])
    expect(plan?.replayUserMessage.id).toBe('u2')
    expect(plan?.targetMessage.id).toBe('u2')
  })

  test('replays from the nearest preceding user when anchored on a failed status row', () => {
    const messages: SessionMessage[] = [
      createMessage({ id: 'u1', role: 'user', content: 'first question' }),
      createMessage({ id: 'status-1', role: 'status', content: 'first failure' }),
    ]

    const plan = buildSessionTurnReplayPlan(messages, 'status-1')

    expect(plan?.prefixBeforeTurn).toEqual([])
    expect(plan?.replayUserMessage.id).toBe('u1')
    expect(plan?.targetMessage.id).toBe('status-1')
  })

  test('creates a fresh optimistic replay user message instead of reusing the historical row', () => {
    const replayUser = createMessage({
      id: 'u2',
      role: 'user',
      content: 'second question',
      createdAt: 100,
    })

    const optimistic = createOptimisticReplayUserMessage(replayUser, {
      now: () => 200,
      idPrefix: 'replay-temp',
    })

    expect(optimistic).toEqual({
      ...replayUser,
      id: 'replay-temp-200-u2',
      createdAt: 200,
    })
    expect(optimistic).not.toBe(replayUser)
  })

  test('returns null when assistant message is missing or has no preceding user turn', () => {
    const orphanAssistant = createMessage({ id: 'a1', role: 'assistant', content: 'lonely answer' })

    expect(buildSessionTurnReplayPlan([orphanAssistant], 'a1')).toBeNull()
    expect(buildSessionTurnReplayPlan([orphanAssistant], 'missing')).toBeNull()
  })
})
