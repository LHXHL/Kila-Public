/**
 * ChannelForm - 渠道编辑表单
 *
 * 支持创建和编辑渠道，包含：
 * - 基本信息（名称、供应商、Base URL、API Key）
 * - 模型列表编辑
 * - 连接测试
 *
 * 使用设置原语组件实现卡片化布局。
 */

import * as React from 'react'
import {
  Eye,
  EyeOff,
  Plus,
  X,
  Loader2,
  CheckCircle2,
  XCircle,
  Zap,
  Download,
  Search,
  ImageIcon,
  BrainCircuit,
  Wrench,
  FileText,
  Video,
  DollarSign,
  SlidersHorizontal,
  CheckSquare,
  Square,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { getStatusToneClasses } from '@/lib/theme/status-tone'
import { getModelLogo, isOpenAIModelLogo } from '@/lib/model-logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  PROVIDER_DEFAULT_URLS,
  PROVIDER_LABELS,
  resolveModelMetadata,
} from '@kila/shared'
import type {
  AbilityStatus,
  ApiType,
  Channel,
  ChannelCreateInput,
  ChannelModel,
  ChannelTestResult,
  FetchModelsResult,
  ModelAbilities,
  ModelMetadataOverride,
  ModelPricing,
  ProviderType,
} from '@kila/shared'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  SettingsSection,
  SettingsCard,
  SettingsInput,
  SettingsSelect,
  SettingsToggle,
} from './primitives'
import type { ChannelPreset } from './channel-presets'

interface ChannelFormProps {
  /** 编辑模式下传入已有渠道，创建模式传 null */
  channel: Channel | null
  /** 创建模式下可传入一个预设模板用于预填表单 */
  preset?: ChannelPreset | null
  onSaved: (channel: Channel) => void
  onCancel: () => void
  onDirtyChange?: (dirty: boolean) => void
  embedded?: boolean
}

/** 所有可选供应商（保留以兼容老数据，UI 不再展示此下拉） */
const PROVIDER_OPTIONS: ProviderType[] = [
  'anthropic',
  'openai',
  'deepseek',
  'google',
  'moonshot',
  'zhipu',
  'minimax',
  'doubao',
  'qwen',
  'custom',
]

/** 供应商选项（用于 SettingsSelect） */
const PROVIDER_SELECT_OPTIONS = PROVIDER_OPTIONS.map((p) => ({
  value: p,
  label: PROVIDER_LABELS[p] ?? p,
}))

/** API 协议选项（合并供应商类型后唯一可见的字段） */
const API_TYPE_OPTIONS: Array<{ value: ApiType; label: string; description: string }> = [
  { value: 'anthropic', label: 'Anthropic Messages', description: 'Claude 系列 / Anthropic 兼容' },
  { value: 'openai', label: 'OpenAI Chat Completions', description: 'OpenAI 兼容协议（最通用）' },
  { value: 'openai-responses', label: 'OpenAI Responses', description: 'OpenAI Responses API 新协议' },
  { value: 'google', label: 'Google Generative Language', description: 'Gemini 系列 / Google API' },
  { value: 'ollama', label: 'Ollama', description: 'Ollama 本地 API' },
  { value: 'custom', label: '自定义', description: '兜底：手动指定协议' },
]

/** API 协议的 Chat 端点路径，用于 Base URL 预览 */
const API_TYPE_CHAT_PATHS: Record<ApiType, string> = {
  anthropic: '/v1/messages',
  openai: '/chat/completions',
  'openai-responses': '/v1/responses',
  google: '/v1beta/models/{model}:generateContent',
  ollama: '/api/chat',
  custom: '/chat/completions',
}

type AbilityKey = keyof ModelAbilities
type PricingKey = keyof ModelPricing

const ABILITY_ITEMS: Array<{ key: AbilityKey; label: string; icon: React.ElementType }> = [
  { key: 'tools', label: '工具', icon: Wrench },
  { key: 'vision', label: '视觉', icon: ImageIcon },
  { key: 'video', label: '视频', icon: Video },
  { key: 'reasoning', label: '推理', icon: BrainCircuit },
  { key: 'fileInput', label: '文件', icon: FileText },
]

