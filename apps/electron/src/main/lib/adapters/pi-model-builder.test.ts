import { describe, expect, test } from 'bun:test'
import { inferPiModelCompat, resolvePiModelCompat } from './pi-model-builder'

const openrouterChannel = {
  provider: 'custom',
  baseUrl: 'https://openrouter.ai/api/v1',
  capabilityProviderId: undefined,
}

describe('Pi model compat 推断', () => {
  test('Given openai-completions + OpenRouter When 推断 Then 注入 openrouter 亲和与 thinking 格式', () => {
    const compat = inferPiModelCompat(openrouterChannel, 'some-model', 'openai-completions')
    expect(compat).toMatchObject({
      thinkingFormat: 'openrouter',
      supportsDeveloperRole: false,
      sessionAffinityFormat: 'openrouter',
      sendSessionAffinityHeaders: true,
    })
  })

  test('Given openai-responses + OpenRouter When 推断 Then 不携带 completions 专属字段', () => {
    const compat = inferPiModelCompat(openrouterChannel, 'some-model', 'openai-responses')
    // responses API 没有 sendSessionAffinityHeaders / thinkingFormat，必须按 api 分支构造
    expect(compat).not.toHaveProperty('sendSessionAffinityHeaders')
    expect(compat).not.toHaveProperty('thinkingFormat')
  })

  test('Given OpenRouter 上的 anthropic/* 模型 When 推断 Then 使用 anthropic cache_control', () => {
    const compat = inferPiModelCompat(openrouterChannel, '~anthropic/claude-sonnet-5', 'openai-completions')
    expect(compat).toMatchObject({ cacheControlFormat: 'anthropic' })
  })

  test('Given 未知网关 When 推断 Then 返回 undefined 交给 Pi 自动探测', () => {
    const compat = inferPiModelCompat(
      { provider: 'my-gateway', baseUrl: 'https://gw.example.com/v1' },
      'some-model',
      'openai-completions',
    )
    expect(compat).toBeUndefined()
  })

  test('Given 渠道 compat 覆盖 When 合并 Then promptCacheRetention 不混入 Pi compat', () => {
    const merged = resolvePiModelCompat(
      openrouterChannel,
      'some-model',
      'openai-completions',
      { promptCacheRetention: 'long', supportsLongCacheRetention: false },
    )
    expect(merged).not.toHaveProperty('promptCacheRetention')
    expect(merged).toMatchObject({ supportsLongCacheRetention: false, sendSessionAffinityHeaders: true })
  })

  test('Given 无推断命中且无覆盖 When 合并 Then 返回 undefined', () => {
    const merged = resolvePiModelCompat(
      { provider: 'my-gateway', baseUrl: 'https://gw.example.com/v1' },
      'some-model',
      'openai-completions',
    )
    expect(merged).toBeUndefined()
  })
})
