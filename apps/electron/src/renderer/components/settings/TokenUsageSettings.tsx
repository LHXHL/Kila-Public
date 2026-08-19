import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
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

/** 统计窗口天数选项；label 在渲染时按语言生成 */
const RANGE_DAY_OPTIONS = [7, 30, 60] as const

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

function formatTokenWindow(value: number | undefined, t: TFunction): string {
  if (!value) return t('settings.tokenUsage.unknown')
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(value)
}

function formatModelUnitPrice(model: TokenUsageModelStat, t: TFunction): { label: string; source: string } {
  const metadata = resolveModelMetadata({
    channelProvider: model.providerType ?? model.provider,
    channelBaseUrl: '',
    modelId: model.modelId,
  })
  const input = metadata.pricing?.inputPerMillionUsd ?? metadata.pricing?.inputPerMillion
  const output = metadata.pricing?.outputPerMillionUsd ?? metadata.pricing?.outputPerMillion
  const symbol = metadata.pricing?.currency === 'CNY' ? '¥' : '$'
  return {
    label: input !== undefined || output !== undefined ? `${symbol}${input ?? '-'} / ${symbol}${output ?? '-'}` : t('settings.tokenUsage.unknown'),
    source: metadata.resolutionSources.pricing === 'builtin'
      ? `${t('settings.tokenUsage.sourceBuiltinReference')}${metadata.catalogUpdatedAt ? ` · ${metadata.catalogUpdatedAt}` : ''}`
      : metadata.resolutionSources.pricing === 'manual'
        ? t('settings.tokenUsage.sourceManual')
        : t('settings.tokenUsage.sourceUnset'),
  }
}

