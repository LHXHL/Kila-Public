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
 * 跨 provider 全局搜模型（用于用户输入了 `gpt-4o-mini` 这种去前缀 ID 时）。
 *
 * 优先精确匹配，找不到再尝试 base id（去掉 `vendor/` 前缀）匹配。
 */
export function findProviderDbModel(
  modelId: string,
): { provider: ProviderDbProvider; model: ProviderDbModel } | undefined {
  const db = loadProviderDb()
  // 1. 精确
  for (const provider of Object.values(db.providers)) {
    const model = provider.models.find((m) => m.id === modelId)
    if (model) return { provider, model }
  }
  // 2. base id 匹配（去掉 vendor/ 前缀）
  const slashIndex = modelId.indexOf('/')
  if (slashIndex <= 0) return undefined
  const baseId = modelId.slice(slashIndex + 1)
  for (const provider of Object.values(db.providers)) {
    const model = provider.models.find((m) => {
      const mSlash = m.id.indexOf('/')
      const mBase = mSlash > 0 ? m.id.slice(mSlash + 1) : m.id
      return mBase === baseId
    })
    if (model) return { provider, model }
  }
  return undefined
}
