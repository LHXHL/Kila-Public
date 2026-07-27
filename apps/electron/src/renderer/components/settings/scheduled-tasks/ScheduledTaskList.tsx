import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { ScheduledTask } from '@kila/shared'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getStatusToneClasses } from '@/lib/theme/status-tone'
import {
  getScheduledTaskHealthLabel,
  getScheduledTaskHealthReason,
  getScheduledTaskHealthTone,
} from './health-presentation'
import { describeRunMode, describeSchedule, formatTaskShortDateTime } from './task-presentation'

interface ScheduledTaskListProps {
  tasks: ScheduledTask[]
  selectedTaskId: string | null
  onSelect: (taskId: string) => void
  onCreate: () => void
}

export function ScheduledTaskList({
  tasks,
  selectedTaskId,
  onSelect,
  onCreate,
}: ScheduledTaskListProps): React.ReactElement {
  const { t, i18n } = useTranslation()
  const runningCount = tasks.filter((task) => task.status === 'running').length

  return (
    <section className="surface-panel overflow-hidden rounded-xl">
      <div className="flex items-start justify-between gap-3 px-4 py-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground">{t('settingsTasks.list.title')}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {t('settingsTasks.list.summary', { total: tasks.length, running: runningCount })}
          </p>
        </div>
        <Button type="button" size="sm" className="shrink-0 rounded-lg px-3" onClick={onCreate}>
          {t('settingsTasks.list.create')}
        </Button>
      </div>

      {tasks.length === 0 && (
        <div className="border-t border-border/50 px-4 py-8">
          <div className="text-sm font-medium text-foreground">{t('settingsTasks.list.emptyTitle')}</div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {t('settingsTasks.list.emptyDescription')}
          </p>
        </div>
      )}

      {tasks.length > 0 && (
        <div className="border-t border-border/50">
          {tasks.map((task) => {
            const selected = selectedTaskId === task.id
            const healthTone = getStatusToneClasses(getScheduledTaskHealthTone(task.health?.state))
            return (
              <button
                key={task.id}
                type="button"
                className={cn(
                  'w-full border-b border-border/45 px-4 py-3.5 text-left transition-colors last:border-b-0',
                  selected ? 'bg-accent/65' : 'hover:bg-muted/35',
                )}
                onClick={() => onSelect(task.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">{task.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {describeRunMode(t, task)} · {describeSchedule(t, task, i18n.language)}
                    </div>
                  </div>
                  <span className={cn(
                    'shrink-0 text-xs font-medium',
                    task.status === 'running' ? getStatusToneClasses('success').text : 'text-muted-foreground',
                  )}>
                    {task.status === 'running'
                      ? t('settingsTasks.status.running')
                      : t('settingsTasks.status.stopped')}
                  </span>
                </div>

                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">{t('settingsTasks.list.nextRun')}</dt>
                  <dd className="truncate text-right tabular-nums text-foreground/85">
                    {formatTaskShortDateTime(task.nextRunAt, i18n.language)}
                  </dd>
                  <dt className="text-muted-foreground">{t('settingsTasks.list.health')}</dt>
                  <dd className={cn('truncate text-right font-medium', healthTone.text)}>
                    {getScheduledTaskHealthLabel(t, task)}
                  </dd>
                  <dt className="text-muted-foreground">{t('settingsTasks.list.executions')}</dt>
                  <dd className="truncate text-right text-muted-foreground">
                    {t('settingsTasks.list.executionSummary', {
                      count: task.executionCount,
                      reason: getScheduledTaskHealthReason(t, task),
                    })}
                  </dd>
                </dl>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
