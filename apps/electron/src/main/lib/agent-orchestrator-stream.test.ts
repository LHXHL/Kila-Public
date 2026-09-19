import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  AgentEvent,
  AgentProviderAdapter,
  AgentRunOutcome,
  AgentSendInput,
  MemoryRunTrace,
} from '@kila/shared'
import type { PiAgentQueryOptions } from '../../utility/pi-agent-adapter'
import { AgentEventBus } from './agent-event-bus'
import { readAgentRunReceipt } from './agent-run-receipt-store'
import { appendAgentMessage, getAgentMessages } from './agent-message-store'
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

/** 模拟 orchestrator 在进入 stream 前落盘本轮用户消息，并返回其 id 作为安全边界。 */
function appendTurnUserMessage(sessionId: string, text: string): string {
  const id = randomUUID()
  appendAgentMessage(sessionId, {
    id,
    role: 'user',
    content: text,
    createdAt: Date.now(),
  })
  return id
}

async function runWithAdapter(
  adapter: AgentProviderAdapter,
  input: AgentSendInput,
  shouldContinue?: () => boolean,
): Promise<{ errors: string[]; outcomes: AgentRunOutcome[]; events: AgentEvent[]; turnUserMessageId: string }> {
  const eventBus = new AgentEventBus()
  const errors: string[] = []
  const outcomes: AgentRunOutcome[] = []
  const events: AgentEvent[] = []
  eventBus.on((_sessionId, event) => events.push(event))
  const turnUserMessageId = appendTurnUserMessage(input.sessionId, input.userMessage)

  await runAgentStream({
    input,
    adapter,
    eventBus,
    queryOptions: { sessionId: input.sessionId } as PiAgentQueryOptions,
    turnUserMessageId,
    resolvedModel: input.modelId ?? 'model-a',
    memoryTrace: createMemoryTrace(),
    shouldContinue: shouldContinue ? () => shouldContinue() : undefined,
    onError: (error) => errors.push(error),
    onComplete: (_messages, outcome = 'success') => outcomes.push(outcome),
  })

  return { errors, outcomes, events, turnUserMessageId }
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

  test('Given Runtime 尚未确认 persisted，When 产品消息已落盘，Then onComplete 等待 run.persisted_ack', async () => {
    const context = createContext()
    let resolvePersisted!: () => void
    let persistStarted = false
    const persisted = new Promise<void>((resolve) => {
      resolvePersisted = resolve
    })
    const outcomes: AgentRunOutcome[] = []
    const adapter: AgentProviderAdapter = {
      ownsRetry: true,
      query: async function* () {
        yield { type: 'text_delta', text: '等待安全边界' }
        yield { type: 'complete', stopReason: 'stop' }
      },
      abort: () => {},
      dispose: () => {},
      markRunPersisted: async () => {
        persistStarted = true
        await persisted
      },
    }

    const runPromise = runAgentStream({
      input: context.input,
      adapter,
      eventBus: new AgentEventBus(),
      queryOptions: { sessionId: context.sessionId, runId: 'run-persist-barrier' } as PiAgentQueryOptions,
      turnUserMessageId: appendTurnUserMessage(context.sessionId, context.input.userMessage),
      resolvedModel: context.input.modelId ?? 'model-a',
      memoryTrace: createMemoryTrace(),
      onError: () => {},
      onComplete: (_messages, outcome = 'success') => outcomes.push(outcome),
    })

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(persistStarted).toBe(true)
    expect(outcomes).toEqual([])

    resolvePersisted()
    await runPromise
    expect(outcomes).toEqual(['success'])
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

interface RecordedPersistCall {
  runId: string
  lastMessageId?: string
  options?: { requireSettledRun?: boolean }
}

/** 记录每次 query 的 runId 与 markRunPersisted 调用，用于断言续跑迭代的轮转与确认时序。 */
function createRunRecordingAdapter(passes: Array<() => AgentEvent[]>, options?: {
  ownsRetry?: boolean
  onMarkRunPersisted?: (call: RecordedPersistCall) => Promise<void> | void
}): {
  adapter: AgentProviderAdapter
  runIds: Array<string | undefined>
  persistCalls: RecordedPersistCall[]
} {
  const runIds: Array<string | undefined> = []
  const persistCalls: RecordedPersistCall[] = []
  const adapter: AgentProviderAdapter = {
    ownsRetry: options?.ownsRetry ?? true,
    query: (queryOptions) => {
      runIds.push((queryOptions as PiAgentQueryOptions).runId)
      const events = passes[Math.min(runIds.length - 1, passes.length - 1)]?.() ?? []
      return (async function* () {
        yield* events
      })()
    },
    abort: () => {},
    dispose: () => {},
    markRunPersisted: async (_sessionId, runId, lastMessageId, callOptions) => {
      const call = { runId, lastMessageId, options: callOptions }
      persistCalls.push(call)
      await options?.onMarkRunPersisted?.(call)
    },
  }
  return { adapter, runIds, persistCalls }
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

describe('/goal 持续执行', () => {
  test('Given 尚未完成后出现完成标记 When 持续执行 Then 成功收敛并移除控制标记', async () => {
    const context = createContext()
    const { adapter, prompts } = createPromptAwareAdapter([
      () => [
        { type: 'text_delta', text: '先完成第一步。' },
        { type: 'complete', stopReason: 'stop' },
      ],
      () => [
        { type: 'text_delta', text: '已验证全部结果 <!-- KILA_GOAL_COMPLETE -->' },
        { type: 'complete', stopReason: 'stop' },
      ],
    ])

    const result = await runWithAdapter(adapter, { ...context.input, goalLoop: true })

    expect(prompts).toHaveLength(2)
    expect(result.outcomes).toEqual(['success'])
    expect(getAgentMessages(context.sessionId).find((message) => message.role === 'assistant')?.content)
      .toBe('先完成第一步。已验证全部结果')
  })

  test('Given 模型报告阻塞 When 持续执行 Then 立即停止且不再调用模型', async () => {
    const context = createContext()
    const { adapter, prompts } = createPromptAwareAdapter([
      () => [
        { type: 'text_delta', text: '需要用户提供发布凭证。<!-- KILA_GOAL_BLOCKED -->' },
        { type: 'complete', stopReason: 'stop' },
      ],
    ])

    const result = await runWithAdapter(adapter, { ...context.input, goalLoop: true })

    expect(prompts).toHaveLength(1)
    expect(result.outcomes).toEqual(['stopped'])
    expect(getAgentMessages(context.sessionId).find((message) => message.role === 'assistant')?.content)
      .toBe('需要用户提供发布凭证。')
  })

  test('Given 模型始终不标记完成 When 达到自动续跑上限 Then 按未完成停止', async () => {
    const context = createContext()
    const { adapter, prompts } = createPromptAwareAdapter([
      () => [{ type: 'text_delta', text: '仍在处理' }, { type: 'complete', stopReason: 'stop' }],
    ])

    const result = await runWithAdapter(adapter, { ...context.input, goalLoop: true })

    expect(prompts).toHaveLength(9)
    expect(result.outcomes).toEqual(['stopped'])
    expect(getAgentMessages(context.sessionId).some((message) => (
      message.role === 'status' && message.content.includes('目标尚未确认完成')
    ))).toBe(true)
  })
})

describe('续跑迭代的 runId 轮转与 persisted 确认', () => {
  test('Given goal loop 需要两次迭代 When 第二次 query 发起 Then runId 已轮转且第一次 runId 先收到严格确认', async () => {
    const context = createContext()
    const { adapter, runIds, persistCalls } = createRunRecordingAdapter([
      () => [{ type: 'text_delta', text: '第一步完成。' }, { type: 'complete', stopReason: 'stop' }],
      () => [{ type: 'text_delta', text: '已全部完成 <!-- KILA_GOAL_COMPLETE -->' }, { type: 'complete', stopReason: 'stop' }],
    ])

    const result = await runWithAdapter(adapter, { ...context.input, goalLoop: true })

    expect(result.outcomes).toEqual(['success'])
    expect(runIds).toHaveLength(2)
    expect(runIds[0]).toBeTruthy()
    expect(runIds[1]).not.toBe(runIds[0])
    // 中间确认：轮转前的 runId + 本轮用户消息作为安全边界 + 严格模式
    expect(persistCalls).toHaveLength(2)
    expect(persistCalls[0]?.runId).toBe(runIds[0])
    expect(persistCalls[0]?.lastMessageId).toBe(result.turnUserMessageId)
    expect(persistCalls[0]?.options).toEqual({ requireSettledRun: true })
    // 终态确认：最后一次迭代的 runId，宽松模式（不带 options）
    expect(persistCalls[1]?.runId).toBe(runIds[1])
    expect(persistCalls[1]?.options).toBeUndefined()
    // 最终 receipt 只保留最后一次迭代的 runId
    const receipt = readAgentRunReceipt(context.sessionId)
    expect(receipt?.runId).toBe(runIds[1])
    expect(receipt?.runtimeSettled).toBe(true)
  })

  test('Given 压缩后回复被截断 When 自动续跑 Then 第二段 query 使用新 runId 且前置严格确认', async () => {
    const context = createContext()
    const { adapter, runIds, persistCalls } = createRunRecordingAdapter([
      () => [
        { type: 'text_delta', text: '前半段' },
        { type: 'compact_complete', reason: 'threshold', willRetry: false },
        { type: 'complete', stopReason: 'length' },
      ],
      () => [{ type: 'text_delta', text: '后半段' }, { type: 'complete', stopReason: 'stop' }],
    ])

    const result = await runWithAdapter(adapter, context.input)

    expect(result.outcomes).toEqual(['success'])
    expect(runIds).toHaveLength(2)
    expect(runIds[1]).not.toBe(runIds[0])
    expect(persistCalls).toHaveLength(2)
    expect(persistCalls[0]?.runId).toBe(runIds[0])
    expect(persistCalls[0]?.lastMessageId).toBe(result.turnUserMessageId)
    expect(persistCalls[0]?.options).toEqual({ requireSettledRun: true })
  })

  test('Given 外层重试进入第二次 attempt When 重新 query Then runId 已轮转且确认走宽松模式', async () => {
    const context = createContext()
    const { adapter, runIds, persistCalls } = createRunRecordingAdapter([
      () => [{
        type: 'typed_error',
        error: { code: 'rate_limited', title: '请求频率限制', message: '稍后再试', canRetry: true, actions: [] },
      }],
      () => [{ type: 'text_delta', text: '重试成功' }, { type: 'complete', stopReason: 'stop' }],
    ], { ownsRetry: false })

    const result = await runWithAdapter(adapter, context.input)

    expect(result.outcomes).toEqual(['success'])
    expect(runIds).toHaveLength(2)
    expect(runIds[1]).not.toBe(runIds[0])
    // 重试确认走宽松模式：rejected / 未 settle 的上一 attempt 合法缺席
    expect(persistCalls.some((call) => (
      call.runId === runIds[0] && call.options?.requireSettledRun === false
    ))).toBe(true)
  })

  test('Given markRunPersisted 拒绝 When 续跑确认失败 Then 收敛 error、单次确认、不再发起后续 query', async () => {
    const context = createContext()
    const { adapter, runIds, persistCalls } = createRunRecordingAdapter([
      () => [{ type: 'text_delta', text: '第一步。' }, { type: 'complete', stopReason: 'stop' }],
    ], {
      onMarkRunPersisted: async () => {
        throw new Error('runtime_unresponsive: 等待 run.persisted_ack 超时')
      },
    })

    const result = await runWithAdapter(adapter, { ...context.input, goalLoop: true })

    expect(result.outcomes).toEqual(['error'])
    expect(runIds).toHaveLength(1)
    // 收敛路径跳过终态处的二次确认（该 run 已确认失败），全程只调用一次
    expect(persistCalls).toHaveLength(1)
    const messages = getAgentMessages(context.sessionId)
    expect(messages.some((message) => (
      message.role === 'status' && message.errorCode === 'runtime_unresponsive'
    ))).toBe(true)
    expect(result.errors.length).toBeGreaterThan(0)
    // 确认失败后 receipt 必须保守声明 runtimeSettled=false
    expect(readAgentRunReceipt(context.sessionId)?.runtimeSettled).toBe(false)
  })

  test('Given 严格确认发现 run 未 settle When markRunPersisted 抛协议错误 Then 本轮收敛 error', async () => {
    const context = createContext()
    const { adapter, runIds, persistCalls } = createRunRecordingAdapter([
      () => [{ type: 'text_delta', text: '第一步。' }, { type: 'complete', stopReason: 'stop' }],
    ], {
      onMarkRunPersisted: async (call) => {
        if (call.options?.requireSettledRun) {
          throw new Error('runtime_protocol_desync: 上一 run 未 settle 却请求继续')
        }
      },
    })

    const result = await runWithAdapter(adapter, { ...context.input, goalLoop: true })

    expect(result.outcomes).toEqual(['error'])
    expect(runIds).toHaveLength(1)
    expect(persistCalls).toHaveLength(1)
    expect(persistCalls[0]?.options).toEqual({ requireSettledRun: true })
  })

  test('Given 传入的 turnUserMessageId 与实际落盘消息不匹配 When stream 启动 Then fail-fast 抛协议错误', async () => {
    const context = createContext()
    const adapter = createAdapter(async function* () {
      yield { type: 'complete', stopReason: 'stop' }
    })

    await expect(runAgentStream({
      input: context.input,
      adapter,
      eventBus: new AgentEventBus(),
      queryOptions: { sessionId: context.sessionId } as PiAgentQueryOptions,
      turnUserMessageId: 'bogus-turn-user-message-id',
      resolvedModel: 'model-a',
      memoryTrace: createMemoryTrace(),
      onError: () => {},
      onComplete: () => {},
    })).rejects.toThrow('runtime_protocol_desync')
  })
})
