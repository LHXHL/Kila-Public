import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentEvent,
  AgentProviderAdapter,
  AgentRunOutcome,
  AgentSendInput,
  MemoryRunTrace,
} from '@kila/shared'
import type { PiAgentQueryOptions } from './adapters/pi-agent-adapter'
import { AgentEventBus } from './agent-event-bus'
import { getAgentMessages } from './agent-message-store'
import { runAgentStream } from './agent-orchestrator-stream'
import { createSession } from './session-manager'

const tempDirs: string[] = []
const originalConfigDir = process.env.KILA_CONFIG_DIR

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  if (typeof originalConfigDir === 'string') {
    process.env.KILA_CONFIG_DIR = originalConfigDir
  } else {
    delete process.env.KILA_CONFIG_DIR
  }
})

function createContext(): { sessionId: string; input: AgentSendInput } {
  const root = mkdtempSync(join(tmpdir(), 'kila-agent-stream-'))
  tempDirs.push(root)
  process.env.KILA_CONFIG_DIR = join(root, 'config')
  const projectPath = join(root, 'project')
  const session = createSession({ projectPath, channelId: 'channel-a', modelId: 'model-a' })
  return {
    sessionId: session.id,
    input: {
      sessionId: session.id,
      userMessage: '测试消息',
      incognito: true,
      channelId: 'channel-a',
      modelId: 'model-a',
      projectPath,
    },
  }
}

function createMemoryTrace(): MemoryRunTrace {
  return {
    enabled: false,
    recalledMemoryCount: 0,
    relatedThreadCount: 0,
    notebookCount: 0,
    usedGlobalWorkingMemory: false,
    usedProjectWorkingMemory: false,
    incognito: true,
    recallStatus: 'disabled',
  }
}

function createAdapter(
  factory: () => AsyncGenerator<AgentEvent>,
  ownsRetry = true,
): AgentProviderAdapter {
  return {
    ownsRetry,
    query: factory,
    abort: () => {},
    dispose: () => {},
  }
}

async function runWithAdapter(
  adapter: AgentProviderAdapter,
  input: AgentSendInput,
  shouldContinue?: () => boolean,
): Promise<{ errors: string[]; outcomes: AgentRunOutcome[]; events: AgentEvent[] }> {
  const eventBus = new AgentEventBus()
  const errors: string[] = []
  const outcomes: AgentRunOutcome[] = []
  const events: AgentEvent[] = []
  eventBus.on((_sessionId, event) => events.push(event))

  await runAgentStream({
    input,
    adapter,
    eventBus,
    queryOptions: { sessionId: input.sessionId } as PiAgentQueryOptions,
    resolvedModel: input.modelId ?? 'model-a',
    memoryTrace: createMemoryTrace(),
    shouldContinue: shouldContinue ? () => shouldContinue() : undefined,
    onError: (error) => errors.push(error),
    onComplete: (_messages, outcome = 'success') => outcomes.push(outcome),
  })

  return { errors, outcomes, events }
}

