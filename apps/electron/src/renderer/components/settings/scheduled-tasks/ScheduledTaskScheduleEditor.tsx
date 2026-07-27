import * as React from 'react'
import { useTranslation } from 'react-i18next'
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

/** 调度方式选项：label 是产品固定术语，hint 走本地化 */
const SCHEDULE_OPTIONS = [
  { value: 'every', label: 'Every', hintKey: 'settingsTasks.scheduleEditor.everyHint' },
  { value: 'cron', label: 'Cron', hintKey: 'settingsTasks.scheduleEditor.cronHint' },
  { value: 'at', label: 'At', hintKey: 'settingsTasks.scheduleEditor.atHint' },
  { value: 'loop', label: 'Loop', hintKey: 'settingsTasks.scheduleEditor.loopHint' },
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

function getScheduleHintKey(kind: ScheduledTaskSchedule['kind']): string {
  const option = SCHEDULE_OPTIONS.find((item) => item.value === kind)
  return option?.hintKey ?? ''
}

export function ScheduledTaskScheduleEditor({
  value,
  onChange,
}: ScheduledTaskScheduleEditorProps): React.ReactElement {
  const { t } = useTranslation()

  const cronPreview = React.useMemo(() => {
    if (value.kind !== 'cron') return null
    try {
      return cronstrue.toString(value.expr)
    } catch {
      return t('settingsTasks.scheduleEditor.cronInvalid')
    }
  }, [t, value])

  const scheduleKind = value.kind
  const hintKey = getScheduleHintKey(scheduleKind)

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold text-foreground">{t('settingsTasks.scheduleEditor.title')}</h4>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {hintKey ? t(hintKey) : ''}
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
                {t(option.hintKey)}
              </span>
            </Button>
          )
        })}
      </div>

      <div className="rounded-lg bg-muted/30 p-4">
        {value.kind === 'every' && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{t('settingsTasks.scheduleEditor.intervalMinutesLabel')}</Label>
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
              <Label>{t('settingsTasks.scheduleEditor.startAtLabel')}</Label>
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
                <Label>{t('settingsTasks.scheduleEditor.cronExprLabel')}</Label>
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
                <Label>{t('settingsTasks.scheduleEditor.timezoneLabel')}</Label>
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
            <Label>{t('settingsTasks.scheduleEditor.runAtLabel')}</Label>
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
            {t('settingsTasks.scheduleEditor.loopNotice')}
          </div>
        )}
      </div>
    </div>
  )
}
