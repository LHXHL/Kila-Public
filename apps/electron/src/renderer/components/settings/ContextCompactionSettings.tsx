import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Archive, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { SettingsCard, SettingsSection } from './primitives'
import {
  loadCompactionRecords,
  summarizeCompactionRecords,
  type CompactionRecord,
} from './context-compaction-data'

function formatInteger(value: number, language: string): string {
  return new Intl.NumberFormat(language).format(Math.round(value))
}

function formatDateTime(value: number | undefined, t: TFunction, language: string): string {
  if (!value) return t('settings.contextCompaction.never')
  return new Date(value).toLocaleString(language)
}

function reasonLabel(reason: CompactionRecord['reason'], t: TFunction): string {
  if (reason === 'manual') return t('settings.contextCompaction.reasonManual')
  if (reason === 'overflow') return t('settings.contextCompaction.reasonOverflow')
  if (reason === 'threshold') return t('settings.contextCompaction.reasonThreshold')
  return t('settings.contextCompaction.reasonUnknown')
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

export function ContextCompactionSettings(): React.ReactElement {
  const { t, i18n } = useTranslation()
  const [records, setRecords] = React.useState<CompactionRecord[]>([])
  const [loading, setLoading] = React.useState(true)
  const [failedSessionCount, setFailedSessionCount] = React.useState(0)

  const loadRecords = React.useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await loadCompactionRecords({
        listSessions: window.electronAPI.listSessions,
        getSessionMessagesPage: window.electronAPI.getSessionMessagesPage,
      })
      setRecords(result.records)
      setFailedSessionCount(result.failures.length)
      if (result.failures.length > 0) {
        console.warn('[ContextCompactionSettings] 部分 Session 加载失败:', result.failures)
        toast.warning(t('settings.contextCompaction.partialLoadWarning', { count: result.failures.length }))
      }
    } catch (error) {
      console.error('[ContextCompactionSettings] 加载上下文压缩记录失败:', error)
      setFailedSessionCount(0)
      toast.error(t('settings.contextCompaction.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    void loadRecords()
  }, [loadRecords])

  const summary = React.useMemo(() => summarizeCompactionRecords(records), [records])

  return (
    <div className="space-y-6">
      <SettingsSection
        title={t('settings.contextCompaction.title')}
        description={t('settings.contextCompaction.description')}
        action={(
          <Button variant="outline" size="sm" onClick={() => { void loadRecords() }} disabled={loading}>
            {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
            {t('settings.about.refresh')}
          </Button>
        )}
      >
        <SettingsCard divided={false} className="p-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-5">
            <MetricCard
              label={t('settings.contextCompaction.compactionCount')}
              value={formatInteger(summary.count, i18n.language)}
              description={t('settings.contextCompaction.lastCompactedAt', {
                time: formatDateTime(summary.lastCompactedAt, t, i18n.language),
              })}
            />
            <MetricCard
              label={t('settings.contextCompaction.overflowRecovery')}
              value={formatInteger(summary.overflowCount, i18n.language)}
              description={t('settings.contextCompaction.retryCount', { count: summary.retryCount })}
            />
            <MetricCard
              label={t('settings.contextCompaction.tokensBefore')}
              value={formatInteger(summary.tokensBefore, i18n.language)}
              description={t('settings.contextCompaction.tokensBeforeHint')}
            />
            <MetricCard
              label={t('settings.contextCompaction.summaryTokens')}
              value={formatInteger(summary.summaryTokens, i18n.language)}
              description={t('settings.contextCompaction.summaryTokensHint')}
            />
            <MetricCard
              label={t('settings.contextCompaction.summaryLength')}
              value={formatInteger(summary.summaryChars, i18n.language)}
              description={t('settings.contextCompaction.summaryLengthHint')}
            />
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t('settings.contextCompaction.historyTitle')}
        description={t('settings.contextCompaction.historyDescription')}
      >
        <SettingsCard divided={false} className="overflow-hidden">
          {failedSessionCount > 0 && (
            <div className="border-b border-amber-500/20 bg-amber-500/8 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
              {t('settings.contextCompaction.failedSessions', { count: failedSessionCount })}
            </div>
          )}
          <div className="grid grid-cols-[1.1fr,0.8fr,0.8fr,0.8fr,0.8fr] gap-3 border-b border-border/60 bg-muted/25 px-4 py-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            <span>Session</span>
            <span>{t('settings.contextCompaction.columnTime')}</span>
            <span>{t('settings.contextCompaction.columnReason')}</span>
            <span>Token</span>
            <span>{t('settings.contextCompaction.columnSummary')}</span>
          </div>
          <div className="max-h-[520px] overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center px-6 py-12 text-sm text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" />
                {t('common.loading')}
              </div>
            ) : records.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-14 text-center text-sm text-muted-foreground">
                <Archive className="mb-3 size-8 text-muted-foreground/70" />
                <div>{t('settings.contextCompaction.empty')}</div>
              </div>
            ) : (
              records.map((record) => (
                <div key={record.id} className="grid grid-cols-[1.1fr,0.8fr,0.8fr,0.8fr,0.8fr] gap-3 border-b border-border/50 px-4 py-3 text-sm last:border-b-0">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{record.sessionTitle}</div>
                    <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{record.sessionId}</div>
                  </div>
                  <span className="text-muted-foreground">{formatDateTime(record.createdAt, t, i18n.language)}</span>
                  <span>{reasonLabel(record.reason, t)}</span>
                  <div className="min-w-0">
                    <div>{record.tokensBefore ? formatInteger(record.tokensBefore, i18n.language) : '-'}</div>
                    {record.estimatedTokensAfter != null && (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        → {formatInteger(record.estimatedTokensAfter, i18n.language)}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate">{record.summaryText ? `${record.summaryText.length} chars` : '-'}</div>
                    {record.firstKeptEntryId && (
                      <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                        kept: {record.firstKeptEntryId}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}
