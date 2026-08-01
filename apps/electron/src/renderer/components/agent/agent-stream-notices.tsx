/**
 * agent-stream-notices — 流式过程提示组件
 *
 * 包含 CompactingNotice（上下文压缩中）、RetryingNotice（自动重试进度）
 * 和 RetryAttemptItem（单次重试详情）。从 AgentMessageItem.tsx 拆出，
 * 供 AgentMessages 的 live turn 区域使用。
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCw, AlertTriangle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RetryAttempt } from '@kila/shared'
import type { AgentStreamState } from '@/atoms/agent-atoms'

// ===== CompactingNotice =====

/** 压缩中提示：上下文压缩期间在流式区域给出醒目反馈，附摘要重试进度。 */
export function CompactingNotice({ retry }: { retry?: AgentStreamState['summarizationRetry'] }): React.ReactElement {
  const { t } = useTranslation()

  return (
    <div className="mb-1.5 flex items-center gap-2.5 rounded-xl border border-border/35 bg-background/55 px-2.5 py-2">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/20">
        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{t('agent.message.compactingContext')}</div>
        <div className="truncate text-xs text-muted-foreground">
          {retry
            ? t('agent.message.compactingRetry', { attempt: retry.attempt })
            : t('agent.message.compactingHint')}
        </div>
      </div>
    </div>
  )
}

// ===== RetryAttemptItem =====

function RetryAttemptItem({
  attempt,
  isLatest,
  isFailed,
}: {
  attempt: RetryAttempt
  isLatest: boolean
  isFailed: boolean
}): React.ReactElement {
  const { t } = useTranslation()
  const [showStderr, setShowStderr] = React.useState(false)
  const [showStack, setShowStack] = React.useState(false)

  const time = new Date(attempt.timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  return (
    <div className={cn('pl-6 space-y-2', isLatest && 'font-medium')}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="text-xs text-foreground/90">
            {t('agent.retry.attemptLine', { attempt: attempt.attempt, time, reason: attempt.reason })}
          </div>
          <div className="break-words font-mono text-xs text-destructive/80">
            {attempt.errorMessage}
          </div>

          {attempt.environment && (
            <div className="space-y-0.5 text-[11px] text-muted-foreground">
              <div>{t('agent.retry.runtime', { value: attempt.environment.runtime })}</div>
              <div>{t('agent.retry.platform', { value: attempt.environment.platform })}</div>
              <div>{t('agent.retry.model', { value: attempt.environment.model })}</div>
              {attempt.environment.workspace && <div>{t('agent.retry.workspace', { value: attempt.environment.workspace })}</div>}
            </div>
          )}

          {attempt.stderr && (
            <div className="mt-2">
              <button
                type="button"
                className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground/80"
                onClick={() => setShowStderr(!showStderr)}
              >
                {showStderr ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                {t('agent.retry.showStderr')}
              </button>
              {showStderr && (
                <pre className="mt-1 max-h-[200px] overflow-x-auto overflow-y-auto rounded-md border border-border/25 bg-muted/15 p-2 text-[10px] text-foreground/70">
                  {attempt.stderr}
                </pre>
              )}
            </div>
          )}

          {attempt.stack && (
            <div className="mt-2">
              <button
                type="button"
                className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground/80"
                onClick={() => setShowStack(!showStack)}
              >
                {showStack ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                {t('agent.retry.showStack')}
              </button>
              {showStack && (
                <pre className="mt-1 max-h-[200px] overflow-x-auto overflow-y-auto rounded-md border border-border/25 bg-muted/15 p-2 text-[10px] text-foreground/70">
                  {attempt.stack}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ===== RetryingNotice =====

export function RetryingNotice({ retrying }: { retrying: NonNullable<AgentStreamState['retrying']> }): React.ReactElement {
  const { t } = useTranslation()
  const [expanded, setExpanded] = React.useState(false)
  const [countdown, setCountdown] = React.useState(0)

  React.useEffect(() => {
    if (retrying.failed || retrying.history.length === 0) {
      setCountdown(0)
      return
    }

    const lastAttempt = retrying.history[retrying.history.length - 1]
    if (!lastAttempt) return

    const updateCountdown = (): void => {
      const elapsed = (Date.now() - lastAttempt.timestamp) / 1000
      const remaining = Math.max(0, lastAttempt.delaySeconds - elapsed)
      setCountdown(Math.ceil(remaining))

      if (remaining <= 0) {
        setCountdown(0)
      }
    }

    updateCountdown()

    const timer = setInterval(updateCountdown, 100)
    return () => clearInterval(timer)
  }, [retrying.failed, retrying.history])

  return (
    <div className="mb-1.5 overflow-hidden rounded-xl border border-border/35 bg-background/55">
      <button
        type="button"
        className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors hover:bg-muted/10"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/20">
          {retrying.failed ? (
            <AlertTriangle className="size-4 shrink-0 text-destructive" />
          ) : (
            <RotateCw className="size-4 shrink-0 animate-spin text-foreground/45" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">
            {retrying.failed ? t('agent.retry.failedTitle') : t('agent.retry.runningTitle')}
          </div>
          <div className="truncate text-[12px] text-muted-foreground/85">
          {retrying.failed
            ? t('agent.retry.failedCount', { current: retrying.currentAttempt, max: retrying.maxAttempts })
            : countdown > 0
              ? t('agent.retry.countdown', { seconds: countdown, current: retrying.currentAttempt, max: retrying.maxAttempts })
              : t('agent.retry.runningCount', { current: retrying.currentAttempt, max: retrying.maxAttempts })}
            {retrying.history.length > 0 && ` · ${retrying.history[retrying.history.length - 1]?.reason}`}
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="size-4 shrink-0 text-foreground/45" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-foreground/45" />
        )}
      </button>

      {expanded && retrying.history.length > 0 && (
        <div className="space-y-3 border-t border-border/20 px-2.5 py-2.5">
          <div className="text-[11px] font-medium text-muted-foreground">
            {t('agent.retry.attemptHistory')}
          </div>
          {retrying.history.map((attempt, index) => (
            <RetryAttemptItem
              key={attempt.timestamp}
              attempt={attempt}
              isLatest={index === retrying.history.length - 1}
              isFailed={retrying.failed && index === retrying.history.length - 1}
            />
          ))}
          {!retrying.failed && (
            <div className="flex items-center gap-2 pl-9 text-[11px] text-muted-foreground">
              {countdown > 0 ? (
                <>
                  <RotateCw className="size-3 animate-spin text-foreground/45" />
                  <span>{t('agent.retry.waitingNext', { seconds: countdown, attempt: retrying.currentAttempt })}</span>
                </>
              ) : (
                <>
                  <RotateCw className="size-3 animate-spin text-foreground/45" />
                  <span>{t('agent.retry.attemptRunning', { attempt: retrying.currentAttempt })}</span>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
