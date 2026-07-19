/**
 * Provider DB schema —— 来自 PublicProviderConf dist/all.json 的数据结构
 *
 * 构建时由 scripts/fetch-provider-db.ts 下载并 sanitize 后落地到
 * `apps/electron/resources/model-db/providers.json`。
 *
 * sanitize 白名单与 DeepChat 的 fetch-provider-db.mjs 保持一致，确保
 * 上游 schema 漂移时不会污染 Kila 运行时。
 */

import type {
  ExtraCapabilities,
  ExtraCapabilitiesReasoning,
  ReasoningMode,
  ReasoningVisibility,
} from './extra-capabilities'
import {
  REASONING_EFFORT_VALUES,
  REASONING_MODE_VALUES,
  REASONING_VERBOSITY_VALUES,
  REASONING_VISIBILITY_VALUES,
} from './extra-capabilities'

/** 模型类型 */
export type ProviderDbModelType = 'chat' | 'embedding' | 'rerank' | 'imageGeneration' | 'audio'

/** 输入/输出模态（文本/图像/音频/视频/pdf 等） */
export interface ProviderDbModalities {
  input?: string[]
  output?: string[]
}

/** 模型 token 限制 */
export interface ProviderDbLimit {
  context?: number
  output?: number
}

/** 模型单价（USD/1M tokens） */
export interface ProviderDbCost {
  input?: number
  output?: number
  cache_read?: number
  cache_write?: number
  [key: string]: unknown
}

/** 兼容旧 reasoning boolean / 新 reasoning 对象的统一形态 */
export interface ProviderDbReasoning {
  supported?: boolean
  default?: boolean
  budget?: {
    default?: number
    min?: number
    max?: number
  }
  effort?: string
  verbosity?: string
}

/** 联网搜索能力 */
export interface ProviderDbSearch {
  supported?: boolean
  default?: boolean
  forced_search?: boolean
  search_strategy?: string
}

/** 单个模型的 DB 记录 */
export interface ProviderDbModel {
  id: string
  name?: string
  display_name?: string
  family?: string
  modalities?: ProviderDbModalities
  limit?: ProviderDbLimit
  temperature?: boolean
  tool_call?: boolean
  reasoning?: ProviderDbReasoning
  extra_capabilities?: ExtraCapabilities
  search?: ProviderDbSearch
  attachment?: boolean
  open_weights?: boolean
  knowledge?: string
  release_date?: string
  last_updated?: string
  cost?: ProviderDbCost
  type?: ProviderDbModelType
}

/** 单个 provider 的 DB 记录 */
export interface ProviderDbProvider {
  id: string
  name?: string
  display_name?: string
  api?: string
  doc?: string
  env?: string[]
  description?: string
  tags?: string[]
  models: ProviderDbModel[]
}

/** dist/all.json 顶层结构 */
export interface ProviderDbAggregate {
  providers: Record<string, ProviderDbProvider>
}

// ===== sanitize 白名单 =====

const PROVIDER_ID_REGEX = /^[a-z0-9][a-z0-9-_]*$/
const MODEL_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9\-_.:/]*$/

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function sanitizeStringArray(value: unknown): string[] | undefined {
  if (isString(value)) {
    const trimmed = value.trim()
    return trimmed ? [trimmed] : undefined
  }
  if (!Array.isArray(value)) return undefined
  const values = value.filter((item): item is string => isString(item) && item.trim().length > 0)
  return values.length ? values : undefined
}

function sanitizeReasoningBudget(value: unknown): NonNullable<ExtraCapabilitiesReasoning['budget']> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const budget: Record<string, number | string> = {}
  for (const key of ['default', 'min', 'max', 'auto', 'off'] as const) {
    if (isFiniteNumber(raw[key])) budget[key] = raw[key] as number
  }
  if (isString(raw.unit)) budget.unit = raw.unit
  return Object.keys(budget).length ? budget : undefined
}

function sanitizeReasoningOptions(
  value: unknown,
  allowed: readonly string[],
): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const values = value.filter(
    (item): item is string => isString(item) && allowed.includes(item),
  )
  return values.length ? values : undefined
}