const PRICING_ITEMS: Array<{ key: PricingKey; label: string }> = [
  { key: 'inputPerMillionUsd', label: '输入 $/1M' },
  { key: 'outputPerMillionUsd', label: '输出 $/1M' },
  { key: 'cacheReadPerMillionUsd', label: '缓存读 $/1M' },
  { key: 'cacheWritePerMillionUsd', label: '缓存写 $/1M' },
]

const ABILITY_STATUS_LABELS: Record<AbilityStatus, string> = {
  supported: '支持',
  unsupported: '不支持',
  unknown: '未知',
}

/**
 * 生成 API 端点预览 URL
 *
 * 按 apiType（优先）或 provider（兜底）决定路径。
 * Anthropic 特殊处理：如果 baseUrl 已包含 /v1，则不重复添加。
 */
function buildPreviewUrl(baseUrl: string, apiType: ApiType | undefined, provider: ProviderType): string {
  let trimmed = baseUrl.trim().replace(/\/+$/, '')
  const effectiveType = apiType ?? provider

  if (effectiveType === 'anthropic') {
    // 去除用户误填的 /messages 后缀，与 normalizeAnthropicBaseUrl 保持一致
    trimmed = trimmed.replace(/\/messages$/, '')
    if (trimmed.match(/\/v\d+$/)) {
      return `${trimmed}/messages`
    }
    return `${trimmed}/v1/messages`
  }

  return `${trimmed}${API_TYPE_CHAT_PATHS[effectiveType as ApiType] ?? API_TYPE_CHAT_PATHS.custom}`
}