describe('Agent stream 终态收敛', () => {
  test('Given Pi 最终返回 typed_error，When 消费完成，Then 按失败收敛且保留部分输出', async () => {
    const context = createContext()
    const adapter = createAdapter(async function* () {
      yield { type: 'text_delta', text: '部分回复' }
      yield {
        type: 'typed_error',
        error: {
          code: 'rate_limited',
          title: '请求频率限制',
          message: '请稍后再试',
          canRetry: true,
          actions: [],
        },
      }
    })

    const result = await runWithAdapter(adapter, context.input)
    const messages = getAgentMessages(context.sessionId)

    expect(result.errors).toEqual(['请求频率限制: 请稍后再试'])
    expect(result.outcomes).toEqual(['error'])
    expect(messages.some((message) => message.role === 'assistant' && message.content === '部分回复')).toBe(true)
    expect(messages.some((message) => message.role === 'status' && message.errorCode === 'rate_limited')).toBe(true)
  })

  test('Given Pi 返回未知 error 事件，When 流结束，Then 不得误报成功', async () => {
    const context = createContext()
    const adapter = createAdapter(async function* () {
      yield { type: 'error', message: '未知 provider 故障' }
    })

    const result = await runWithAdapter(adapter, context.input)
    const messages = getAgentMessages(context.sessionId)

    expect(result.errors).toEqual(['未知 provider 故障'])
    expect(result.outcomes).toEqual(['error'])
    expect(messages.some((message) => message.role === 'status' && message.content === '未知 provider 故障')).toBe(true)
  })

  test('Given 用户中止流，When 已收到部分正文，Then 按 stopped 收敛且不伪造成功', async () => {
    const context = createContext()
    let active = true
    const adapter = createAdapter(async function* () {
      yield { type: 'text_delta', text: '已生成部分' }
      active = false
      yield { type: 'text_delta', text: '不应消费' }
    })

    const result = await runWithAdapter(adapter, context.input, () => active)

    expect(result.errors).toEqual([])
    expect(result.outcomes).toEqual(['stopped'])
    expect(getAgentMessages(context.sessionId).some((message) => (
      message.role === 'assistant' && message.content === '已生成部分'
    ))).toBe(true)
  })

  test('Given 外层兼容重试前出现 error，When 下一次成功，Then 旧错误不污染最终终态', async () => {
    const context = createContext()
    let attempt = 0
    const adapter = createAdapter(async function* () {
      attempt += 1
      if (attempt === 1) {
        yield { type: 'error', message: '第一次临时错误' }
        yield {
          type: 'typed_error',
          error: {
            code: 'network_error',
            title: '网络错误',
            message: '连接重置',
            canRetry: true,
          actions: [],
          },
        }
        return
      }
      yield { type: 'text_delta', text: '重试成功' }
      yield { type: 'complete', stopReason: 'stop' }
    }, false)

    const result = await runWithAdapter(adapter, context.input)

    expect(result.errors).toEqual([])
    expect(result.outcomes).toEqual(['success'])
    expect(getAgentMessages(context.sessionId).some((message) => (
      message.role === 'assistant' && message.content === '重试成功'
    ))).toBe(true)
  })

  test('Given Pi 内部自动重试，When 新 attempt 前已有失败内容，Then 持久化只保留成功 attempt 内容且不重复思考块', async () => {
    const context = createContext()
    // ownsRetry 默认 true：模拟 Pi 在同一次 query 内部自动重试。
    const adapter = createAdapter(async function* () {
      // —— 失败 attempt 的内容（思考 + 文本）——
      yield { type: 'thinking_start', contentIndex: 0 }
      yield { type: 'thinking_delta', contentIndex: 0, text: '失败前的思考' }
      yield { type: 'thinking_end', contentIndex: 0, text: '失败前的思考' }
      yield { type: 'text_delta', text: '失败 attempt 的部分正文' }
      yield { type: 'error', message: '瞬时网络错误' }
      // —— Pi 触发内部重试，进入新 attempt ——
      yield { type: 'retrying', attempt: 1, maxAttempts: 3, delaySeconds: 0, reason: '瞬时网络错误' }
      yield {
        type: 'retry_attempt',
        attemptData: { attempt: 1, timestamp: 0, reason: '瞬时网络错误', errorMessage: '瞬时网络错误', delaySeconds: 0 },
      }
      yield { type: 'retry_cleared' }
      // —— 成功 attempt 的内容 ——
      yield { type: 'text_delta', text: '成功回复' }
      yield { type: 'complete', stopReason: 'stop' }
    })

    const result = await runWithAdapter(adapter, context.input)
    const messages = getAgentMessages(context.sessionId)
    const assistant = messages.find((message) => message.role === 'assistant')

    // 终态为成功，且失败 attempt 的 error 不污染终态。
    expect(result.outcomes).toEqual(['success'])
    // 持久化正文只保留成功 attempt。
    expect(assistant?.content).toBe('成功回复')
    // 失败 attempt 的思考内容不得残留在持久化事件里（否则重载会渲染出重复思考块）。
    const thinkingDeltas = (assistant?.events ?? []).filter((event) => event.type === 'thinking_delta')
    expect(thinkingDeltas).toHaveLength(0)
    // 但重试历史标记必须保留。
    expect((assistant?.events ?? []).some((event) => event.type === 'retry_attempt')).toBe(true)
  })
})

