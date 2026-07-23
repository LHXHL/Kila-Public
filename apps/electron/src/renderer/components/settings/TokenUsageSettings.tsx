import * as React from 'react'
import { BarChart3, Coins, DatabaseZap, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type {
  TokenUsageModelStat,
  TokenUsageProviderStat,
  TokenUsageSessionStat,
  TokenUsageStats,
} from '@kila/shared'
import { resolveModelMetadata } from '@kila/shared'
import type { AppSettings } from '../../../types'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SettingsCard, SettingsSection } from './primitives'

const RANGE_OPTIONS = [
  { value: 7, label: '7 天' },
  { value: 30, label: '30 天' },
  { value: 60, label: '60 天' },
] as const

const CHART_GRID_STROKE = 'hsl(var(--border) / 0.42)'
const CHART_INPUT_FILL = 'hsl(var(--chart-1))'
const CHART_OUTPUT_FILL = 'hsl(var(--chart-4))'

function formatInteger(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(Math.round(value))
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4,
  }).format(value)
}

function formatProviderName(provider: string): string {
  return provider === 'unknown' ? 'Unknown' : provider
}

function formatProviderLabel(item: { provider: string; providerLabel?: string; providerType?: string }): string {
  const label = item.providerLabel?.trim() || formatProviderName(item.provider)
  return item.providerType && item.providerType !== label ? `${label}` : label
}

function formatTokenWindow(value: number | undefined): string {
  if (!value) return '未知'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(value)
}

function formatModelUnitPrice(model: TokenUsageModelStat): { label: string; source: string } {
  const metadata = resolveModelMetadata({
    channelProvider: model.providerType ?? model.provider,
    channelBaseUrl: '',
    modelId: model.modelId,
  })
  const input = metadata.pricing?.inputPerMillionUsd ?? metadata.pricing?.inputPerMillion
  const output = metadata.pricing?.outputPerMillionUsd ?? metadata.pricing?.outputPerMillion
  const symbol = metadata.pricing?.currency === 'CNY' ? '¥' : '$'
  return {
    label: input !== undefined || output !== undefined ? `${symbol}${input ?? '-'} / ${symbol}${output ?? '-'}` : '未知',
    source: metadata.resolutionSources.pricing === 'builtin'
      ? `内置参考${metadata.catalogUpdatedAt ? ` · ${metadata.catalogUpdatedAt}` : ''}`
      : metadata.resolutionSources.pricing === 'manual'
        ? '用户设置'
        : '未配置',
  }
}

function getModelContextLabel(model: TokenUsageModelStat): { label: string; source: string } {
  const metadata = resolveModelMetadata({
    channelProvider: model.providerType ?? model.provider,
    channelBaseUrl: '',
    modelId: model.modelId,
  })
  return {
    label: formatTokenWindow(metadata.contextWindowTokens),
    source: metadata.resolutionSources.contextWindow === 'builtin'
      ? '内置'
      : metadata.resolutionSources.contextWindow === 'provider-rule'
        ? '规则'
        : metadata.resolutionSources.contextWindow === 'manual'
          ? '用户设置'
          : '默认值',
  }
}

function getCacheTokens(stat: TokenUsageStats['totals'] | TokenUsageModelStat | TokenUsageProviderStat): number {
  return stat.cacheReadTokens + stat.cacheCreationTokens
}

function formatPercent(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return '0%'
  return `${Math.round(value * 100)}%`
}