function parsePositiveNumber(rawValue: string): number | undefined {
  const trimmed = rawValue.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function compactMetadataOverride(override: ModelMetadataOverride): ModelMetadataOverride | undefined {
  const next: ModelMetadataOverride = {
    ...override,
    abilities: Object.keys(override.abilities ?? {}).length > 0 ? override.abilities : undefined,
    pricing: Object.keys(override.pricing ?? {}).length > 0 ? override.pricing : undefined,
  }

  if (next.contextWindowTokens === undefined) delete next.contextWindowTokens
  if (next.maxOutputTokens === undefined) delete next.maxOutputTokens
  if (!next.abilities) delete next.abilities
  if (!next.pricing) delete next.pricing

  return Object.keys(next).length > 0 ? next : undefined
}

function formatTokenCount(value: number | undefined): string {
  if (!value) return '未知'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(value)
}

function formatModelPrice(pricing: ModelPricing | undefined): string {
  const input = pricing?.inputPerMillionUsd ?? pricing?.inputPerMillion
  const output = pricing?.outputPerMillionUsd ?? pricing?.outputPerMillion
  if (input === undefined && output === undefined) return '未配置价格'
  const symbol = pricing?.currency === 'CNY' ? '¥' : '$'
  return `${symbol}${input ?? '-'} / ${symbol}${output ?? '-'}`
}

function buildInitialFormState(
  channel: Channel | null,
  preset: ChannelPreset | null,
): {
  name: string
  provider: ProviderType
  apiType: ApiType | ''
  capabilityProviderId: string
  baseUrl: string
  models: ChannelModel[]
  enabled: boolean
} {
  return {
    name: channel?.name ?? preset?.name ?? '',
    provider: channel?.provider ?? preset?.provider ?? 'anthropic',
    apiType: channel?.apiType ?? preset?.apiType ?? '',
    capabilityProviderId: channel?.capabilityProviderId ?? preset?.capabilityProviderId ?? '',
    baseUrl: channel?.baseUrl ?? preset?.baseUrl ?? PROVIDER_DEFAULT_URLS.anthropic ?? "",
    models: channel?.models ?? preset?.models ?? [],
    enabled: channel?.enabled ?? true,
  }
}


export default function ChannelForm({ channel, preset, onSaved, onCancel, onDirtyChange, embedded = false }: ChannelFormProps) {
  const isEdit = channel !== null
  const formIdentity = isEdit ? channel.id : preset?.id ?? 'new'
  const initialFormState = React.useMemo(
    () => buildInitialFormState(channel, preset ?? null),
    [channel, preset],
  )

  // 表单状态
  const [name, setName] = React.useState(initialFormState.name)
  const [provider, setProvider] = React.useState<ProviderType>(initialFormState.provider)
  const [apiType, setApiType] = React.useState<ApiType | ''>(initialFormState.apiType)
  const [capabilityProviderId, setCapabilityProviderId] = React.useState<string>(initialFormState.capabilityProviderId)
  const [baseUrl, setBaseUrl] = React.useState(initialFormState.baseUrl)
  const [apiKey, setApiKey] = React.useState('')
  const [apiKeyDirty, setApiKeyDirty] = React.useState(false)
  const [showApiKey, setShowApiKey] = React.useState(false)
  const [models, setModels] = React.useState<ChannelModel[]>(initialFormState.models)
  const [enabled, setEnabled] = React.useState(initialFormState.enabled)
  const [newModelId, setNewModelId] = React.useState('')
  const [newModelName, setNewModelName] = React.useState('')
  const [modelFilter, setModelFilter] = React.useState('')
  const [expandedModelId, setExpandedModelId] = React.useState<string | null>(null)

  // UI 状态
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<ChannelTestResult | null>(null)
  const [fetchingModels, setFetchingModels] = React.useState(false)
  const [fetchResult, setFetchResult] = React.useState<FetchModelsResult | null>(null)
  const [apiKeyLoaded, setApiKeyLoaded] = React.useState(false)
  const embeddedCardClass = embedded ? 'border-0 shadow-none' : ''
  const successTone = getStatusToneClasses('success')
  const dangerTone = getStatusToneClasses('danger')
  const missingBaseUrl = !baseUrl.trim()
  const canTestConnection = Boolean(apiKey.trim() && !missingBaseUrl)
  const canFetchModels = Boolean(apiKey.trim() && !missingBaseUrl)
  const canSave = Boolean(name.trim() && !missingBaseUrl && (isEdit || apiKey.trim()))

  const dirty = React.useMemo(() => (
    apiKeyDirty
    || name !== initialFormState.name
    || provider !== initialFormState.provider
    || apiType !== initialFormState.apiType
    || capabilityProviderId !== initialFormState.capabilityProviderId
    || baseUrl !== initialFormState.baseUrl
    || enabled !== initialFormState.enabled
    || JSON.stringify(models) !== JSON.stringify(initialFormState.models)
  ), [
    apiKeyDirty,
    apiType,
    baseUrl,
    capabilityProviderId,
    enabled,
    initialFormState,
    models,
    name,
    provider,
  ])

  React.useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  React.useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  React.useEffect(() => {
    setName(initialFormState.name)
    setProvider(initialFormState.provider)
    setApiType(initialFormState.apiType)
    setCapabilityProviderId(initialFormState.capabilityProviderId)
    setBaseUrl(initialFormState.baseUrl)
    setApiKey('')
    setApiKeyDirty(false)
    setShowApiKey(false)
    setModels(initialFormState.models)
    setEnabled(initialFormState.enabled)
    setNewModelId('')
    setNewModelName('')
    setModelFilter('')
    setExpandedModelId(null)
    setSaving(false)
    setTesting(false)
    setTestResult(null)
    setFetchingModels(false)
    setFetchResult(null)
    setApiKeyLoaded(false)
  }, [formIdentity, initialFormState])

  // 编辑模式下加载明文 API Key
  React.useEffect(() => {
    if (isEdit && channel && !apiKeyLoaded) {
      window.electronAPI.decryptApiKey(channel.id).then((key) => {
        setApiKey(key)
        setApiKeyLoaded(true)
      }).catch((error) => {
        console.error('[渠道表单] 解密 API Key 失败:', error)
        setApiKeyLoaded(true)
      })
    }
  }, [apiKeyLoaded, channel, isEdit])

  // 切换供应商时自动更新 Base URL
  const handleProviderChange = (newProvider: string): void => {
    const p = newProvider as ProviderType
    setProvider(p)
    setBaseUrl(PROVIDER_DEFAULT_URLS[p] ?? "")
    // 内置 provider 同步刷 capabilityProviderId；聚合商等不自动覆盖
    if (p !== 'custom') {
      setCapabilityProviderId(p)
    }
    setTestResult(null)
    setFetchResult(null)
    // 切换供应商意味着旧模型几乎一定不再适用，清空避免跨供应商累积
    setModels([])
    setExpandedModelId(null)
  }

  /**
   * 切换 apiType：合并字段后的唯一协议入口
   *
   * provider 字段从 capabilityProviderId 自动推导：
   * - 内置白名单命中 → 用 provider id
   * - 否则 fallback 'custom'（adapter 会按 apiType 走对应协议）
   */
  const handleApiTypeChange = (next: string): void => {
    const nextApiType = next as ApiType
    setApiType(nextApiType)
    // 无 capabilityProviderId 时联动 provider + baseUrl（从预设选的 preset 已自带）
    if (!capabilityProviderId && PROVIDER_OPTIONS.includes(nextApiType as ProviderType)) {
      setProvider(nextApiType as ProviderType)
      setCapabilityProviderId(nextApiType)
      setBaseUrl(PROVIDER_DEFAULT_URLS[nextApiType] ?? "")
      setTestResult(null)
      setFetchResult(null)
      setModels([])
      setExpandedModelId(null)
    }
  }

  /** 添加模型 */
  const handleAddModel = (): void => {
    if (!newModelId.trim()) return

    const model: ChannelModel = {
      id: newModelId.trim(),
      name: newModelName.trim() || newModelId.trim(),
      enabled: true,
    }

    setModels((prev) => [...prev, model])
    setNewModelId('')
    setNewModelName('')
  }

  /** 删除模型 */
  const handleRemoveModel = (modelId: string): void => {
    setModels((prev) => prev.filter((m) => m.id !== modelId))
  }

  /** 切换模型启用状态 */
  const handleToggleModel = (modelId: string): void => {
    setModels((prev) =>
      prev.map((m) => (m.id === modelId ? { ...m, enabled: !m.enabled } : m))
    )
  }

  const updateModelMetadataOverride = (
    modelId: string,
    updater: (override: ModelMetadataOverride) => ModelMetadataOverride,
  ): void => {
    setModels((prev) =>
      prev.map((m) => {
        if (m.id !== modelId) return m
        const nextOverride = compactMetadataOverride(updater(m.metadataOverride ?? {}))
        return {
          ...m,
          metadataOverride: nextOverride,
          capabilities: undefined,
        }
      })
    )
  }

  const handleSetAbility = (modelId: string, key: AbilityKey, value: AbilityStatus): void => {
    updateModelMetadataOverride(modelId, (override) => ({
      ...override,
      abilities: {
        ...(override.abilities ?? {}),
        [key]: value,
      },
    }))
  }

  const handleSetNumberOverride = (
    modelId: string,
    key: 'contextWindowTokens' | 'maxOutputTokens',
    rawValue: string,
  ): void => {
    const value = parsePositiveNumber(rawValue)
    updateModelMetadataOverride(modelId, (override) => ({
      ...override,
      [key]: value,
    }))
  }

  const handleSetPricing = (modelId: string, key: PricingKey, rawValue: string): void => {
    const value = parsePositiveNumber(rawValue)
    updateModelMetadataOverride(modelId, (override) => ({
      ...override,
      pricing: {
        ...(override.pricing ?? {}),
        [key]: value,
      },
    }))
  }

  /** 从供应商 API 拉取可用模型列表 */
  const handleFetchModels = async (): Promise<void> => {
    if (!canFetchModels) return

    setFetchingModels(true)
    setFetchResult(null)

    try {
      const result = await window.electronAPI.fetchModels({
        provider,
        baseUrl,
        apiKey,
      })

      setFetchResult(result)

      if (result.success && result.models.length > 0) {
        // 以拉取结果为基准，仅保留交集模型的已有启用状态；新模型默认启用
        const prevEnabled = new Map(models.map((m) => [m.id, m.enabled]))
        const merged = result.models.map((m) => ({
          ...m,
          enabled: prevEnabled.get(m.id) ?? true,
        }))
        setModels(merged)
      }
    } catch (error) {
      setFetchResult({ success: false, message: '拉取模型请求失败', models: [] })
    } finally {
      setFetchingModels(false)
    }
  }

  /** 测试连接（直接使用表单当前值，无需先保存） */
  const handleTest = async (): Promise<void> => {
    if (!canTestConnection) return

    setTesting(true)
    setTestResult(null)

    try {
      const result = await window.electronAPI.testChannelDirect({
        provider,
        baseUrl,
        apiKey,
      })
      setTestResult(result)
    } catch (error) {
      setTestResult({ success: false, message: '测试请求失败' })
    } finally {
      setTesting(false)
    }
  }

  /** 保存渠道 */
  const saveChannel = async (): Promise<Channel> => {
    // 提交时剔除空字符串字段
    const apiTypePayload = apiType || undefined
    const capIdPayload = capabilityProviderId.trim() || undefined

    if (isEdit && channel) {
      return window.electronAPI.updateChannel(channel.id, {
        name,
        provider,
        apiType: apiTypePayload,
        capabilityProviderId: capIdPayload,
        baseUrl,
        apiKey: apiKey || undefined,
        models,
        enabled,
      })
    } else {
      const input: ChannelCreateInput = {
        name,
        provider,
        apiType: apiTypePayload,
        capabilityProviderId: capIdPayload,
        baseUrl,
        apiKey,
        models,
        enabled,
      }
      return window.electronAPI.createChannel(input)
    }
  }

  /** 提交表单 */
  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()

    if (!canSave) return

    setSaving(true)
    try {
      const savedChannel = await saveChannel()
      onSaved(savedChannel)
    } catch (error) {
      console.error('[渠道表单] 保存失败:', error)
    } finally {
      setSaving(false)
    }
  }

  // 过滤并排序模型列表：已启用的排前面，再按搜索词过滤
  const filteredModels = React.useMemo(() => {
    const sorted = [...models].sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
      return 0
    })
    if (!modelFilter.trim()) return sorted
    const keyword = modelFilter.trim().toLowerCase()
    return sorted.filter(
      (m) => m.id.toLowerCase().includes(keyword) || m.name.toLowerCase().includes(keyword)
    )
  }, [models, modelFilter])

  /** 全选 / 取消全选（按过滤后的模型列表） */
  const allFilteredEnabled = models.length > 0 && filteredModels.length > 0 && filteredModels.every((m) => m.enabled)
  const handleToggleAllModels = (): void => {
    const target = !allFilteredEnabled
    const filteredIds = new Set(filteredModels.map((m) => m.id))
    setModels((prev) =>
      prev.map((m) => (filteredIds.has(m.id) ? { ...m, enabled: target } : m))
    )
  }

  return (
    <form onSubmit={handleSubmit} className={cn('space-y-6', embedded && 'space-y-4')}>
      {/* 基本信息卡片 */}
      <SettingsSection title="基本信息">
        <SettingsCard className={embeddedCardClass}>
          <SettingsInput
            label="渠道名称"
            value={name}
            onChange={setName}
            placeholder="例如: My Anthropic"
            required
          />
          <SettingsSelect
            label="API 协议"
            value={apiType || (PROVIDER_OPTIONS.includes(provider) ? (provider as ApiType) : 'openai')}
            onValueChange={handleApiTypeChange}
            options={API_TYPE_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
            placeholder="选择 API 协议"
            description={(() => {
              const opt = API_TYPE_OPTIONS.find((o) => o.value === (apiType || provider))
              return opt?.description
            })()}
          />
          {capabilityProviderId && (
            <div className="px-4 py-1 text-xs text-muted-foreground">
              能力画像 Provider ID：<span className="font-mono">{capabilityProviderId}</span>
              {capabilityProviderId !== provider && provider !== 'custom' && (
                <span className="ml-2 text-muted-foreground/60">（供应商: {provider}）</span>
              )}
            </div>
          )}
          <SettingsInput
            label="Base URL"
            value={baseUrl}
            onChange={setBaseUrl}
            placeholder="https://api.example.com"
            description={baseUrl.trim() ? `预览：${buildPreviewUrl(baseUrl, apiType || undefined, provider)}` : undefined}
          />
          {/* API Key + 测试连接同行 */}
          <div className="px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-foreground">API Key</div>
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={handleTest}
                disabled={testing || !canTestConnection}
                className="h-7 text-xs"
              >
                {testing ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Zap size={12} />
                )}
                <span>测试连接</span>
              </Button>
            </div>
            <div className="relative">
              <Input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value)
                  setApiKeyDirty(true)
                }}
                placeholder={isEdit ? '留空则不更新' : '输入 API Key'}
                required={!isEdit}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {testResult && (
              <div className={cn(
                'flex items-center gap-1.5 text-xs',
                testResult.success ? successTone.softText : dangerTone.softText,
              )}>
                {testResult.success ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                <span>{testResult.message}</span>
              </div>
            )}
          </div>
          <SettingsToggle
            label="启用此渠道"
            description="关闭后该渠道不会在模型选择中出现"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </SettingsCard>
      </SettingsSection>

      {/* 模型列表卡片 */}
      <SettingsSection
        title="模型列表"
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={handleToggleAllModels}
              disabled={models.length === 0}
              className="h-7 text-xs"
              title={allFilteredEnabled ? '取消全选' : '全选'}
            >
              {allFilteredEnabled ? <Square size={12} /> : <CheckSquare size={12} />}
              <span>{allFilteredEnabled ? '取消全选' : '全选'}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={handleFetchModels}
              disabled={fetchingModels || !canFetchModels}
              className="h-7 text-xs"
            >
              {fetchingModels ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Download size={12} />
              )}
              <span>从供应商获取</span>
            </Button>
          </div>
        }
      >
        {/* 拉取结果提示 */}
        {fetchResult && (
          <div className={cn(
            'flex items-center gap-1.5 text-xs px-1',
            fetchResult.success ? successTone.softText : dangerTone.softText,
          )}>
            {fetchResult.success ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
            <span>{fetchResult.message}</span>
          </div>
        )}

        <SettingsCard divided={false} className={embeddedCardClass}>
          {/* 模型搜索过滤 */}
          {models.length > 5 && (
            <div className="px-4 pt-3 pb-1">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={modelFilter}
                  onChange={(e) => setModelFilter(e.target.value)}
                  placeholder="搜索模型..."
                  className="h-8 text-sm pl-8"
                />
              </div>
            </div>
          )}

          {/* 模型计数 */}
          {models.length > 0 && (
            <div className="px-4 pt-2 pb-1 text-xs text-muted-foreground">
              {modelFilter.trim()
                ? `${filteredModels.length} / ${models.length} 个模型`
                : `${models.filter((m) => m.enabled).length} 个已启用，共 ${models.length} 个模型`}
            </div>
          )}

          <ScrollArea className={models.length > 8 ? 'h-[320px]' : undefined}>
            <div className="divide-y divide-border/50">
              {/* 已有模型列表（过滤 + 排序后） */}
              {filteredModels.map((model) => {
                const metadata = resolveModelMetadata({
                  channelProvider: provider,
                  channelBaseUrl: baseUrl,
                  modelId: model.id,
                  modelName: model.name,
                  metadataOverride: model.metadataOverride,
                  capabilitiesOverride: model.capabilities,
                })
                const isExpanded = expandedModelId === model.id

                return (
                  <div key={model.id} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={model.enabled}
                        onChange={() => handleToggleModel(model.id)}
                        className="mt-1 w-3.5 h-3.5 rounded border-input accent-foreground"
                      />
                      <img
                        src={getModelLogo(model.id, provider)}
                        alt={model.name}
                        className={cn(
                          'mt-0.5 size-5 rounded object-cover',
                          isOpenAIModelLogo(model.id, provider) && 'dark:invert',
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">{model.name}</span>
                          {metadata.deprecated && (
                            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              已弃用
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                          {model.id}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                            {formatTokenCount(metadata.contextWindowTokens)}
                          </span>
                          {ABILITY_ITEMS.map(({ key, label, icon: Icon }) => {
                            const status = metadata.abilities[key]
                            return (
                              <span
                                key={key}
                                className={cn(
                                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]',
                                  status === 'supported'
                                    ? 'bg-primary/10 text-primary'
                                    : status === 'unsupported'
                                      ? 'bg-muted text-muted-foreground/60'
                                      : 'bg-muted/70 text-muted-foreground',
                                )}
                              >
                                <Icon size={10} />
                                {label}
                              </span>
                            )
                          })}
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                            <DollarSign size={10} />
                            {formatModelPrice(metadata.pricing)}
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        onClick={() => setExpandedModelId(isExpanded ? null : model.id)}
                        className="h-7 w-7 flex-shrink-0"
                      >
                        <SlidersHorizontal size={14} />
                      </Button>
                      <button
                        type="button"
                        onClick={() => handleRemoveModel(model.id)}
                        className="mt-1 p-0.5 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="mt-3 rounded-md bg-muted/35 p-3">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className="space-y-1">
                            <span className="text-[11px] text-muted-foreground">上下文窗口</span>
                            <Input
                              type="number"
                              min={1}
                              value={model.metadataOverride?.contextWindowTokens ?? ''}
                              onChange={(e) => handleSetNumberOverride(model.id, 'contextWindowTokens', e.target.value)}
                              placeholder={metadata.contextWindowTokens ? String(metadata.contextWindowTokens) : '未知'}
                              className="h-8 text-xs"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-[11px] text-muted-foreground">最大输出</span>
                            <Input
                              type="number"
                              min={1}
                              value={model.metadataOverride?.maxOutputTokens ?? ''}
                              onChange={(e) => handleSetNumberOverride(model.id, 'maxOutputTokens', e.target.value)}
                              placeholder={metadata.maxOutputTokens ? String(metadata.maxOutputTokens) : '默认 32768'}
                              className="h-8 text-xs"
                            />
                          </label>
                        </div>

                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                          {ABILITY_ITEMS.map(({ key, label, icon: Icon }) => (
                            <label key={key} className="space-y-1">
                              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                <Icon size={11} />
                                {label}
                              </span>
                              <select
                                value={model.metadataOverride?.abilities?.[key] ?? metadata.abilities[key]}
                                onChange={(e) => handleSetAbility(model.id, key, e.target.value as AbilityStatus)}
                                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                              >
                                {(['supported', 'unsupported', 'unknown'] as AbilityStatus[]).map((status) => (
                                  <option key={status} value={status}>{ABILITY_STATUS_LABELS[status]}</option>
                                ))}
                              </select>
                            </label>
                          ))}
                        </div>

                        <div className="mt-3 grid gap-2 sm:grid-cols-4">
                          {PRICING_ITEMS.map(({ key, label }) => (
                            <label key={key} className="space-y-1">
                              <span className="text-[11px] text-muted-foreground">{label}</span>
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                value={model.metadataOverride?.pricing?.[key] ?? ''}
                                onChange={(e) => handleSetPricing(model.id, key, e.target.value)}
                                placeholder={metadata.pricing?.[key] !== undefined ? String(metadata.pricing[key]) : '-'}
                                className="h-8 text-xs"
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}

              {/* 搜索无结果提示 */}
              {modelFilter.trim() && filteredModels.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  未找到匹配的模型
                </div>
              )}
            </div>
          </ScrollArea>

          {/* 添加新模型 */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-t border-border/50">
            <Input
              value={newModelId}
              onChange={(e) => setNewModelId(e.target.value)}
              placeholder="模型 ID（如 claude-opus-4-6）"
              className="flex-1 h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAddModel()
                }
              }}
            />
            <Input
              value={newModelName}
              onChange={(e) => setNewModelName(e.target.value)}
              placeholder="显示名称（可选）"
              className="flex-1 h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAddModel()
                }
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              type="button"
              onClick={handleAddModel}
              disabled={!newModelId.trim()}
              className="h-8 w-8 flex-shrink-0"
            >
              <Plus size={18} />
            </Button>
          </div>
        </SettingsCard>
      </SettingsSection>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={onCancel}
        >
          取消
        </Button>
        <Button
          size="sm"
          type="submit"
          disabled={saving || !canSave}
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          <span>{isEdit ? '保存修改' : '创建供应商'}</span>
        </Button>
      </div>
    </form>
  )
}