function sanitizeExtraReasoning(value: unknown): ExtraCapabilitiesReasoning | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const reasoning: ExtraCapabilitiesReasoning = {}

  if (isBoolean(raw.supported)) reasoning.supported = raw.supported
  if (isBoolean(raw.default_enabled)) reasoning.default_enabled = raw.default_enabled
  if (isString(raw.mode) && (REASONING_MODE_VALUES as readonly string[]).includes(raw.mode)) {
    reasoning.mode = raw.mode as ReasoningMode
  }

  const budget = sanitizeReasoningBudget(raw.budget)
  if (budget) reasoning.budget = budget

  if (isString(raw.effort) && (REASONING_EFFORT_VALUES as readonly string[]).includes(raw.effort)) {
    reasoning.effort = raw.effort
  }
  const effortOptions = sanitizeReasoningOptions(raw.effort_options, REASONING_EFFORT_VALUES)
  if (effortOptions) reasoning.effort_options = effortOptions

  if (
    isString(raw.verbosity) &&
    (REASONING_VERBOSITY_VALUES as readonly string[]).includes(raw.verbosity)
  ) {
    reasoning.verbosity = raw.verbosity
  }
  const verbosityOptions = sanitizeReasoningOptions(raw.verbosity_options, REASONING_VERBOSITY_VALUES)
  if (verbosityOptions) reasoning.verbosity_options = verbosityOptions

  if (isString(raw.level)) reasoning.level = raw.level
  const levelOptions = sanitizeStringArray(raw.level_options)
  if (levelOptions) reasoning.level_options = levelOptions

  if (isBoolean(raw.interleaved)) reasoning.interleaved = raw.interleaved
  if (isBoolean(raw.summaries)) reasoning.summaries = raw.summaries

  if (
    isString(raw.visibility) &&
    (REASONING_VISIBILITY_VALUES as readonly string[]).includes(raw.visibility)
  ) {
    reasoning.visibility = raw.visibility as ReasoningVisibility
  }

  const continuation = sanitizeStringArray(raw.continuation)
  if (continuation) reasoning.continuation = continuation
  const notes = sanitizeStringArray(raw.notes)
  if (notes) reasoning.notes = notes

  return Object.keys(reasoning).length ? reasoning : undefined
}

function sanitizeReasoning(value: unknown): ProviderDbReasoning | undefined {
  if (isBoolean(value)) return { supported: value }
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const out: ProviderDbReasoning = {}
  if (isBoolean(raw.supported)) out.supported = raw.supported
  if (isBoolean(raw.default)) out.default = raw.default
  if (raw.budget && typeof raw.budget === 'object') {
    const bd = raw.budget as Record<string, unknown>
    const budget: ProviderDbReasoning['budget'] = {}
    if (isFiniteNumber(bd.default)) budget.default = bd.default
    if (isFiniteNumber(bd.min)) budget.min = bd.min
    if (isFiniteNumber(bd.max)) budget.max = bd.max
    if (budget && Object.keys(budget).length) out.budget = budget
  }
  if (isString(raw.effort) && (REASONING_EFFORT_VALUES as readonly string[]).includes(raw.effort)) {
    out.effort = raw.effort
  }
  if (
    isString(raw.verbosity) &&
    (REASONING_VERBOSITY_VALUES as readonly string[]).includes(raw.verbosity)
  ) {
    out.verbosity = raw.verbosity
  }
  return Object.keys(out).length ? out : undefined
}

function sanitizeSearch(value: unknown): ProviderDbSearch | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const out: ProviderDbSearch = {}
  if (isBoolean(raw.supported)) out.supported = raw.supported
  if (isBoolean(raw.default)) out.default = raw.default
  if (isBoolean(raw.forced_search)) out.forced_search = raw.forced_search
  if (isString(raw.search_strategy)) out.search_strategy = raw.search_strategy
  return Object.keys(out).length ? out : undefined
}

function sanitizeModelType(value: unknown): ProviderDbModelType | undefined {
  if (!isString(value)) return undefined
  const normalized = value.toLowerCase().replace(/[_-]/g, '')
  if (normalized === 'chat') return 'chat'
  if (normalized === 'embedding') return 'embedding'
  if (normalized === 'rerank') return 'rerank'
  if (normalized === 'imagegeneration' || normalized === 'imagegen') return 'imageGeneration'
  return undefined
}

function sanitizeLimit(value: unknown): ProviderDbLimit | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const limit: ProviderDbLimit = {}
  if (isFiniteNumber(raw.context) && (raw.context as number) >= 0) limit.context = raw.context as number
  if (isFiniteNumber(raw.output) && (raw.output as number) >= 0) limit.output = raw.output as number
  return Object.keys(limit).length ? limit : undefined
}

