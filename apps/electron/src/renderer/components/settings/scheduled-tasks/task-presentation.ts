/**
 * 定时任务展示文案工具
 *
 * 列表页和详情页都要描述调度方式、会话模式和投递目标，统一放在这里，
 * 避免每个组件重复实现一份。
 */

import type { ScheduledTask } from '@kila/shared'
import type { TFunction } from 'i18next'

/** 调度方式描述（cron 直接展示表达式，属于代码标识符不翻译） */
export function describeSchedule(t: TFunction, task: ScheduledTask, locale: string): string {
  switch (task.schedule.kind) {
    case 'every':
      return t('settingsTasks.schedule.everyMinutes', { count: task.schedule.minutes })
    case 'cron':
      return task.schedule.expr
    case 'at':
      return new Date(task.schedule.at).toLocaleString(locale)
    case 'loop':
      return t('settingsTasks.schedule.loop')
  }
}

/** 会话模式描述 */
export function describeRunMode(t: TFunction, task: ScheduledTask): string {
  return task.runMode === 'single_session'
    ? t('settingsTasks.runMode.singleSession')
    : t('settingsTasks.runMode.newSession')
}

/** 结果投递目标描述 */
export function describeDelivery(t: TFunction, task: ScheduledTask): string {
  if (task.delivery.kind === 'none') return t('settingsTasks.delivery.none')
  if (task.delivery.kind === 'bridge_binding') {
    return `${task.delivery.channelType} · ${task.delivery.endpointKey}`
  }
  if (task.delivery.targets.length === 1) {
    const target = task.delivery.targets[0]
    return target
      ? `${target.channelType} · ${target.endpointKey}`
      : t('settingsTasks.delivery.none')
  }
  return t('settingsTasks.delivery.multipleTargets', { count: task.delivery.targets.length })
}

/** 完整日期时间（详情、运行历史） */
export function formatTaskDateTime(value: number | undefined, locale: string): string {
  if (!value) return '—'
  return new Date(value).toLocaleString(locale)
}

/** 紧凑日期时间（列表卡片） */
export function formatTaskShortDateTime(value: number | undefined, locale: string): string {
  if (!value) return '—'
  return new Date(value).toLocaleString(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
