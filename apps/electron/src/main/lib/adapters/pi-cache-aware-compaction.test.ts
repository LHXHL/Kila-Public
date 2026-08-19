import { describe, expect, test } from 'bun:test'
import type { Context, Message } from '@earendil-works/pi-ai'
import { serializeConversation } from '@earendil-works/pi-coding-agent'
import { projectCacheAwareCompactionContext } from './pi-cache-aware-compaction'

function user(text: string, timestamp: number): Message {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp,
  }
}

function standaloneSummaryContext(messages: Message[], instruction = 'Summarize only.'): Context {
  return {
    systemPrompt: 'Pi standalone summarizer (must be replaced)',
    messages: [user(
      `<conversation>\n${serializeConversation(messages)}\n</conversation>\n\n${instruction}`,
      99,
    )],
  }
}

describe('cache-aware Pi compaction projection', () => {
  test('replays system, tools and all messages through the selected region before appending only the instruction', () => {
    const checkpoint = user('prior compacted checkpoint', 1)
    const selected = user('new history selected by Pi', 2)
    const retained = user('recent suffix retained by Pi', 3)
    const lastRoutedContext: Context = {
      systemPrompt: 'stable Kila system prompt',
      messages: [checkpoint, selected, retained],
      tools: [{
        name: 'stable_tool',
        description: 'stable schema',
        parameters: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
        } as never,
      }],
    }

    // Pi's second compaction only serializes the newly selected entry.  Kila
    // must still replay the prior checkpoint first because it was the first
    // message in the actual warm provider request.
    const projected = projectCacheAwareCompactionContext(
      standaloneSummaryContext([selected], 'Produce the checkpoint.'),
      lastRoutedContext,
    )

    expect(projected?.systemPrompt).toBe(lastRoutedContext.systemPrompt)
    expect(projected?.tools).toBe(lastRoutedContext.tools)
    expect(projected?.messages.slice(0, -1)).toEqual([checkpoint, selected])
    expect(projected?.messages.at(-1)).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: expect.stringContaining('Produce the checkpoint.') }],
    })
    expect(JSON.stringify(projected)).not.toContain('<conversation>')
    expect(projected?.messages).not.toContain(retained)
  })

  test('fails closed when Pi serialized content cannot be matched to the last routed request', () => {
    const projected = projectCacheAwareCompactionContext(
      standaloneSummaryContext([user('not present', 10)]),
      {
        systemPrompt: 'stable',
        messages: [user('actual request', 1)],
      },
    )
    expect(projected).toBeUndefined()
  })

  test('does not mistake an ordinary one-message prompt for a summarization request', () => {
    const projected = projectCacheAwareCompactionContext(
      { messages: [user('ordinary prompt', 2)] },
      { messages: [user('ordinary prompt', 2)] },
    )
    expect(projected).toBeUndefined()
  })
})
