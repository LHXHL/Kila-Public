import { describe, expect, test } from 'bun:test'
import type { ProviderDbModel, ProviderDbProvider } from '@kila/shared'
import { pickBestGlobalHit } from './provider-db-loader'

/** 构造最小可用 provider + model 测试数据。 */
function hit(providerId: string, context: number): { provider: ProviderDbProvider; model: ProviderDbModel } {
  return {
    provider: { id: providerId, models: [] } as ProviderDbProvider,
    model: { id: 'test-model', limit: { context } } as ProviderDbModel,
  }
}

describe('Provider DB 全局兜底命中选择', () => {
  test('Given 同时命中官方与聚合商 When 选择 Then 优先官方 entry', () => {
    // gpt-5.4 场景：abacus(聚合)报 400K，openai(官方)报 1050K
    const hits = [hit('abacus', 400000), hit('openai', 1050000), hit('aihubmix', 400000)]

    const best = pickBestGlobalHit(hits)

    expect(best?.provider.id).toBe('openai')
    expect(best?.model.limit?.context).toBe(1050000)
  })

  test('Given 官方 provider 中窗口不一 When 选择 Then 取官方里最大 context', () => {
    // 极端场景：两个官方 provider 报不同窗口，取最大避免过早压缩
    const hits = [hit('openai', 1050000), hit('openai-mirror', 200000)]

    const best = pickBestGlobalHit(hits)

    expect(best?.model.limit?.context).toBe(1050000)
  })

  test('Given 仅聚合商命中 When 选择 Then 取所有命中的最大 context', () => {
    // 无官方 entry 时退化为最大值兜底
    const hits = [hit('abacus', 400000), hit('vivgrid', 256000), hit('aihubmix', 400000)]

    const best = pickBestGlobalHit(hits)

    expect(best?.model.limit?.context).toBe(400000)
  })

  test('Given 官方 entry 缺失 context When 选择 Then 仍优先官方（拿准确能力画像）', () => {
    // 官方优先目的是拿模型原生能力（reasoning/vision 等），context 只是其中一项。
    // 极端场景下官方 entry 即使无 context，也优先于聚合商——真实 DB 里官方 entry 都有 context。
    const noWindow = {
      provider: { id: 'openai', models: [] } as ProviderDbProvider,
      model: { id: 'x', limit: {} } as ProviderDbModel, // context 缺失
    }
    const aggregate = hit('abacus', 200000)
    const best = pickBestGlobalHit([noWindow, aggregate])

    expect(best?.provider.id).toBe('openai')
  })

  test('Given 空命中列表 When 选择 Then 返回 undefined', () => {
    expect(pickBestGlobalHit([])).toBeUndefined()
  })

  test('Given 单个命中 When 选择 Then 直接返回该命中', () => {
    const single = hit('openai', 128000)
    expect(pickBestGlobalHit([single])).toBe(single)
  })

  test('Given step-3.7-flash 多官方命中 When 选择 Then 取官方 stepfun 的窗口', () => {
    // 用户实际场景：step 系列在多个 stepfun 官方 provider 下，窗口一致取其一
    const hits = [
      hit('stepfun-step-plan', 256000),
      hit('stepfun-ai', 256000),
      hit('aihubmix', 256000),
    ]

    const best = pickBestGlobalHit(hits)

    expect(best?.model.limit?.context).toBe(256000)
    // 选中的应是官方 stepfun 系列而非聚合商 aihubmix
    expect(best?.provider.id).not.toBe('aihubmix')
  })
})