function getModelContextLabel(model: TokenUsageModelStat, t: TFunction): { label: string; source: string } {
  const metadata = resolveModelMetadata({
    channelProvider: model.providerType ?? model.provider,
    channelBaseUrl: '',
    modelId: model.modelId,
  })
  return {
    label: formatTokenWindow(metadata.contextWindowTokens, t),
    // 窗口单一数据源：手动覆盖 > 模型名推断（shared resolveModelMetadata 只产生这两种来源）
    source: metadata.resolutionSources.contextWindow === 'manual'
      ? t('settings.tokenUsage.sourceManual')
      : metadata.resolutionSources.contextWindow === 'inference'
        ? t('settings.tokenUsage.sourceInference')
        : t('settings.tokenUsage.sourceDefault'),
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
  const { t, i18n } = useTranslation()
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
      toast.error(t('settings.tokenUsage.loadFailed'))
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
        ? t('settings.tokenUsage.budgetCostPart', { used: formatUsd(budgetStatus.usdUsed), limit: formatUsd(budgetStatus.usdLimit) })
        : undefined,
      exceededTokens && budgetStatus.tokenLimit
        ? `Token ${formatInteger(budgetStatus.tokensUsed)} / ${formatInteger(budgetStatus.tokenLimit)}`
        : undefined,
    ].filter(Boolean)

    toast.warning(t('settings.tokenUsage.budgetExceeded'), {
      description: parts.join(t('settings.tokenUsage.listSeparator')),
    })
  }, [budgetStatus, calendarMonthStats, t])

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
    toast.success(t('settings.tokenUsage.budgetSaved'))
  }, [budgetTokens, budgetUsd, t])

  if (loading && !stats) {
    return (
      <SettingsSection title={t('settings.tokenUsage.title')} description={t('settings.tokenUsage.loadingDescription')}>
        <SettingsCard divided={false} className="p-6 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            {t('settings.tokenUsage.aggregating')}
          </div>
        </SettingsCard>
      </SettingsSection>
    )
  }

  if (!stats) {
    return (
      <SettingsSection title={t('settings.tokenUsage.title')} description={t('settings.tokenUsage.errorDescription')}>
        <SettingsCard divided={false} className="p-6 text-sm text-muted-foreground">
          {t('settings.tokenUsage.retryLater')}
        </SettingsCard>
      </SettingsSection>
    )
  }

  return (
    <div className="space-y-8">
      <SettingsSection
        title={t('settings.tokenUsage.title')}
        description={t('settings.tokenUsage.window', { from: stats.fromDate, to: stats.toDate })}
        action={(
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-xl border border-border/60 bg-muted/35 p-1">
              {RANGE_DAY_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={option === days
                    ? 'rounded-lg bg-background px-3 py-1.5 text-xs font-medium text-foreground'
                    : 'rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground'}
                  onClick={() => setDays(option)}
                >
                  {t('settings.tokenUsage.rangeDays', { count: option })}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={() => { void loadStats(days); void loadCalendarMonthStats() }}>
              <RefreshCw className="mr-1 size-4" />
              {t('settings.about.refresh')}
            </Button>
          </div>
        )}
      >
        <SettingsCard divided={false} className="p-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              label={t('settings.tokenUsage.totalTokens')}
              value={formatInteger(stats.totals.totalTokens)}
              description={t('settings.tokenUsage.requestCount', { count: stats.totals.requestCount })}
            />
            <MetricCard
              label={t('settings.tokenUsage.input')}
              value={formatInteger(stats.totals.inputTokens)}
              description={t('settings.tokenUsage.inputHint')}
            />
            <MetricCard
              label={t('settings.tokenUsage.output')}
              value={formatInteger(stats.totals.outputTokens)}
              description={t('settings.tokenUsage.outputHint')}
            />
            <MetricCard
              label={t('settings.tokenUsage.cache')}
              value={formatInteger(getCacheTokens(stats.totals))}
              description={`cache read + cache create · hit ${formatPercent(stats.totals.cacheHitRate)} · coverage ${formatPercent(stats.totals.cacheCoverageRate)}`}
            />
            <MetricCard
              label={t('settings.tokenUsage.cost')}
              value={formatUsd(stats.totals.costUsd)}
              description={t('settings.tokenUsage.costHint')}
            />
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t('settings.tokenUsage.budgetTitle')}
        description={t('settings.tokenUsage.budgetDescription')}
      >
        <SettingsCard divided={false} className="p-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div>
              <label htmlFor="token-budget-usd" className="mb-1.5 block text-xs text-muted-foreground">{t('settings.tokenUsage.budgetUsd')}</label>
              <Input id="token-budget-usd" value={budgetUsd} onChange={(event) => setBudgetUsd(event.target.value)} placeholder={t('settings.tokenUsage.budgetUsdPlaceholder')} inputMode="decimal" />
            </div>
            <div>
              <label htmlFor="token-budget-tokens" className="mb-1.5 block text-xs text-muted-foreground">{t('settings.tokenUsage.budgetTokens')}</label>
              <Input id="token-budget-tokens" value={budgetTokens} onChange={(event) => setBudgetTokens(event.target.value)} placeholder={t('settings.tokenUsage.budgetTokensPlaceholder')} inputMode="numeric" />
            </div>
            <div className="flex items-end">
              <Button variant="outline" onClick={() => void saveBudget()}>{t('settings.tokenUsage.saveBudget')}</Button>
            </div>
          </div>
          {budgetStatus && (
            <div className="grid gap-3 md:grid-cols-2">
              <MetricCard
                label={t('settings.tokenUsage.costBudget')}
                value={budgetStatus.usdLimit ? `${Math.round(budgetStatus.usdRatio * 100)}%` : t('settings.tokenUsage.notSet')}
                description={budgetStatus.usdLimit ? `${formatUsd(budgetStatus.usdUsed)} / ${formatUsd(budgetStatus.usdLimit)}` : t('settings.tokenUsage.noUsdThreshold')}
              />
              <MetricCard
                label={t('settings.tokenUsage.tokenBudget')}
                value={budgetStatus.tokenLimit ? `${Math.round(budgetStatus.tokenRatio * 100)}%` : t('settings.tokenUsage.notSet')}
                description={budgetStatus.tokenLimit ? `${formatInteger(budgetStatus.tokensUsed)} / ${formatInteger(budgetStatus.tokenLimit)}` : t('settings.tokenUsage.noTokenThreshold')}
              />
            </div>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t('settings.tokenUsage.dailyTitle')}
        description={t('settings.tokenUsage.dailyDescription')}
      >
        <SettingsCard divided={false} className="p-4">
          <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
            <BarChart3 className="size-4" />
            <span>Stacked Bar：input + output</span>
          </div>
          <div role="img" aria-label={t('settings.tokenUsage.dailyChartAria', { count: stats.daily.length })} className="h-[280px] w-full">
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
                  labelFormatter={(label) => t('settings.tokenUsage.dateLabel', { date: label })}
                />
                <Bar dataKey="inputTokens" stackId="tokens" radius={[8, 8, 0, 0]} fill={CHART_INPUT_FILL} />
                <Bar dataKey="outputTokens" stackId="tokens" radius={[8, 8, 0, 0]} fill={CHART_OUTPUT_FILL} />
              </BarChart>
            </ResponsiveContainer>
            <div className="sr-only">
              {stats.daily.map((day) => t('settings.tokenUsage.dailySummary', { date: day.date, input: formatInteger(day.inputTokens), output: formatInteger(day.outputTokens) })).join(t('settings.tokenUsage.listSeparator'))}
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t('settings.tokenUsage.distributionTitle')}
        description={t('settings.tokenUsage.distributionDescription')}
      >
        <SettingsCard divided={false} className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={selectedProvider === 'all'
                ? 'rounded-lg bg-brand-soft px-3 py-1.5 text-xs font-medium text-brand-soft-foreground'
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
                  ? 'rounded-lg bg-brand-soft px-3 py-1.5 text-xs font-medium text-brand-soft-foreground'
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
                {t('settings.tokenUsage.channelSummary')}
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
                      <span className="text-xs text-muted-foreground">{t('settings.tokenUsage.requests', { count: provider.requestCount })}</span>
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
                  const context = getModelContextLabel(model, t)
                  const unitPrice = formatModelUnitPrice(model, t)
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
                    {t('settings.tokenUsage.noModelStats')}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-muted/15 p-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2 text-foreground">
              <Coins className="size-4" />
              <span className="font-medium">{t('settings.tokenUsage.notesTitle')}</span>
            </div>
            <ul className="mt-2 space-y-1.5 leading-5">
              <li>- {t('settings.tokenUsage.note1')}</li>
              <li>- {t('settings.tokenUsage.note2')}</li>
              <li>- {t('settings.tokenUsage.note3')}</li>
              <li>- {t('settings.tokenUsage.note4')}</li>
            </ul>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Session / Compaction"
        description={t('settings.tokenUsage.sessionDescription')}
      >
        <SettingsCard divided={false} className="p-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <MetricCard
              label={t('settings.contextCompaction.compactionCount')}
              value={formatInteger(stats.compaction.count)}
              description={t('settings.contextCompaction.lastCompactedAt', { time: stats.compaction.lastCompactedAt ? new Date(stats.compaction.lastCompactedAt).toLocaleString(i18n.language) : t('settings.contextCompaction.never') })}
            />
            <MetricCard
              label={t('settings.contextCompaction.tokensBefore')}
              value={formatInteger(stats.compaction.tokensBefore)}
              description={t('settings.tokenUsage.tokensBeforeHint')}
            />
            <MetricCard
              label={t('settings.contextCompaction.summaryLength')}
              value={formatInteger(stats.compaction.summaryChars)}
              description={t('settings.tokenUsage.summaryLengthHint')}
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
                  {t('settings.tokenUsage.noSessionStats')}
                </div>
              )}
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}
