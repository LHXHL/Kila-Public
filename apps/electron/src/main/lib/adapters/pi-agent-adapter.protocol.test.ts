import { describe, expect, test } from 'bun:test'
import {
  createPiEventMapper,
  mapPiErrorMessageToKilaEvent,
  mapPiEventToKilaEvents,
  resolvePiApiType,
  resolvePiModelMetadata,
} from './pi-agent-adapter'

describe('Pi 渠道协议映射', () => {
  test('Given 渠道显式声明 apiType, When 构建 Pi 模型, Then 以协议配置而非模型名称决定 API', () => {
    expect(resolvePiApiType({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiType: 'openai',
    }, 'gpt-5.5')).toBe('openai-completions')

    expect(resolvePiApiType({
      provider: 'custom-gateway',
      baseUrl: 'https://gateway.example/v1',
      apiType: 'openai-responses',
    }, 'any-model')).toBe('openai-responses')

    expect(resolvePiApiType({
      provider: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiType: 'ollama',
    }, 'gpt-5-local')).toBe('openai-completions')

    expect(resolvePiApiType({
      provider: 'custom',
      baseUrl: 'https://anthropic-compatible.example',
      apiType: 'anthropic',
    }, 'claude-compatible')).toBe('anthropic-messages')

    expect(resolvePiApiType({
      provider: 'custom',
      baseUrl: 'https://google-compatible.example',
      apiType: 'google',
    }, 'gemini-compatible')).toBe('google-generative-ai')
  })

  test('Given 老渠道缺少 apiType, When 使用 OpenAI 推理模型, Then 保留 Responses API 历史兼容推断', () => {
    expect(resolvePiApiType({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
    }, 'gpt-5.5')).toBe('openai-responses')

    expect(resolvePiApiType({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
    }, 'gpt-4o-mini')).toBe('openai-completions')
  })
})


test('Given capabilityProviderId 命中的 Provider DB 模型画像, When 生成 Pi 模型元数据, Then DB 能力进入 Pi runtime 而窗口走模型名推断', () => {
  const metadata = resolvePiModelMetadata(
    {
      provider: 'company-router',
      capabilityProviderId: 'openrouter',
      baseUrl: 'https://gateway.example/v1',
      apiType: 'openai',
    },
    'vendor/reasoning-vision',
    undefined,
    undefined,
    {
      id: 'vendor/reasoning-vision',
      tool_call: true,
      modalities: { input: ['text', 'image'], output: ['text'] },
      limit: { context: 512000, output: 64000 },
      reasoning: { supported: true },
    },
  )

  // context 窗口已切换为单一数据源（模型名推断），DB 的 limit.context 不再参与；
  // DB 仍提供 abilities 与 maxOutputTokens。
  expect(metadata.contextWindowTokens).toBe(200000)
  expect(metadata.maxOutputTokens).toBe(64000)
  expect(metadata.abilities).toMatchObject({
    tools: 'supported',
    vision: 'supported',
    reasoning: 'supported',
  })
})

test('Given capabilityProviderId 配错但模型在 DB 全局存在 When 用全局兜底 entry Then 能力画像可用且窗口不退化', () => {
  // 用户场景：step 渠道 capabilityProviderId 配成 'openai'（协议兼容），但 step-3.7-flash 实际
  // 归属 stepfun-step-plan。lookupProviderDbModel('openai', 'step-3.7-flash') 命中失败，
  // agent-orchestrator-context.ts 会回退到 findProviderDbModel 全局搜索并命中。
  // context 窗口统一走模型名推断，DB entry 只负责能力画像，不再依赖 32K/DB 窗口兜底。
  const metadata = resolvePiModelMetadata(
    {
      provider: 'openai',
      capabilityProviderId: 'openai',
      baseUrl: 'https://api.stepfun.com/step_plan/v1',
      apiType: 'openai',
    },
    'step-3.7-flash',
    undefined,
    undefined,
    {
      id: 'step-3.7-flash',
      tool_call: true,
      modalities: { input: ['text', 'image'], output: ['text'] },
      limit: { context: 256000, output: 256000 },
    },
  )

  expect(metadata.contextWindowTokens).toBe(200000)
  expect(metadata.abilities.tools).toBe('supported')
})

describe('Pi Provider 错误映射', () => {
  test('Given 403 用户组无路由权限 When 映射错误 Then 不误报 API Key', () => {
    expect(mapPiErrorMessageToKilaEvent('403 This group does not allow /v1/messages dispatch')).toEqual({
      type: 'typed_error',
      error: expect.objectContaining({ code: 'permission_denied', title: '权限不足' }),
    })
  })

  test('Given 403 区域限制 When 映射错误 Then 返回区域限制', () => {
    expect(mapPiErrorMessageToKilaEvent('403 This model is not available in your region.')).toEqual({
      type: 'typed_error',
      error: expect.objectContaining({ code: 'region_restricted', title: '区域限制' }),
    })
  })
})

