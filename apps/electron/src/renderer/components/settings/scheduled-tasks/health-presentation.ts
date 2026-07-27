import type { ScheduledTask, ScheduledTaskHealthState } from '@kila/shared'
import type { TFunction } from 'i18next'

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

export function getScheduledTaskHealthLabel(t: TFunction, task: ScheduledTask): string {
  switch (task.health?.state) {
    case 'healthy':
      return task.lastSuccessfulAt
        ? t('settingsTasks.health.completed')
        : t('settingsTasks.health.healthy')
    case 'due_soon':
      return t('settingsTasks.health.dueSoon')
    case 'late':
      return t('settingsTasks.health.late')
    case 'missed':
      return t('settingsTasks.health.missed')
    case 'failing':
      return t('settingsTasks.health.failing')
    case 'paused':
      return t('settingsTasks.health.paused')
    default:
      if (task.lastError?.trim()) return t('settingsTasks.health.failing')
      if (task.executionCount > 0) return t('settingsTasks.health.recentlyCompleted')
      return t('settingsTasks.health.neverRun')
  }
}

export function getScheduledTaskHealthReason(t: TFunction, task: ScheduledTask): string {
  if (task.health?.reason?.trim()) {
    return task.health.reason
  }
  if (task.lastError?.trim()) {
    return t('settingsTasks.health.reasonLastFailed')
  }
  if (task.lastSuccessfulAt) {
    return t('settingsTasks.health.reasonLastSucceeded')
  }
  return t('settingsTasks.health.reasonWaitingFirstRun')
}
