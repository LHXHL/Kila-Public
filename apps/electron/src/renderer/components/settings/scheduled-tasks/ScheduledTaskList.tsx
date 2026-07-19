import * as React from 'react'
import type { ScheduledTask } from '@kila/shared'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getStatusToneClasses } from '@/lib/theme/status-tone'
import {
  getScheduledTaskHealthLabel,
  getScheduledTaskHealthReason,
  getScheduledTaskHealthTone,
} from './health-presentation'

interface ScheduledTaskListProps {
  tasks: ScheduledTask[]
  selectedTaskId: string | null
  onSelect: (taskId: string) => void
  onCreate: () => void
}

function describeSchedule(task: ScheduledTask): string {
  switch (task.schedule.kind) {
    case 'every':
      return `每 ${task.schedule.minutes} 分钟`
    case 'cron':
      return task.schedule.expr
    case 'at':
      return new Date(task.schedule.at).toLocaleString('zh-CN')
    case 'loop':
      return 'loop 连续执行'
  }
}

function describeRunMode(task: ScheduledTask): string {
  return task.runMode === 'single_session' ? '连续会话' : '新建会话'
}

function formatTimestamp(value?: number): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getStatusLabel(task: ScheduledTask): string {
  return task.status === 'running' ? '运行中' : '已停止'
}

export function ScheduledTaskList({
  tasks,
  selectedTaskId,
  onSelect,
  onCreate,
}: ScheduledTaskListProps): React.ReactElement {
  const runningCount = tasks.filter((task) => task.status === 'running').length

  return (
    <section className="surface-panel overflow-hidden rounded-xl">
      <div className="flex items-start justify-between gap-3 px-4 py-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground">任务</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            共 {tasks.length} 个，{runningCount} 个运行中
          </p>
        </div>
        <Button type="button" size="sm" className="shrink-0 rounded-lg px-3" onClick={onCreate}>
          新建
        </Button>
      </div>

      {tasks.length === 0 && (
        <div className="border-t border-border/50 px-4 py-8">
          <div className="text-sm font-medium text-foreground">还没有定时任务</div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            创建任务后，可在这里查看调度状态和最近执行结果。
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
                      {describeRunMode(task)} · {describeSchedule(task)}
                    </div>
                  </div>
                  <span className={cn(
                    'shrink-0 text-xs font-medium',
                    task.status === 'running' ? getStatusToneClasses('success').text : 'text-muted-foreground',
                  )}>
                    {getStatusLabel(task)}
                  </span>
                </div>

                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">下一次</dt>
                  <dd className="truncate text-right tabular-nums text-foreground/85">{formatTimestamp(task.nextRunAt)}</dd>
                  <dt className="text-muted-foreground">健康度</dt>
                  <dd className={cn('truncate text-right font-medium', healthTone.text)}>{getScheduledTaskHealthLabel(task)}</dd>
                  <dt className="text-muted-foreground">执行</dt>
                  <dd className="truncate text-right text-muted-foreground">
                    {task.executionCount} 次 · {getScheduledTaskHealthReason(task)}
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
