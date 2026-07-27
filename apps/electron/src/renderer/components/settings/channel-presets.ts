/**
 * 渠道预设
 *
 * 双轨制：
 * 1. 快捷预设（QUICK_PRESETS）— 三个头部 provider 的一键入口，写死 baseUrl，
 *    保证 DB 缺失/加载失败时仍可用，避免空状态。
 * 2. DB 驱动预设（loadDbPresets）— 从主进程 listProviderDbSummaries() 动态拉取，
 *    覆盖 PPC 上游所有聚合商/小厂 provider，按字母排序展示。
 *
 * 选择 preset 时同步填充：
 * - provider：用于调用协议选择（旧字段，保留兼容）
 * - apiType：新协议字段（anthropic/openai/google/...）
 * - capabilityProviderId：DB provider id，用于 capabilities 查询
 * - baseUrl：来自 DB.api，用户可改
 */

import type { TFunction } from 'i18next'
import {
  PROVIDER_DEFAULT_URLS,
  inferApiTypeFromProvider,
} from '@kila/shared'
import type { ApiType, ChannelModel, ProviderType } from '@kila/shared'

export interface ChannelPreset {
  id: string
  name: string
  /** 旧 provider 字段，仍用于 fetchModels/testChannel 等老接口 */
  provider: ProviderType
  /** 新协议字段，决定 adapter 选择 */
  apiType?: ApiType
  /** 引用 Provider DB 的 ID，用于查询模型能力 */
  capabilityProviderId?: string
  baseUrl: string
  models: ChannelModel[]
  searchTerms?: string[]
  iconProvider?: ProviderType
  description?: string
  /** 内置预设的描述走翻译 key，渲染时再解析 */
  descriptionKey?: string
  /** 是否来自 DB（动态加载），用于 UI 分组展示 */
  source?: 'builtin' | 'db'
}

/** 内置快捷预设：兜底入口，DB 加载失败时仍可见 */
export const QUICK_PRESETS: ChannelPreset[] = [
  {
    id: 'builtin-anthropic',
    name: 'Anthropic',
    provider: 'anthropic',
    apiType: 'anthropic',
    capabilityProviderId: 'anthropic',
    baseUrl: PROVIDER_DEFAULT_URLS.anthropic ?? '',
    models: [],
    searchTerms: ['claude', 'anthropic'],
    descriptionKey: 'settings.channel.preset.anthropic',
    source: 'builtin',
  },
  {
    id: 'builtin-openai',
    name: 'OpenAI',
    provider: 'openai',
    apiType: 'openai',
    capabilityProviderId: 'openai',
    baseUrl: PROVIDER_DEFAULT_URLS.openai ?? '',
    models: [],
    searchTerms: ['gpt', 'openai'],
    descriptionKey: 'settings.channel.preset.openai',
    source: 'builtin',
  },
  {
    id: 'builtin-google',
    name: 'Google Gemini',
    provider: 'google',
    apiType: 'google',
    capabilityProviderId: 'google',
    baseUrl: PROVIDER_DEFAULT_URLS.google ?? '',
    models: [],
    searchTerms: ['google', 'gemini'],
    descriptionKey: 'settings.channel.preset.google',
    source: 'builtin',
  },
]

/** DB summary 形状（与主进程 listProviderDbSummaries 返回值一致） */
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

/**
 * 将 DB provider summary 转为 ChannelPreset
 *
 * capabilityProviderId 直接用 DB id，用于后续能力查询；
 * provider 字段：DB id 命中内置白名单则用白名单值，否则 fallback 'custom'；
 * apiType 通过 inferApiTypeFromProvider 推导（DB id 通常等同于 provider 名）。
 */
export function dbSummaryToPreset(summary: ProviderDbSummary, t: TFunction): ChannelPreset {
  const provider: ProviderType = summary.id as ProviderType
  const apiType = inferApiTypeFromProvider(summary.id)
  return {
    id: `db-${summary.id}`,
    name: summary.displayName || summary.name || summary.id,
    provider,
    apiType,
    capabilityProviderId: summary.id,
    baseUrl: summary.api ?? '',
    models: [],
    searchTerms: [summary.id, summary.name ?? '', ...(summary.tags ?? [])].filter(Boolean) as string[],
    description: summary.description ?? t('settings.channel.preset.modelCount', { count: summary.modelCount }),
    source: 'db',
  }
}

/**
 * 兼容旧引用：CHANNEL_PRESETS 仅包含快捷预设，
 * DB 预设由 ChannelSettings 通过 listProviderDbSummaries() 动态加载并合并。
 */
export const CHANNEL_PRESETS: ChannelPreset[] = QUICK_PRESETS
