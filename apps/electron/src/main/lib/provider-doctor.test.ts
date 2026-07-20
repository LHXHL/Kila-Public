import { describe, expect, test } from 'bun:test'
import type { Api, AssistantMessage, Model } from '@earendil-works/pi-ai'
import { runProviderProbe } from './provider-doctor'

const model: Model<Api> = {
  id: 'test-model',
  name: 'Test Model',
  api: 'openai-responses',
  provider: 'test-provider',
  baseUrl: 'https://api.example.com',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32_000,
  maxTokens: 4_096,
}

function assistant(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'OK' }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
    ...overrides,
  }
}

const input = {
  channel: {
    provider: 'anthropic' as const,
    apiType: 'openai-responses' as const,
    baseUrl: 'https://api.example.com',
  },
  apiKey: 'test-key',
  modelId: model.id,
}

describe('Provider Doctor 真实推理探针', () => {
  test('Given 显式 Responses 协议 When 探针成功 Then 返回实际协议和模型', async () => {
    const result = await runProviderProbe(input, {
      buildModel: async (channel) => ({ ...model, api: channel.apiType === 'openai-responses' ? 'openai-responses' : 'anthropic-messages' }),
      createRuntime: async ({ model: runtimeModel }) => ({
        model: runtimeModel,
        modelRuntime: { completeSimple: async () => assistant() },
      }),
    })

    expect(result).toMatchObject({
      success: true,
      resolvedApi: 'openai-responses',
      modelId: 'test-model',
      message: '真实推理成功',
    })
  })

  test('Given 网关禁止 Messages 路由 When 真实生成返回 403 Then 诊断为权限不足', async () => {
    const result = await runProviderProbe(input, {
      buildModel: async () => ({ ...model, api: 'anthropic-messages' }),
      createRuntime: async ({ model: runtimeModel }) => ({
        model: runtimeModel,
        modelRuntime: {
          completeSimple: async () => assistant({
            api: 'anthropic-messages',
            stopReason: 'error',
            errorMessage: '403 This group does not allow /v1/messages dispatch',
          }),
        },
      }),
    })

    expect(result).toMatchObject({
      success: false,
      failureKind: 'permission_denied',
      statusCode: 403,
      resolvedApi: 'anthropic-messages',
    })
  })

  test('Given 发起探针 When 调用 runtime Then 仅发送单条消息且限制输出和重试', async () => {
    let capturedContext: unknown
    let capturedOptions: Record<string, unknown> | undefined

    await runProviderProbe(input, {
      buildModel: async () => model,
      createRuntime: async ({ model: runtimeModel }) => ({
        model: runtimeModel,
        modelRuntime: {
          completeSimple: async (_model, context, options) => {
            capturedContext = context
            capturedOptions = options as Record<string, unknown>
            return assistant()
          },
        },
      }),
    })

    expect(capturedContext).toMatchObject({
      messages: [{ role: 'user', content: 'Reply with OK.' }],
    })
    expect(capturedOptions).toMatchObject({
      maxTokens: 8,
      maxRetryDelayMs: 0,
    })
  })
})
