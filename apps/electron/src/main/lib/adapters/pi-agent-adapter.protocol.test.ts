import { describe, expect, test } from 'bun:test'
import { resolvePiApiType, resolvePiModelMetadata } from './pi-agent-adapter'

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


test('Given capabilityProviderId 命中的 Provider DB 模型画像, When 生成 Pi 模型元数据, Then DB 能力优先进入 Pi runtime', () => {
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

  expect(metadata.contextWindowTokens).toBe(512000)
  expect(metadata.maxOutputTokens).toBe(64000)
  expect(metadata.abilities).toMatchObject({
    tools: 'supported',
    vision: 'supported',
    reasoning: 'supported',
  })
})

import { createPiEventMapper, mapPiErrorMessageToKilaEvent, mapPiEventToKilaEvents } from './pi-agent-adapter'

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

  test('Given Pi 自动重试产生多个 agent_end When 最终 settled Then usage 包含失败与成功 run 且只保留最终终态', () => {
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
