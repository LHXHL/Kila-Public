import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { ScheduledTaskRunRecord } from '@kila/shared'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { getStatusToneClasses, type StatusTone } from '@/lib/theme/status-tone'
import { formatTaskDateTime } from './task-presentation'

interface ScheduledTaskRunsPanelProps {
  runs: ScheduledTaskRunRecord[]
  onOpenSession?: (sessionId: string) => void
  onRetry?: (run: ScheduledTaskRunRecord) => void
}

function formatOutcome(t: TFunction, outcome: ScheduledTaskRunRecord['outcome']): string {
  switch (outcome) {
    case 'success':
      return t('settingsTasks.runs.outcome.success')
    case 'stopped_by_ai':
      return t('settingsTasks.runs.outcome.stoppedByAi')
    case 'error':
      return t('settingsTasks.runs.outcome.error')
    case 'skipped_busy':
      return t('settingsTasks.runs.outcome.skippedBusy')
    case 'skipped_invalid_config':
      return t('settingsTasks.runs.outcome.skippedInvalidConfig')
    case 'skipped_concurrency_limit':
      return t('settingsTasks.runs.outcome.skippedConcurrencyLimit')
    default:
      return outcome
  }
}

function getOutcomeTone(outcome: ScheduledTaskRunRecord['outcome']): StatusTone {
  switch (outcome) {
    case 'success':
    case 'stopped_by_ai':
      return 'success'
    case 'error':
      return 'danger'
    case 'skipped_busy':
    case 'skipped_invalid_config':
    case 'skipped_concurrency_limit':
      return 'neutral'
    default:
      return 'neutral'
  }
}

export function ScheduledTaskRunsPanel({
  runs,
  onOpenSession,
  onRetry,
}: ScheduledTaskRunsPanelProps): React.ReactElement {
  const { t, i18n } = useTranslation()

  return (
    <section className="surface-panel overflow-hidden rounded-xl">
      <div className="flex items-center justify-between border-b border-border/50 px-5 py-4">
        <h3 className="text-base font-semibold text-foreground">{t('settingsTasks.runs.title')}</h3>
        <span className="text-xs tabular-nums text-muted-foreground">
          {t('settingsTasks.runs.count', { count: runs.length })}
        </span>
      </div>

      <ScrollArea className="h-[360px]">
        {runs.length === 0 && (
          <div className="px-5 py-10">
            <div className="text-sm font-medium text-foreground">{t('settingsTasks.runs.emptyTitle')}</div>
            <p className="mt-1 max-w-[42ch] text-sm leading-6 text-muted-foreground">
              {t('settingsTasks.runs.emptyDescription')}
            </p>
          </div>
        )}

        {runs.length > 0 && (
          <div>
            {runs.slice().reverse().map((run) => {
              const tone = getStatusToneClasses(getOutcomeTone(run.outcome))
              return (
                <article key={run.id} className="border-b border-border/45 px-5 py-4 last:border-b-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className={cn('font-semibold', tone.text)}>{formatOutcome(t, run.outcome)}</span>
                    <span className="text-muted-foreground">
                      {run.triggerSource === 'manual'
                        ? t('settingsTasks.runs.triggerManual')
                        : t('settingsTasks.runs.triggerSchedule')}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatTaskDateTime(run.startedAt, i18n.language)}
                    </span>
                  </div>

                  {run.finalReplyPreview && (
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground/85">
                      {run.finalReplyPreview}
                    </p>
                  )}

                  {run.error && (
                    <div className="mt-3 rounded-lg bg-muted/40 px-3 py-2.5 text-sm leading-6 text-foreground whitespace-pre-wrap">
                      <span className={cn('font-semibold', getStatusToneClasses('danger').text)}>
                        {t('settingsTasks.runs.errorPrefix')}
                      </span>
                      {run.error}
                    </div>
                  )}

                  {run.verificationSummary && (
                    <p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-muted-foreground">
                      {t('settingsTasks.runs.verification', { summary: run.verificationSummary })}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                    <div className="flex flex-wrap items-center gap-3 tabular-nums">
                      <span>
                        {t('settingsTasks.runs.duration', { seconds: Math.max(0, Math.round(run.durationMs / 1000)) })}
                      </span>
                      {run.sessionId && (
                        <span className="truncate">
                          {t('settingsTasks.runs.session', { sessionId: run.sessionId })}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {run.outcome !== 'success' && run.outcome !== 'stopped_by_ai' && onRetry && (
                        <Button type="button" variant="outline" size="sm" className="h-7 rounded-md px-2" onClick={() => onRetry(run)}>
                          {t('settingsTasks.runs.retry')}
                        </Button>
                      )}
                      {run.sessionId && onOpenSession && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 rounded-md px-2"
                          onClick={() => onOpenSession(run.sessionId!)}
                        >
                          {t('settingsTasks.runs.openSession')}
                        </Button>
                      )}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </ScrollArea>
    </section>
  )
}