/** 构造可观察每次 query 传入 prompt 的 adapter，用于验证压缩后自动续跑。 */
function createPromptAwareAdapter(
  passes: Array<(prompt: string | undefined) => AgentEvent[]>,
): { adapter: AgentProviderAdapter; prompts: Array<string | undefined> } {
  const prompts: Array<string | undefined> = []
  const adapter: AgentProviderAdapter = {
    ownsRetry: true,
    query: (options) => {
      prompts.push(options.prompt)
      const events = passes[Math.min(prompts.length - 1, passes.length - 1)]?.(options.prompt) ?? []
      return (async function* () {
        yield* events
      })()
    },
    abort: () => {},
    dispose: () => {},
  }
  return { adapter, prompts }
}

describe('压缩后自动续跑', () => {
  const truncatedPassEvents: AgentEvent[] = [
    { type: 'text_delta', text: '前半段' },
    { type: 'compacting' },
    { type: 'compact_complete', reason: 'threshold', willRetry: false },
    { type: 'complete', stopReason: 'length' },
  ]

  test('Given 压缩后回复被 maxTokens 截断，When 流结束，Then 自动以接力 prompt 续跑一次并合并为同一条 assistant 消息', async () => {
    const context = createContext()
    const { adapter, prompts } = createPromptAwareAdapter([
      () => truncatedPassEvents,
      () => [
        { type: 'text_delta', text: '后半段' },
        { type: 'complete', stopReason: 'stop' },
      ],
    ])

    const result = await runWithAdapter(adapter, context.input)
    const messages = getAgentMessages(context.sessionId)
    const assistants = messages.filter((message) => message.role === 'assistant')

    // 续跑了一次，且第二次 query 用的是接力 prompt。
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toContain('继续完成')
    // 两段输出合并为同一条 assistant 消息，终态为成功。
    expect(result.outcomes).toEqual(['success'])
    expect(assistants).toHaveLength(1)
    expect(assistants[0]?.content).toBe('前半段后半段')
    // 压缩对用户无感：压缩边界 status 仍落盘（events 承载 compact_complete 供统计），
    // 但正文为空；续跑不产生任何展示性 status。
    const compactionStatuses = messages.filter((message) => (
      message.role === 'status' && !message.errorCode
    ))
    expect(compactionStatuses.length).toBeGreaterThan(0)
    expect(compactionStatuses.every((message) => message.content === '')).toBe(true)
    expect(messages.some((message) => message.role === 'status' && message.content.includes('已自动继续'))).toBe(false)
  })

  test('Given 压缩后回复正常结束（stopReason=stop），When 流结束，Then 不触发续跑', async () => {
    const context = createContext()
    const { adapter, prompts } = createPromptAwareAdapter([
      () => [
        { type: 'text_delta', text: '完整回复' },
        { type: 'compact_complete', reason: 'threshold', willRetry: false },
        { type: 'complete', stopReason: 'stop' },
      ],
    ])

    const result = await runWithAdapter(adapter, context.input)

    expect(prompts).toHaveLength(1)
    expect(result.outcomes).toEqual(['success'])
    expect(getAgentMessages(context.sessionId).some((message) => (
      message.role === 'status' && message.content.includes('已自动继续')
    ))).toBe(false)
  })

  test('Given 未发生压缩但回复被截断，When 流结束，Then 不触发续跑', async () => {
    const context = createContext()
    const { adapter, prompts } = createPromptAwareAdapter([
      () => [
        { type: 'text_delta', text: '被截断的回复' },
        { type: 'complete', stopReason: 'length' },
      ],
    ])

    const result = await runWithAdapter(adapter, context.input)

    expect(prompts).toHaveLength(1)
    expect(result.outcomes).toEqual(['success'])
  })

  test('Given 续跑后再次压缩且再次截断，When 流结束，Then 续跑上限为一次防止死循环', async () => {
    const context = createContext()
    const { adapter, prompts } = createPromptAwareAdapter([
      () => truncatedPassEvents,
      () => truncatedPassEvents,
    ])

    const result = await runWithAdapter(adapter, context.input)

    // 第二次仍被截断也不再续跑，总共只有两次 query。
    expect(prompts).toHaveLength(2)
    expect(result.outcomes).toEqual(['success'])
  })
})
