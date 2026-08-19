import { describe, expect, test } from 'bun:test'
import type { AssistantMessageEventStream, Context, Message, SimpleStreamOptions } from '@earendil-works/pi-ai'
import { serializeConversation } from '@earendil-works/pi-coding-agent'
import {
  createCacheAwareCompactionStreamFn,
  projectCacheAwareCompactionContext,
  type PromptCacheRetention,
} from './pi-cache-aware-compaction'

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
      serializeConversation,
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
      serializeConversation,
    )
    expect(projected).toBeUndefined()
  })

  test('does not mistake an ordinary one-message prompt for a summarization request', () => {
    const projected = projectCacheAwareCompactionContext(
      { messages: [user('ordinary prompt', 2)] },
      { messages: [user('ordinary prompt', 2)] },
      serializeConversation,
    )
    expect(projected).toBeUndefined()
  })
})

interface RecordedCall {
  context: Context
  cacheRetention?: unknown
  sessionId?: unknown
}

/** 记录型 streamFn 桩：返回立即完成的空流（测试不消费事件内容，仅满足 StreamFn 形状）。 */
function recordingStreamFn(calls: RecordedCall[]) {
  return (_model: unknown, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream => {
    calls.push({ context, cacheRetention: options?.cacheRetention, sessionId: options?.sessionId })
    return (async function* () {})() as unknown as AssistantMessageEventStream
  }
}

describe('cache-aware stream wrapper 缓存参数覆写时机', () => {
  const retention: PromptCacheRetention = 'short'

  test('投影成功时覆写 cacheRetention 与 sessionId 为稳定值', async () => {
    const calls: RecordedCall[] = []
    const warm: Context = { systemPrompt: 'stable', messages: [user('warm prefix', 1)] }
    const wrapper = createCacheAwareCompactionStreamFn({
      streamFn: recordingStreamFn(calls),
      sessionId: 'kila-session',
      cacheRetention: retention,
      serializeConversation,
      initialContext: warm,
    })

    await wrapper({} as never, standaloneSummaryContext([user('warm prefix', 1)]), { cacheRetention: 'none', sessionId: 'random-opaque' })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.cacheRetention).toBe('short')
    expect(calls[0]?.sessionId).toBe('kila-session')
    // 投影后的请求重放 warm 前缀并追加摘要指令，不再是 standalone 单消息
    expect(calls[0]?.context.messages.length).toBeGreaterThan(1)
  })

  test('投影失败时原样放行 Pi 的 cacheRetention=none 请求', async () => {
    const calls: RecordedCall[] = []
    const warm: Context = { systemPrompt: 'stable', messages: [user('actual warm prefix', 1)] }
    const wrapper = createCacheAwareCompactionStreamFn({
      streamFn: recordingStreamFn(calls),
      sessionId: 'kila-session',
      cacheRetention: retention,
      serializeConversation,
      initialContext: warm,
    })

    // 序列化内容与 last routed 前缀不匹配 → fail closed
    await wrapper({} as never, standaloneSummaryContext([user('unrelated', 5)]), { cacheRetention: 'none', sessionId: 'random-opaque' })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.cacheRetention).toBe('none')
    expect(calls[0]?.sessionId).toBe('random-opaque')
    expect(calls[0]?.context.messages).toHaveLength(1)
  })

  test('普通请求不被改写且不注入摘要指令', async () => {
    const calls: RecordedCall[] = []
    const wrapper = createCacheAwareCompactionStreamFn({
      streamFn: recordingStreamFn(calls),
      sessionId: 'kila-session',
      cacheRetention: retention,
      serializeConversation,
    })

    const ordinary: Context = { systemPrompt: 'stable', messages: [user('ordinary turn', 1)] }
    await wrapper({} as never, ordinary, { cacheRetention: 'short', sessionId: 'kila-session' })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.context).toBe(ordinary)
    expect(calls[0]?.cacheRetention).toBe('short')
  })
})
