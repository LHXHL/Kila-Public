import { describe, expect, test } from 'bun:test'
import * as piAi from '@earendil-works/pi-ai'
import * as sdk from '@earendil-works/pi-coding-agent'
import type { Api, Model } from '@earendil-works/pi-ai'
import {
  createKilaModelRuntime,
  createKilaPiProviderId,
  updateKilaModelRuntimeApiKey,
} from './pi-model-runtime'

const model: Model<Api> = {
  id: 'test-model',
  name: 'Test Model',
  api: 'openai-completions',
  provider: 'openai',
  baseUrl: 'http://127.0.0.1:11434/v1',
  reasoning: true,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32_000,
  maxTokens: 4_096,
}

describe('Kila Pi ModelRuntime', () => {
  test('使用独立 providerId，不覆盖 Pi 内置 provider catalog', () => {
    expect(createKilaPiProviderId({ provider: 'openai', baseUrl: model.baseUrl })).toBe('kila-openai')
    expect(createKilaPiProviderId({ provider: 'custom', baseUrl: model.baseUrl })).toBe('kila-custom')
  })

  test('通过官方 CredentialStore + ModelRuntime 注册模型和认证', async () => {
    const runtime = await createKilaModelRuntime({
      piAi,
      sdk,
      channel: { provider: 'custom', baseUrl: model.baseUrl },
      model,
      apiKey: 'first-key',
    })

    expect(runtime.model.provider).toBe('kila-custom')
    expect(runtime.modelRuntime.getModel('kila-custom', model.id)?.baseUrl).toBe(model.baseUrl)
    expect((await runtime.modelRuntime.getAuth(runtime.model))?.auth.apiKey).toBe('first-key')

    await updateKilaModelRuntimeApiKey(runtime, 'rotated-key')
    expect((await runtime.modelRuntime.getAuth(runtime.model))?.auth.apiKey).toBe('rotated-key')
  })

  test('无密钥的本地兼容服务获得非外发配置语义的运行时占位凭据', async () => {
    const runtime = await createKilaModelRuntime({
      piAi,
      sdk,
      channel: { provider: 'custom', baseUrl: model.baseUrl },
      model,
      apiKey: '',
    })

    expect((await runtime.modelRuntime.getAuth(runtime.model))?.auth.apiKey).toBe('kila-local-no-auth')
  })
})