describe('Pi 事件边界', () => {
  test('Given agent_end 后进入 Pi compaction/retry When 收到 agent_settled Then 只产生一个最终错误事件', () => {
    const mapper = createPiEventMapper()
    const errorMessage = {
      type: 'agent_end',
      messages: [{ role: 'assistant', errorMessage: '401 invalid api key' }],
    } as any

    expect(mapper(errorMessage)).toEqual([])
    expect(mapper({ type: 'compaction_start' } as any)).toEqual([{ type: 'compacting' }])
    expect(mapper({ type: 'agent_settled' } as any)).toEqual([
      expect.objectContaining({ type: 'complete' }),
      {
        type: 'typed_error',
        error: expect.objectContaining({ code: 'invalid_api_key' }),
      },
    ])
    expect(mapper({ type: 'agent_settled' } as any)).toEqual([])
  })

  test('Given 多轮 assistant/tool 调用 When 映射 Pi 事件 Then toolUse 文本是中间结果且 usage 聚合', () => {
    const mapper = createPiEventMapper({ contextWindow: 128000 })
    const firstTurnStart = mapper({ type: 'turn_start' } as any)
    const firstMessage = mapper({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '先查资料' }],
        stopReason: 'toolUse',
        usage: { input: 100, output: 20, cacheRead: 5, cacheWrite: 2, cost: { total: 0.01 } },
      },
    } as any)
    const toolStart = mapper({ type: 'tool_execution_start', toolCallId: 'tool-1', toolName: 'search', args: {} } as any)
    const toolResult = mapper({ type: 'tool_execution_end', toolCallId: 'tool-1', toolName: 'search', result: { content: [{ type: 'text', text: '结果' }] }, isError: false } as any)
    const secondTurnStart = mapper({ type: 'turn_start' } as any)
    const finalMessage = mapper({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '最终答案' }],
        stopReason: 'stop',
        usage: { input: 200, output: 30, cacheRead: 7, cacheWrite: 3, cost: { total: 0.02 } },
      },
    } as any)
    const agentEnd = mapper({
      type: 'agent_end',
      messages: [
        { role: 'assistant', stopReason: 'toolUse', usage: { input: 100, output: 20, cacheRead: 5, cacheWrite: 2, cost: { total: 0.01 } } },
        { role: 'assistant', stopReason: 'stop', usage: { input: 200, output: 30, cacheRead: 7, cacheWrite: 3, cost: { total: 0.02 } } },
      ],
    } as any)
    const settled = mapper({ type: 'agent_settled' } as any)

    expect(firstTurnStart).toEqual([{ type: 'turn_start', turnId: 'pi-turn-1' }])
    expect(firstMessage.find((event) => event.type === 'text_complete')).toMatchObject({ type: 'text_complete', isIntermediate: true, turnId: 'pi-turn-1' })
    expect(toolStart[0]).toMatchObject({ type: 'tool_start', toolUseId: 'tool-1', turnId: 'pi-turn-1' })
    expect(toolResult[0]).toMatchObject({ type: 'tool_result', toolUseId: 'tool-1', turnId: 'pi-turn-1' })
    expect(secondTurnStart).toEqual([{ type: 'turn_start', turnId: 'pi-turn-2' }])
    expect(finalMessage.find((event) => event.type === 'text_complete')).toMatchObject({ type: 'text_complete', text: '最终答案', isIntermediate: false, turnId: 'pi-turn-2' })
    expect(agentEnd).toEqual([])
    expect(settled).toEqual([expect.objectContaining({
      type: 'complete',
      usage: expect.objectContaining({
        inputTokens: 300,
        outputTokens: 50,
        cacheReadTokens: 12,
        cacheCreationTokens: 5,
        contextInputTokens: 210,
        contextWindow: 128000,
      }),
    })])
  })

  test('Given 后台化的 Task/Bash/KillShell When tool_execution_end Then 产出后台任务事件', () => {
    const mapper = createPiEventMapper()
    mapper({ type: 'turn_start' } as any)

    // 后台 Task：run_in_background + 结果含 agentId
    mapper({ type: 'tool_execution_start', toolCallId: 't-1', toolName: 'task', args: { run_in_background: true, description: '批量分析' } } as any)
    const taskResult = mapper({ type: 'tool_execution_end', toolCallId: 't-1', toolName: 'task', result: { content: [{ type: 'text', text: 'agentId: agent-42' }] }, isError: false } as any)

    // 后台 Bash：结果含 shell_id
    mapper({ type: 'tool_execution_start', toolCallId: 't-2', toolName: 'bash', args: { command: 'sleep 100 &', run_in_background: true } } as any)
    const bashResult = mapper({ type: 'tool_execution_end', toolCallId: 't-2', toolName: 'bash', result: { content: [{ type: 'text', text: 'shell_id: shell-7' }] }, isError: false } as any)

    // KillShell
    mapper({ type: 'tool_execution_start', toolCallId: 't-3', toolName: 'kill_shell', args: { shell_id: 'shell-7' } } as any)
    const killResult = mapper({ type: 'tool_execution_end', toolCallId: 't-3', toolName: 'kill_shell', result: { content: [{ type: 'text', text: 'killed' }] }, isError: false } as any)

    expect(taskResult).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'task_backgrounded', toolUseId: 't-1', taskId: 'agent-42', intent: '批量分析', turnId: 'pi-turn-1' }),
    ]))
    expect(bashResult).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'shell_backgrounded', toolUseId: 't-2', shellId: 'shell-7', command: 'sleep 100 &' }),
    ]))
    expect(killResult).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'shell_killed', shellId: 'shell-7' }),
    ]))
  })

  test('Given 自动重试产生多个 agent_end When 最终 settled Then usage 包含失败与成功 run 且只保留最终终态', () => {
    const mapper = createPiEventMapper({ contextWindow: 200000 })

    expect(mapper({
      type: 'agent_end',
      messages: [{
        role: 'assistant',
        stopReason: 'error',
        errorMessage: 'provider overloaded',
        usage: { input: 80, output: 4, cacheRead: 20, cacheWrite: 0, cost: { total: 0.01 } },
      }],
    } as any)).toEqual([])
    expect(mapper({
      type: 'agent_end',
      messages: [{
        role: 'assistant',
        stopReason: 'stop',
        content: [{ type: 'text', text: '重试成功' }],
        usage: { input: 120, output: 16, cacheRead: 30, cacheWrite: 5, cost: { total: 0.03 } },
      }],
    } as any)).toEqual([])

    expect(mapper({ type: 'agent_settled' } as any)).toEqual([
      expect.objectContaining({
        type: 'complete',
        stopReason: 'stop',
        usage: {
          inputTokens: 200,
          outputTokens: 20,
          cacheReadTokens: 50,
          cacheCreationTokens: 5,
          costUsd: 0.04,
          contextInputTokens: 155,
          contextWindow: 200000,
        },
      }),
    ])
  })

  test('Given Pi 最终失败但返回 usage When settled Then 先记录可计费用量再发送错误终态', () => {
    const mapper = createPiEventMapper({ contextWindow: 128000 })

    mapper({
      type: 'agent_end',
      messages: [{
        role: 'assistant',
        stopReason: 'error',
        errorMessage: '503 service unavailable',
        usage: { input: 40, output: 2, cacheRead: 10, cacheWrite: 1, cost: { total: 0.02 } },
      }],
    } as any)

    expect(mapper({ type: 'agent_settled' } as any)).toEqual([
      expect.objectContaining({
        type: 'complete',
        usage: expect.objectContaining({
          inputTokens: 40,
          contextInputTokens: 51,
          costUsd: 0.02,
        }),
      }),
      expect.objectContaining({ type: 'typed_error' }),
    ])
  })

  test('Given abort 路径只有 agent_end When flush Then 不丢失 usage 和错误', () => {
    const mapper = createPiEventMapper({ contextWindow: 128000 })

    expect(mapper({
      type: 'agent_end',
      messages: [{
        role: 'assistant',
        stopReason: 'error',
        errorMessage: '连接在响应完成前断开',
        usage: { input: 12, output: 3, cacheRead: 4, cacheWrite: 1, cost: { total: 0.02 } },
      }],
    } as any)).toEqual([])

    expect(mapper.flush()).toEqual([
      expect.objectContaining({
        type: 'complete',
        usage: expect.objectContaining({ inputTokens: 12, outputTokens: 3 }),
      }),
      expect.objectContaining({ type: 'error', message: '连接在响应完成前断开' }),
    ])
    expect(mapper.flush()).toEqual([])
  })

  test('Given compaction_end 带 errorMessage When 映射 Then 产出非终态 compact_failed 而非裸 error', () => {
    // 压缩失败是瞬时/可重试错误，Pi 的 willRetry 为真时会自动重试摘要或继续 agent 主循环。
    // 映射成裸 error 会让 orchestrator 收敛为 error 终态、渲染层把会话打成 stopped（压缩中断会话）。
    const events = mapPiEventToKilaEvents({
      type: 'compaction_end',
      reason: 'threshold',
      result: undefined,
      aborted: false,
      willRetry: true,
      errorMessage: 'summary provider rate limited',
    } as any)

    expect(events).toEqual([{
      type: 'compact_failed',
      message: expect.any(String),
      willRetry: true,
      reason: 'threshold',
    }])
    // 关键不变量：绝不产出裸 error 终态
    expect(events.some((e) => e.type === 'error')).toBe(false)
  })

  test('Given compaction_end 的 noop 文案 When 映射 Then 仍走 compact_noop 良性分支', () => {
    const events = mapPiEventToKilaEvents({
      type: 'compaction_end',
      reason: 'manual',
      result: undefined,
      aborted: false,
      willRetry: false,
      errorMessage: 'Nothing to compact',
    } as any)

    expect(events).toEqual([{ type: 'compact_noop', message: expect.any(String) }])
  })

  test('Given message_end 的 toolUse stopReason When 直接映射 Then 标记为中间文本', () => {
    const events = mapPiEventToKilaEvents({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '调用工具前的说明' }],
        stopReason: 'toolUse',
        usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
      },
    } as any)

    expect(events).toEqual([
      expect.objectContaining({ type: 'usage_update' }),
      expect.objectContaining({ type: 'text_complete', isIntermediate: true }),
    ])
  })
})
