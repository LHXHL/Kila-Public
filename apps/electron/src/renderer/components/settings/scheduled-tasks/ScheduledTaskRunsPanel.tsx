import * as React from 'react'
import type { ScheduledTaskRunRecord } from '@kila/shared'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { getStatusToneClasses, type StatusTone } from '@/lib/theme/status-tone'

interface ScheduledTaskRunsPanelProps {
  runs: ScheduledTaskRunRecord[]
  onOpenSession?: (sessionId: string) => void
  onRetry?: (run: ScheduledTaskRunRecord) => void
}

function formatTime(value: number): string {
  return new Date(value).toLocaleString('zh-CN')
}

function formatOutcome(outcome: ScheduledTaskRunRecord['outcome']): string {
  switch (outcome) {
    case 'success':
      return '成功'
    case 'stopped_by_ai':
      return 'AI 已结束'
    case 'error':
      return '失败'
    case 'skipped_busy':
      return '忙碌跳过'
    case 'skipped_invalid_config':
      return '配置无效'
    case 'skipped_concurrency_limit':
      return '并发跳过'
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
  return (
    <section className="surface-panel overflow-hidden rounded-xl">
      <div className="flex items-center justify-between border-b border-border/50 px-5 py-4">
        <h3 className="text-base font-semibold text-foreground">最近运行</h3>
        <span className="text-xs tabular-nums text-muted-foreground">{runs.length} 条</span>
      </div>

      <ScrollArea className="h-[360px]">
        {runs.length === 0 && (
          <div className="px-5 py-10">
            <div className="text-sm font-medium text-foreground">暂无运行历史</div>
            <p className="mt-1 max-w-[42ch] text-sm leading-6 text-muted-foreground">
              首次执行后，这里会按时间倒序展示结果、错误和关联会话。
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
                    <span className={cn('font-semibold', tone.text)}>{formatOutcome(run.outcome)}</span>
                    <span className="text-muted-foreground">
                      {run.triggerSource === 'manual' ? '手动触发' : '调度触发'}
                    </span>
                    <span className="tabular-nums text-muted-foreground">{formatTime(run.startedAt)}</span>
                  </div>

                  {run.finalReplyPreview && (
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground/85">
                      {run.finalReplyPreview}
                    </p>
                  )}

                  {run.error && (
                    <div className="mt-3 rounded-lg bg-muted/40 px-3 py-2.5 text-sm leading-6 text-foreground whitespace-pre-wrap">
                      <span className={cn('font-semibold', getStatusToneClasses('danger').text)}>错误：</span>
                      {run.error}
                    </div>
                  )}

                  {run.verificationSummary && (
                    <p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-muted-foreground">
                      校验：{run.verificationSummary}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                    <div className="flex flex-wrap items-center gap-3 tabular-nums">
                      <span>耗时 {Math.max(0, Math.round(run.durationMs / 1000))}s</span>
                      {run.sessionId && <span className="truncate">会话 {run.sessionId}</span>}
                    </div>
                    <div className="flex items-center gap-1">
                      {run.outcome !== 'success' && run.outcome !== 'stopped_by_ai' && onRetry && (
                        <Button type="button" variant="outline" size="sm" className="h-7 rounded-md px-2" onClick={() => onRetry(run)}>
                          重试
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
                          打开会话
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
