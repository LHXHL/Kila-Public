/**
 * Pi 模型能力目录解析 —— 对齐 Proma 的单一数据源方案。
 *
 * context window / maxTokens 以 Pi SDK 内置模型 catalog 为准（`@earendil-works/pi-ai/compat`
 * 的 `getModel` / `getModels`），模型名推断规则（`@kila/shared` 的 `inferContextWindow`）作兜底，
 * 不再依赖 Provider DB / 内置目录 / provider 规则三套来源各自给数。
 *
 * 未知模型统一回 `DEFAULT_CONTEXT_WINDOW`（200K，宁高勿低，永不低估）；
 * maxTokens 回 `DEFAULT_MODEL_MAX_TOKENS`（64K），避免上游 output 脏数据直通。
 */

import type { Api, Model } from '@earendil-works/pi-ai'
import type { BuiltinProvider } from '@earendil-works/pi-ai/providers/all'
import {
  DEFAULT_CONTEXT_WINDOW,
  inferCodexAlignedGPT5ContextWindow,
  inferContextWindow,
  type Channel,
} from '@kila/shared'
import {
  inferProviderCandidates,
  loadPiAiCompat,
  modelIdCandidates,
  normalizeModelKey,
} from './model-pricing'

/** 未知模型的保守输出预算（token）。 */
export const DEFAULT_MODEL_MAX_TOKENS = 64_000

export interface PiCatalogModelHit {
  model: Model<Api>
  provider: string
}

/**
 * 从 Pi SDK 内置 catalog 查找模型。
 *
 * 与 `resolveModelCost` 同一套候选策略：先按渠道 provider / baseUrl 推断候选 provider，
 * 再枚举模型 ID 变体做精确命中；找不到则枚举 `getModels(provider)` 按归一化 key 匹配。
 */
export async function findPiCatalogModel(
  channel: Pick<Channel, 'provider' | 'baseUrl'>,
  modelId: string,
): Promise<PiCatalogModelHit | undefined> {
  const piAi = await loadPiAiCompat()
  const providers = inferProviderCandidates(channel.provider, channel.baseUrl, modelId)
  const ids = modelIdCandidates(modelId)

  for (const provider of providers) {
    for (const id of ids) {
      const model = piAi.getModel(provider as BuiltinProvider, id as never) as Model<Api> | undefined
      if (model) return { model, provider }
    }
  }

  for (const provider of providers) {
    const knownModels = piAi.getModels(provider as BuiltinProvider) as Model<Api>[]
    for (const candidateId of ids.map(normalizeModelKey)) {
      const model = knownModels.find((entry) => normalizeModelKey(entry.id) === candidateId)
      if (model) return { model, provider }
    }
  }

  return undefined
}

/**
 * 解析 Pi 模型的有效上下文窗口。
 *
 * 优先级：手动覆盖 > Codex 对齐窗口 > max(catalog 窗口, 模型名推断窗口) > 默认 200K。
 * 手动覆盖与 Codex 对齐优先于 catalog，保证用户显式配置与已验证能力不被 catalog 覆盖；
 * 其余情况取较大值，避免聚合商报的小窗口导致过早压缩。
 */
export async function resolvePiModelContextWindow(
  channel: Pick<Channel, 'provider' | 'baseUrl'>,
  modelId: string,
  manualOverride?: number,
): Promise<number> {
  if (manualOverride !== undefined && Number.isFinite(manualOverride) && manualOverride > 0) {
    return Math.round(manualOverride)
  }

  const codexAligned = inferCodexAlignedGPT5ContextWindow(modelId)
  if (codexAligned !== undefined) return codexAligned

  const catalogHit = await findPiCatalogModel(channel, modelId)
  const catalogWindow = catalogHit?.model.contextWindow ?? DEFAULT_CONTEXT_WINDOW
  const inferred = inferContextWindow(modelId) ?? DEFAULT_CONTEXT_WINDOW
  return Math.max(catalogWindow, inferred)
}

/**
 * 解析 Pi 模型的最大输出 token 数。
 *
 * 优先级：手动覆盖 > catalog 声明的 maxTokens > 默认 64K。
 * 不再透传 Provider DB / 内置目录的 output 字段，避免 deepseek 等上游把
 * `output: 384000` 这类远大于真实限值的脏数据直通运行时。
 */
export async function resolvePiModelMaxTokens(
  channel: Pick<Channel, 'provider' | 'baseUrl'>,
  modelId: string,
  manualOverride?: number,
): Promise<number> {
  if (manualOverride !== undefined && Number.isFinite(manualOverride) && manualOverride > 0) {
    return Math.round(manualOverride)
  }

  const catalogHit = await findPiCatalogModel(channel, modelId)
  return catalogHit?.model.maxTokens ?? DEFAULT_MODEL_MAX_TOKENS
}