function sanitizeModalities(value: unknown): ProviderDbModalities | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const input = Array.isArray(raw.input)
    ? raw.input.filter((v): v is string => isString(v))
    : undefined
  const output = Array.isArray(raw.output)
    ? raw.output.filter((v): v is string => isString(v))
    : undefined
  if (!input && !output) return undefined
  return { input, output }
}

function sanitizeModel(raw: unknown): ProviderDbModel | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  const id = m.id
  if (!isString(id) || !MODEL_ID_REGEX.test(id)) return null

  const extraReasoning =
    m.extra_capabilities && typeof m.extra_capabilities === 'object'
      ? sanitizeExtraReasoning((m.extra_capabilities as Record<string, unknown>).reasoning)
      : undefined

  const model: ProviderDbModel = {
    id,
    name: isString(m.name) ? m.name : undefined,
    display_name: isString(m.display_name) ? m.display_name : undefined,
    modalities: sanitizeModalities(m.modalities),
    limit: sanitizeLimit(m.limit),
    temperature: isBoolean(m.temperature) ? m.temperature : undefined,
    tool_call: isBoolean(m.tool_call) ? m.tool_call : undefined,
    reasoning: sanitizeReasoning(m.reasoning),
    extra_capabilities: extraReasoning ? { reasoning: extraReasoning } : undefined,
    search: sanitizeSearch(m.search),
    attachment: isBoolean(m.attachment) ? m.attachment : undefined,
    open_weights: isBoolean(m.open_weights) ? m.open_weights : undefined,
    knowledge: isString(m.knowledge) ? m.knowledge : undefined,
    release_date: isString(m.release_date) ? m.release_date : undefined,
    last_updated: isString(m.last_updated) ? m.last_updated : undefined,
    cost: m.cost && typeof m.cost === 'object' ? (m.cost as ProviderDbCost) : undefined,
    type: sanitizeModelType(m.type),
  }

  // 清掉 undefined 字段，减小磁盘和内存占用
  for (const key of Object.keys(model) as (keyof ProviderDbModel)[]) {
    if (model[key] === undefined) {
      delete model[key]
    }
  }

  return model
}

function sanitizeProvider(key: string, raw: unknown): ProviderDbProvider | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  const id = isString(p.id) ? p.id : key
  if (!isString(id) || id !== id.toLowerCase() || !PROVIDER_ID_REGEX.test(id) || id !== key) {
    return null
  }

  const rawModels = Array.isArray(p.models) ? p.models : []
  const models: ProviderDbModel[] = []
  for (const rawModel of rawModels) {
    const sanitized = sanitizeModel(rawModel)
    if (sanitized) models.push(sanitized)
  }
  if (models.length === 0) return null

  const env = Array.isArray(p.env) ? p.env.filter((v): v is string => isString(v)) : undefined

  const provider: ProviderDbProvider = {
    id,
    name: isString(p.name) ? p.name : undefined,
    display_name: isString(p.display_name) ? p.display_name : undefined,
    api: isString(p.api) ? p.api : undefined,
    doc: isString(p.doc) ? p.doc : undefined,
    env: env && env.length ? env : undefined,
    description: isString(p.description) ? p.description : undefined,
    tags: sanitizeStringArray(p.tags),
    models,
  }

  for (const key2 of Object.keys(provider) as (keyof ProviderDbProvider)[]) {
    if (provider[key2] === undefined) {
      delete provider[key2]
    }
  }

  return provider
}

/**
 * 对原始 all.json 做 sanitize + 白名单过滤
 *
 * @returns sanitize 后的聚合对象；若没有有效 provider 返回 null
 */
export function sanitizeProviderDbAggregate(raw: unknown): ProviderDbAggregate | null {
  if (!raw || typeof raw !== 'object') return null
  const providersRaw = (raw as Record<string, unknown>).providers
  if (!providersRaw || typeof providersRaw !== 'object' || Array.isArray(providersRaw)) {
    return null
  }

  const out: ProviderDbAggregate = { providers: {} }
  for (const [key, value] of Object.entries(providersRaw as Record<string, unknown>)) {
    const sanitized = sanitizeProvider(key, value)
    if (sanitized) out.providers[sanitized.id] = sanitized
  }

  return Object.keys(out.providers).length > 0 ? out : null
}
