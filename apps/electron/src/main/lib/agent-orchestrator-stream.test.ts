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
})
