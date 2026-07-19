import type { ScheduledTask, ScheduledTaskHealthState } from '@kila/shared'

export function getScheduledTaskHealthTone(
  state: ScheduledTaskHealthState | undefined,
): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
  switch (state) {
    case 'healthy':
      return 'success'
    case 'due_soon':
      return 'info'
    case 'late':
      return 'warning'
    case 'missed':
    case 'failing':
      return 'danger'
    case 'paused':
    default:
      return 'neutral'
  }
}

export function getScheduledTaskHealthLabel(task: ScheduledTask): string {
  switch (task.health?.state) {
    case 'healthy':
      return task.lastSuccessfulAt ? '当前已完成' : '状态健康'
    case 'due_soon':
      return '即将到期'
    case 'late':
      return '执行窗口中'
    case 'missed':
      return '已错过'
    case 'failing':
      return '最近失败'
    case 'paused':
      return '已暂停'
    default:
      if (task.lastError?.trim()) return '最近失败'
      if (task.executionCount > 0) return '最近完成'
      return '尚未执行'
  }
}

export function getScheduledTaskHealthReason(task: ScheduledTask): string {
  if (task.health?.reason?.trim()) {
    return task.health.reason
  }
  if (task.lastError?.trim()) {
    return '最近一次执行失败'
  }
  if (task.lastSuccessfulAt) {
    return '最近一次执行成功'
  }
  return '等待首次执行'
}