function MetricCard(input: {
  label: string
  value: string
  description: string
}): React.ReactElement {
  return (
    <div className="rounded-xl border border-border/60 bg-background/80 p-4">
      <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{input.label}</div>
      <div className="mt-2 text-2xl font-semibold text-foreground">{input.value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{input.description}</div>
    </div>
  )
}

export function TokenUsageSettings(): React.ReactElement {
  const [days, setDays] = React.useState<number>(30)
  const [stats, setStats] = React.useState<TokenUsageStats | null>(null)
  const [calendarMonthStats, setCalendarMonthStats] = React.useState<TokenUsageStats | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [selectedProvider, setSelectedProvider] = React.useState<string>('all')
  const [settings, setSettings] = React.useState<AppSettings | null>(null)
  const [budgetUsd, setBudgetUsd] = React.useState('')
  const [budgetTokens, setBudgetTokens] = React.useState('')

  const loadStats = React.useCallback(async (rangeDays: number) => {
    setLoading(true)
    try {
      const nextStats = await window.electronAPI.getTokenUsageStats(rangeDays)
      setStats(nextStats)
    } catch (error) {
      console.error('[TokenUsageSettings] 加载统计失败:', error)
      toast.error('加载 Token 统计失败')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadStats(days)
  }, [days, loadStats])

  const loadCalendarMonthStats = React.useCallback(async (): Promise<void> => {
    try {
      // usage API 按 UTC 自然日聚合；这里必须使用 UTC 日期，避免东八区凌晨跨日时多算一天。
      setCalendarMonthStats(await window.electronAPI.getTokenUsageStats(new Date().getUTCDate()))
    } catch (error) {
      console.error('[TokenUsageSettings] 加载本月预算统计失败:', error)
    }
  }, [])

  React.useEffect(() => {
    void loadCalendarMonthStats()
  }, [loadCalendarMonthStats])

  React.useEffect(() => {
    window.electronAPI.getSettings()
      .then((nextSettings) => {
        setSettings(nextSettings)
        setBudgetUsd(nextSettings.tokenMonthlyBudgetUsd ? String(nextSettings.tokenMonthlyBudgetUsd) : '')
        setBudgetTokens(nextSettings.tokenMonthlyBudgetTokens ? String(nextSettings.tokenMonthlyBudgetTokens) : '')
      })
      .catch((error) => {
        console.error('[TokenUsageSettings] 加载预算设置失败:', error)
      })
  }, [])

  React.useEffect(() => {
    if (!stats) return
    const knownProviders = new Set(stats.providers.map((item) => item.provider))
    if (selectedProvider !== 'all' && !knownProviders.has(selectedProvider)) {
      setSelectedProvider('all')
    }
  }, [selectedProvider, stats])

  const filteredModels = React.useMemo(() => {
    if (!stats) return []
    if (selectedProvider === 'all') return stats.models
    return stats.models.filter((item) => item.provider === selectedProvider)
  }, [selectedProvider, stats])

  const budgetStatus = React.useMemo(() => {
    if (!calendarMonthStats || !settings) return null
    const usdLimit = settings.tokenMonthlyBudgetUsd
    const tokenLimit = settings.tokenMonthlyBudgetTokens
    return {
      usdLimit,
      tokenLimit,
      usdRatio: usdLimit ? calendarMonthStats.totals.costUsd / usdLimit : 0,
      tokenRatio: tokenLimit ? calendarMonthStats.totals.totalTokens / tokenLimit : 0,
      usdUsed: calendarMonthStats.totals.costUsd,
      tokensUsed: calendarMonthStats.totals.totalTokens,
    }
  }, [calendarMonthStats, settings])

  const lastBudgetWarningKeyRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!calendarMonthStats || !budgetStatus) return
    const exceededUsd = Boolean(budgetStatus.usdLimit && budgetStatus.usdRatio >= 1)
    const exceededTokens = Boolean(budgetStatus.tokenLimit && budgetStatus.tokenRatio >= 1)
    if (!exceededUsd && !exceededTokens) return

    const key = `${calendarMonthStats.fromDate}:${calendarMonthStats.toDate}:${exceededUsd ? 'usd' : ''}:${exceededTokens ? 'tokens' : ''}`
    if (lastBudgetWarningKeyRef.current === key) return
    lastBudgetWarningKeyRef.current = key

    const parts = [
      exceededUsd && budgetStatus.usdLimit
        ? `成本 ${formatUsd(budgetStatus.usdUsed)} / ${formatUsd(budgetStatus.usdLimit)}`
        : undefined,
      exceededTokens && budgetStatus.tokenLimit
        ? `Token ${formatInteger(budgetStatus.tokensUsed)} / ${formatInteger(budgetStatus.tokenLimit)}`
        : undefined,
    ].filter(Boolean)

    toast.warning('Token 预算已超过阈值', {
      description: parts.join('，'),
    })
  }, [budgetStatus, calendarMonthStats])

  const saveBudget = React.useCallback(async (): Promise<void> => {
    const parseOptionalNumber = (value: string): number | undefined => {
      const trimmed = value.trim()
      if (!trimmed) return undefined
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
    }

    const updated = await window.electronAPI.updateSettings({
      tokenMonthlyBudgetUsd: parseOptionalNumber(budgetUsd),
      tokenMonthlyBudgetTokens: parseOptionalNumber(budgetTokens),
    })
    setSettings(updated)
    toast.success('Token 预算已保存')
  }, [budgetTokens, budgetUsd])

  if (loading && !stats) {
    return (
      <SettingsSection title="Token 统计" description="正在加载最近窗口的 token usage 聚合数据。">
        <SettingsCard divided={false} className="p-6 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            正在汇总模型消耗...
          </div>
        </SettingsCard>
      </SettingsSection>
    )
  }

  if (!stats) {
    return (
      <SettingsSection title="Token 统计" description="当前无法加载统计数据。">
        <SettingsCard divided={false} className="p-6 text-sm text-muted-foreground">
          请稍后重试。
        </SettingsCard>
      </SettingsSection>
    )
  }

  return (
    <div className="space-y-8">
      <SettingsSection
        title="Token 统计"
        description={`统计窗口：${stats.fromDate} → ${stats.toDate}`}
        action={(
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-xl border border-border/60 bg-muted/35 p-1">
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={option.value === days
                    ? 'rounded-lg bg-background px-3 py-1.5 text-xs font-medium text-foreground'
                    : 'rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground'}
                  onClick={() => setDays(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={() => { void loadStats(days); void loadCalendarMonthStats() }}>
              <RefreshCw className="mr-1 size-4" />
              刷新
            </Button>
          </div>
        )}
      >
        <SettingsCard divided={false} className="p-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              label="总 Token"
              value={formatInteger(stats.totals.totalTokens)}
              description={`共 ${stats.totals.requestCount} 次完成请求`}
            />
            <MetricCard
              label="输入"
              value={formatInteger(stats.totals.inputTokens)}
              description="Prompt / context 输入"
            />
            <MetricCard
              label="输出"
              value={formatInteger(stats.totals.outputTokens)}
              description="Assistant 输出"
            />
            <MetricCard
              label="缓存"
              value={formatInteger(getCacheTokens(stats.totals))}
              description={`cache read + cache create · hit ${formatPercent(stats.totals.cacheHitRate)}`}
            />
            <MetricCard
              label="成本"
              value={formatUsd(stats.totals.costUsd)}
              description="按模型价格表估算"
            />
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="预算与告警"
        description="按本自然月（每月 1 日至今天）计算；软预算只做可视化提示，不阻断运行。"
      >
        <SettingsCard divided={false} className="p-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div>
              <label htmlFor="token-budget-usd" className="mb-1.5 block text-xs text-muted-foreground">自然月 USD 预算</label>
              <Input id="token-budget-usd" value={budgetUsd} onChange={(event) => setBudgetUsd(event.target.value)} placeholder="例如 20" inputMode="decimal" />
            </div>
            <div>
              <label htmlFor="token-budget-tokens" className="mb-1.5 block text-xs text-muted-foreground">自然月 Token 预算</label>
              <Input id="token-budget-tokens" value={budgetTokens} onChange={(event) => setBudgetTokens(event.target.value)} placeholder="例如 2000000" inputMode="numeric" />
            </div>
            <div className="flex items-end">
              <Button variant="outline" onClick={() => void saveBudget()}>保存预算</Button>
            </div>
          </div>
          {budgetStatus && (
            <div className="grid gap-3 md:grid-cols-2">
              <MetricCard
                label="成本预算"
                value={budgetStatus.usdLimit ? `${Math.round(budgetStatus.usdRatio * 100)}%` : '未设置'}
                description={budgetStatus.usdLimit ? `${formatUsd(budgetStatus.usdUsed)} / ${formatUsd(budgetStatus.usdLimit)}` : '未配置自然月 USD 软阈值'}
              />
              <MetricCard
                label="Token 预算"
                value={budgetStatus.tokenLimit ? `${Math.round(budgetStatus.tokenRatio * 100)}%` : '未设置'}
                description={budgetStatus.tokenLimit ? `${formatInteger(budgetStatus.tokensUsed)} / ${formatInteger(budgetStatus.tokenLimit)}` : '未配置自然月 token 软阈值'}
              />
            </div>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="每日趋势"
        description="最近窗口内每日输入 / 输出 token 变化。"
      >
        <SettingsCard divided={false} className="p-4">
          <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
            <BarChart3 className="size-4" />
            <span>Stacked Bar：input + output</span>
          </div>
          <div role="img" aria-label={`每日 Token 趋势，共 ${stats.daily.length} 天`} className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.daily} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(value, name) => {
                    const rawValue = Array.isArray(value) ? value[0] : value
                    const normalizedValue = typeof rawValue === 'number' ? rawValue : Number(rawValue ?? 0)
                    const normalizedName = String(name)
                    return [
                      formatInteger(normalizedValue),
                      normalizedName === 'inputTokens' ? 'Input' : 'Output',
                    ] as [string, string]
                  }}
                  labelFormatter={(label) => `日期：${label}`}
                />
                <Bar dataKey="inputTokens" stackId="tokens" radius={[8, 8, 0, 0]} fill={CHART_INPUT_FILL} />
                <Bar dataKey="outputTokens" stackId="tokens" radius={[8, 8, 0, 0]} fill={CHART_OUTPUT_FILL} />
              </BarChart>
            </ResponsiveContainer>
            <div className="sr-only">
              {stats.daily.map((day) => `${day.date}：输入 ${formatInteger(day.inputTokens)}，输出 ${formatInteger(day.outputTokens)}`).join('；')}
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Channel / Model 分布"
        description="按渠道查看模型消耗占比与明细。"
      >
        <SettingsCard divided={false} className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={selectedProvider === 'all'
                ? 'rounded-lg bg-[hsl(var(--brand-soft))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--brand-soft-foreground))]'
                : 'rounded-lg border border-border/60 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground'}
              onClick={() => setSelectedProvider('all')}
            >
              All channels
            </button>
            {stats.providers.map((provider) => (
              <button
                key={provider.provider}
                type="button"
                className={selectedProvider === provider.provider
                  ? 'rounded-lg bg-[hsl(var(--brand-soft))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--brand-soft-foreground))]'
                  : 'rounded-lg border border-border/60 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground'}
                onClick={() => setSelectedProvider(provider.provider)}
              >
                {formatProviderLabel(provider)} · {formatInteger(provider.totalTokens)}
              </button>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                <DatabaseZap className="size-4" />
                Channel 摘要
              </div>
              <div className="space-y-2">
                {stats.providers.map((provider) => (
                  <div
                    key={provider.provider}
                    className="rounded-lg border border-border/50 bg-background/80 p-3"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {formatProviderLabel(provider)}
                      </span>
                      <span className="text-xs text-muted-foreground">{provider.requestCount} 次</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary/70"
                        style={{
                          width: `${stats.totals.totalTokens > 0 ? (provider.totalTokens / stats.totals.totalTokens) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {formatInteger(provider.totalTokens)} tokens · {formatUsd(provider.costUsd)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border/60">
              <div className="grid min-w-[860px] grid-cols-[1.35fr,0.7fr,0.9fr,0.8fr,0.8fr,0.7fr,0.7fr,0.8fr] gap-3 border-b border-border/60 bg-muted/25 px-4 py-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                <span>Model</span>
                <span>Context</span>
                <span>Price</span>
                <span>Total</span>
                <span>Input</span>
                <span>Output</span>
                <span>Req</span>
                <span>Cost</span>
              </div>

              <div className="max-h-[360px] overflow-auto">
                {filteredModels.length > 0 ? filteredModels.map((model) => {
                  const context = getModelContextLabel(model)
                  const unitPrice = formatModelUnitPrice(model)
                  return (
                    <div
                      key={`${model.provider}:${model.modelId}`}
                      className="grid min-w-[860px] grid-cols-[1.35fr,0.7fr,0.9fr,0.8fr,0.8fr,0.7fr,0.7fr,0.8fr] gap-3 border-b border-border/50 px-4 py-3 text-sm last:border-b-0"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">{model.modelId}</div>
                        <div className="mt-1 text-[11px] text-muted-foreground">{formatProviderLabel(model)}</div>
                      </div>
                      <span>
                        <span className="block text-foreground">{context.label}</span>
                        <span className="text-[11px] text-muted-foreground">{context.source}</span>
                      </span>
                      <span>
                        <span className="block text-foreground">{unitPrice.label}</span>
                        <span className="text-[11px] text-muted-foreground">{unitPrice.source}</span>
                      </span>
                      <span>{formatInteger(model.totalTokens)}</span>
                      <span>{formatInteger(model.inputTokens)}</span>
                      <span>{formatInteger(model.outputTokens)}</span>
                      <span>{formatInteger(model.requestCount)}</span>
                      <span>{formatUsd(model.costUsd)}</span>
                    </div>
                  )
                }) : (
                  <div className="flex items-center justify-center px-6 py-12 text-sm text-muted-foreground">
                    当前筛选下还没有模型统计。
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-muted/15 p-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2 text-foreground">
              <Coins className="size-4" />
              <span className="font-medium">说明</span>
            </div>
            <ul className="mt-2 space-y-1.5 leading-5">
              <li>- 统计来源于 Agent 完成事件里的 usage 字段，按 `~/.kila/token-usage.jsonl` 持久化。</li>
              <li>- 如果 provider 没返回成本，Kila 会按模型价格表估算；未知模型仍显示 0。</li>
              <li>- Context 和 Price 来自本地 ModelCatalog，内置价格只做参考估算，可在渠道模型里覆盖。</li>
              <li>- 当前表格按总 token 从高到低排序。</li>
            </ul>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Session / Compaction"
        description="按会话拆分 usage，并汇总当前窗口内已持久化的压缩事件。"
      >
        <SettingsCard divided={false} className="p-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <MetricCard
              label="压缩次数"
              value={formatInteger(stats.compaction.count)}
              description={`最近一次：${stats.compaction.lastCompactedAt ? new Date(stats.compaction.lastCompactedAt).toLocaleString('zh-CN') : '无'}`}
            />
            <MetricCard
              label="压缩前 Token"
              value={formatInteger(stats.compaction.tokensBefore)}
              description="来自 compact_complete.tokensBefore 聚合"
            />
            <MetricCard
              label="摘要长度"
              value={formatInteger(stats.compaction.summaryChars)}
              description="summaryText 字符数，用于判断压缩粒度"
            />
          </div>

          <div className="overflow-x-auto rounded-xl border border-border/60">
            <div className="grid min-w-[720px] grid-cols-[1.5fr,0.8fr,0.8fr,0.8fr,0.7fr,0.8fr] gap-3 border-b border-border/60 bg-muted/25 px-4 py-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              <span>Session</span>
              <span>Total</span>
              <span>Input</span>
              <span>Output</span>
              <span>Cache hit</span>
              <span>Cost</span>
            </div>
            <div className="max-h-[320px] overflow-auto">
              {stats.sessions.length > 0 ? stats.sessions.map((session: TokenUsageSessionStat) => (
                <div key={session.sessionId} className="grid min-w-[720px] grid-cols-[1.5fr,0.8fr,0.8fr,0.8fr,0.7fr,0.8fr] gap-3 border-b border-border/50 px-4 py-3 text-sm last:border-b-0">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{session.title ?? session.sessionId}</div>
                    <div className="mt-1 truncate text-[11px] text-muted-foreground">{session.sessionId}</div>
                  </div>
                  <span>{formatInteger(session.totalTokens)}</span>
                  <span>{formatInteger(session.inputTokens)}</span>
                  <span>{formatInteger(session.outputTokens)}</span>
                  <span>{formatPercent(session.cacheHitRate)}</span>
                  <span>{formatUsd(session.costUsd)}</span>
                </div>
              )) : (
                <div className="flex items-center justify-center px-6 py-12 text-sm text-muted-foreground">
                  当前窗口内没有 session 级统计。
                </div>
              )}
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}
