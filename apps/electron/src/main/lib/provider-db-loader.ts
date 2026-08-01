/**
 * Provider DB 运行时加载器
 *
 * 启动时从 `resources/model-db/providers.json` 一次性加载到内存，
 * 提供按 providerId / modelId 的同步查询能力。
 *
 * 数据由构建时 `scripts/fetch-provider-db.ts` 落地，详见
 * `packages/shared/src/model-catalog/provider-db.ts` 的 schema。
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ProviderDbAggregate,
  ProviderDbModel,
  ProviderDbProvider,
} from '@kila/shared'
import { sanitizeProviderDbAggregate } from '@kila/shared'
import { createLogger } from './logger'

const log = createLogger('ProviderDB')

const EMPTY_AGGREGATE: ProviderDbAggregate = { providers: {} }

let cache: ProviderDbAggregate | null = null

function resolveDbPath(): string {
  return join(__dirname, 'resources', 'model-db', 'providers.json')
}

/**
 * 加载 providers.json 到内存；多次调用只读一次磁盘。
 *
 * 防线：文件不存在 / JSON 损坏 / sanitize 失败 → 返回空 aggregate，
 * 调用方按需回退到内置目录。
 */
export function loadProviderDb(): ProviderDbAggregate {
  if (cache) return cache

  const dbPath = resolveDbPath()
  if (!existsSync(dbPath)) {
    log.warn(`[ProviderDB] 未找到 ${dbPath}，回退到空 catalog`)
    cache = EMPTY_AGGREGATE
    return cache
  }

  try {
    const raw = readFileSync(dbPath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    const sanitized = sanitizeProviderDbAggregate(parsed)
    if (!sanitized) {
      log.warn('[ProviderDB] sanitize 后无有效 provider，回退到空 catalog')
      cache = EMPTY_AGGREGATE
      return cache
    }
    const providerCount = Object.keys(sanitized.providers).length
    const modelCount = Object.values(sanitized.providers).reduce(
      (acc, p) => acc + p.models.length,
      0,
    )
    log.info(`[ProviderDB] 加载完成 providers=${providerCount} models=${modelCount}`)
    cache = sanitized
    return cache
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log.error(`[ProviderDB] 加载失败: ${msg}`)
    cache = EMPTY_AGGREGATE
    return cache
  }
}

/** 重新加载（用于热更新 / 测试） */
export function reloadProviderDb(): ProviderDbAggregate {
  cache = null
  return loadProviderDb()
}

/** 获取所有 provider 的轻量摘要（不含 models，避免 IPC 序列化开销） */
export interface ProviderDbSummary {
  id: string
  name?: string
  displayName?: string
  api?: string
  doc?: string
  description?: string
  tags?: string[]
  modelCount: number
}

export function listProviderDbSummaries(): ProviderDbSummary[] {
  const db = loadProviderDb()
  return Object.values(db.providers).map((p) => ({
    id: p.id,
    name: p.name,
    displayName: p.display_name,
    api: p.api,
    doc: p.doc,
    description: p.description,
    tags: p.tags,
    modelCount: p.models.length,
  }))
}

/** 按 ID 查 provider；不存在返回 undefined */
export function getProviderById(providerId: string): ProviderDbProvider | undefined {
  const db = loadProviderDb()
  return db.providers[providerId]
}

/** 按 providerId + modelId 查模型；不存在返回 undefined */
export function lookupProviderDbModel(
  providerId: string,
  modelId: string,
): ProviderDbModel | undefined {
  const provider = getProviderById(providerId)
  if (!provider) return undefined
  return provider.models.find((m) => m.id === modelId)
}

/**
 * 模型原厂商的 provider id（用于全局兜底时优先选中）。
 *
 * 同一个 modelId 常在多个 provider 下出现，且 context 常不一致：原厂商报真实窗口，
 * 聚合商 / 中转商常限制得更小（如 gpt-5.4 在 openai 是 1050K，在 abacus 只有 400K）。
 * 全局兜底优先选原厂商，避免拿小窗口导致过早压缩；其次取所有命中的最大 context。
 * 这里只列「自家出模型」的厂商，不含 openrouter / aihubmix / siliconflow 等聚合商。
 */
const OFFICIAL_VENDOR_PROVIDER_IDS = new Set([
  'openai',
  'anthropic',
  'google',
  'gemini',
  'deepseek',
  'zai',
  'zhipu',
  'glm',
  'moonshot',
  'kimi',
  'qwen',
  'alibaba',
  'minimax',
  'baichuan',
  'yi',
  '01-ai',
  'stepfun',
  'xiaomi',
  'sensetime',
  'sensenova',
  'meta',
  'mistral',
  'cohere',
  'perplexity',
  'x-ai',
  'grok',
])

/** 取模型 context 窗口；缺失视为 0（参与最大值比较时不被选中）。 */
function modelContextWindow(model: ProviderDbModel): number {
  return model.limit?.context ?? 0
}

/**
 * 从一批全局命中里选出最可信的一条：原厂商优先，其次 context 最大。
 *
 * 原厂商 entry 反映模型原生能力（窗口、reasoning、vision），聚合商常缩限窗口；
 * 取最大 context 是聚合场景下的保守兜底——宁可不压，不可误压。
 */
export function pickBestGlobalHit(
  hits: Array<{ provider: ProviderDbProvider; model: ProviderDbModel }>,
): { provider: ProviderDbProvider; model: ProviderDbModel } | undefined {
  if (hits.length === 0) return undefined
  if (hits.length === 1) return hits[0]
  const official = hits.filter((hit) => OFFICIAL_VENDOR_PROVIDER_IDS.has(hit.provider.id))
  const pool = official.length > 0 ? official : hits
  return pool.reduce((best, hit) =>
    modelContextWindow(hit.model) > modelContextWindow(best.model) ? hit : best,
  )
}

/**
 * 跨 provider 全局搜模型（用于用户输入了 `gpt-4o-mini` 这种去前缀 ID 时）。
 *
 * 选择策略：原厂商 entry 优先（窗口 / 能力画像最准），其次取所有命中的最大 context。
 * 避免聚合商的小窗口 entry 导致 capabilityProviderId 配置不精确时误判窗口、过早压缩。
 * 先精确匹配，找不到再尝试 base id（去掉 `vendor/` 前缀）匹配。
 */
export function findProviderDbModel(
  modelId: string,
): { provider: ProviderDbProvider; model: ProviderDbModel } | undefined {
  const db = loadProviderDb()
  // 1. 精确匹配：收集全部命中，按官方优先 + 最大 context 选最佳
  const exactHits: Array<{ provider: ProviderDbProvider; model: ProviderDbModel }> = []
  for (const provider of Object.values(db.providers)) {
    const model = provider.models.find((m) => m.id === modelId)
    if (model) exactHits.push({ provider, model })
  }
  const bestExact = pickBestGlobalHit(exactHits)
  if (bestExact) return bestExact

  // 2. base id 匹配（去掉 vendor/ 前缀）
  const slashIndex = modelId.indexOf('/')
  if (slashIndex <= 0) return undefined
  const baseId = modelId.slice(slashIndex + 1)
  const baseHits: Array<{ provider: ProviderDbProvider; model: ProviderDbModel }> = []
  for (const provider of Object.values(db.providers)) {
    const model = provider.models.find((m) => {
      const mSlash = m.id.indexOf('/')
      const mBase = mSlash > 0 ? m.id.slice(mSlash + 1) : m.id
      return mBase === baseId
    })
    if (model) baseHits.push({ provider, model })
  }
  return pickBestGlobalHit(baseHits)
}
