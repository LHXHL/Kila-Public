import * as React from 'react'
import cronstrue from 'cronstrue'
import type { ScheduledTaskSchedule } from '@kila/shared'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface ScheduledTaskScheduleEditorProps {
  value: ScheduledTaskSchedule
  onChange: (value: ScheduledTaskSchedule) => void
}

const SCHEDULE_OPTIONS = [
  { value: 'every', label: 'Every', hint: '按固定分钟数重复执行' },
  { value: 'cron', label: 'Cron', hint: '用 cron 表达式精确定时' },
  { value: 'at', label: 'At', hint: '只在指定时间执行一次' },
  { value: 'loop', label: 'Loop', hint: '完成后自动继续，适合自治流程' },
] as const

function toDateTimeLocal(value: string | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hour = `${date.getHours()}`.padStart(2, '0')
  const minute = `${date.getMinutes()}`.padStart(2, '0')
  return `${year}-${month}-${day}T${hour}:${minute}`
}

function fromDateTimeLocal(value: string): string {
  return new Date(value).toISOString()
}

function getScheduleHint(kind: ScheduledTaskSchedule['kind']): string {
  const option = SCHEDULE_OPTIONS.find((item) => item.value === kind)
  return option?.hint ?? ''
}

export function ScheduledTaskScheduleEditor({
  value,
  onChange,
}: ScheduledTaskScheduleEditorProps): React.ReactElement {
  const cronPreview = React.useMemo(() => {
    if (value.kind !== 'cron') return null
    try {
      return cronstrue.toString(value.expr)
    } catch {
      return 'Cron 表达式无效'
    }
  }, [value])

  const scheduleKind = value.kind

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold text-foreground">调度方式</h4>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {getScheduleHint(scheduleKind)}
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        {SCHEDULE_OPTIONS.map((option) => {
          const active = scheduleKind === option.value
          return (
            <Button
              key={option.value}
              type="button"
              variant={active ? 'default' : 'outline'}
              className={cn(
                'h-auto flex-col items-start rounded-lg px-3 py-3 text-left',
                !active && 'bg-background/80',
              )}
              onClick={() => {
                if (option.value === 'every') {
                  onChange({ kind: 'every', minutes: 5 })
                  return
                }
                if (option.value === 'cron') {
                  onChange({ kind: 'cron', expr: '0 9 * * *' })
                  return
                }
                if (option.value === 'at') {
                  onChange({ kind: 'at', at: new Date(Date.now() + 3_600_000).toISOString() })
                  return
                }
                onChange({ kind: 'loop' })
              }}
            >
              <span className="text-sm font-semibold">{option.label}</span>
              <span className={cn('text-[11px] leading-5', active ? 'text-[hsl(var(--brand-soft-foreground))/0.82]' : 'text-muted-foreground')}>
                {option.hint}
              </span>
            </Button>
          )
        })}
      </div>

      <div className="rounded-lg bg-muted/30 p-4">
        {value.kind === 'every' && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>间隔分钟</Label>
              <Input
                type="number"
                min={5}
                step={5}
                value={String(value.minutes)}
                onChange={(event) => {
                  onChange({
                    ...value,
                    minutes: Math.max(5, Number(event.target.value || 5)),
                  })
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>起始时间（可选）</Label>
              <Input
                type="datetime-local"
                value={toDateTimeLocal(value.startAt)}
                onChange={(event) => {
                  const nextValue = event.target.value
                  onChange({
                    ...value,
                    startAt: nextValue ? fromDateTimeLocal(nextValue) : undefined,
                  })
                }}
              />
            </div>
          </div>
        )}

        {value.kind === 'cron' && (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-2">
                <Label>Cron 表达式</Label>
                <Input
                  value={value.expr}
                  onChange={(event) => {
                    onChange({
                      ...value,
                      expr: event.target.value,
                    })
                  }}
                  placeholder="0 9 * * *"
                />
              </div>
              <div className="space-y-2">
                <Label>时区（可选）</Label>
                <Input
                  value={value.tz ?? ''}
                  onChange={(event) => {
                    const nextValue = event.target.value.trim()
                    onChange({
                      ...value,
                      tz: nextValue || undefined,
                    })
                  }}
                  placeholder={Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'}
                />
              </div>
            </div>

            <div className="rounded-xl border border-border/50 bg-background/80 px-3.5 py-3 text-sm text-muted-foreground">
              {cronPreview}
            </div>
          </div>
        )}

        {value.kind === 'at' && (
          <div className="space-y-2">
            <Label>执行时间</Label>
            <Input
              type="datetime-local"
              value={toDateTimeLocal(value.at)}
              onChange={(event) => {
                onChange({
                  kind: 'at',
                  at: fromDateTimeLocal(event.target.value),
                })
              }}
            />
          </div>
        )}

        {value.kind === 'loop' && (
          <div className="rounded-lg bg-muted/35 px-4 py-3 text-sm leading-6 text-foreground/80">
            loop 模式会在每次完成后继续运行：成功 3 秒后重跑，失败按退避策略延迟，更适合自治型长期任务。
          </div>
        )}
      </div>
    </div>
  )
}
