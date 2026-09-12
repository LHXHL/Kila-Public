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

  test('Given 未知网关 When 推断 Then 保守注入 supportsDeveloperRole=false（回归：TokenRouter 流式拒绝 developer role）', () => {
    // https://api.tokenrouter.com/v1 + reasoning 模型：pi-ai 自动探测会发出 developer role，
    // 其网关流式校验拒绝该 role 返 400，必须保守发 system
    const compat = inferPiModelCompat(
      { provider: 'my-gateway', baseUrl: 'https://gw.example.com/v1' },
      'some-model',
      'openai-completions',
    )
    expect(compat).toMatchObject({ supportsDeveloperRole: false })
  })

  test('Given TokenRouter 网关 + reasoning 模型 When 推断 Then 不发 developer role', () => {
    const compat = inferPiModelCompat(
      { provider: 'openai', baseUrl: 'https://api.tokenrouter.com/v1' },
      'z-ai/glm-5.3-free',
      'openai-completions',
    )
    expect(compat).toMatchObject({ supportsDeveloperRole: false })
  })

  test('Given OpenAI 官方端点 When 推断 Then 返回 undefined 交给 Pi 自动探测', () => {
    const compat = inferPiModelCompat(
      { provider: 'openai', baseUrl: 'https://api.openai.com/v1' },
      'gpt-5.5',
      'openai-completions',
    )
    expect(compat).toBeUndefined()
  })

  test('Given URL 路径或第三方域名包含 openai.com When 推断 Then 不误判为官方端点', () => {
    const pathCompat = inferPiModelCompat(
      { provider: 'custom', baseUrl: 'https://gateway.example/v1/openai.com' },
      'some-model',
      'openai-completions',
    )
    const hostnameCompat = inferPiModelCompat(
      { provider: 'custom', baseUrl: 'https://openai.com.gateway.example/v1' },
      'some-model',
      'openai-completions',
    )
    expect(pathCompat).toMatchObject({ supportsDeveloperRole: false })
    expect(hostnameCompat).toMatchObject({ supportsDeveloperRole: false })
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

  test('Given 官方 OpenAI 端点无覆盖 When 合并 Then 返回 undefined', () => {
    const merged = resolvePiModelCompat(
      { provider: 'openai', baseUrl: 'https://api.openai.com/v1' },
      'gpt-5.5',
      'openai-completions',
    )
    expect(merged).toBeUndefined()
  })
})
