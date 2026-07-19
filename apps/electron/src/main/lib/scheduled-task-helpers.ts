/**
 * 定时任务纯函数与常量
 *
 * 从 ScheduledTaskManager 提取的所有无状态辅助函数。
 * 这些函数不依赖任何类实例状态，适合独立测试。
 */

import { randomUUID } from 'node:crypto'
import { CronExpressionParser } from 'cron-parser'
import type {
  ScheduledTask,
  ScheduledTaskDelivery,
  ScheduledTaskDeliveryTarget,
  ScheduledTaskExecutionTarget,
  ScheduledTaskHealth,
  ScheduledTaskRunOutcome,
  ScheduledTaskRunRecord,
  ScheduledTaskSchedule,
} from '@kila/shared'

export const DEFAULT_SCAN_INTERVAL_MS = 30_000
export const DEFAULT_STARTUP_RECOVERY_DELAY_MS = 15_000
export const DEFAULT_LOOP_SUCCESS_DELAY_MS = 3_000
export const DEFAULT_MAX_CONCURRENT_RUNS = 2
export const MIN_EVERY_MINUTES = 5
export const LOOP_FAILURE_BACKOFF_MS = [3_000, 10_000, 30_000, 60_000, 120_000, 300_000]
export const MAX_LOOP_FAILURES = 10
const SHORT_GRACE_MS = 15 * 60_000
const MEDIUM_GRACE_MS = 30 * 60_000
const LONG_GRACE_MS = 90 * 60_000
const DUE_SOON_MIN_MS = 10 * 60_000
const DUE_SOON_MAX_MS = 60 * 60_000
const MAX_MISSED_WINDOW_ITERATIONS = 64

export function cloneTask(task: ScheduledTask): ScheduledTask {
  return JSON.parse(JSON.stringify(task)) as ScheduledTask
}

export function getLocalTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

export function parseCronNextRunAt(
  expr: string,
  tz: string | undefined,
  currentDate: number,
): number {
  const interval = CronExpressionParser.parse(expr, {
    currentDate,
    tz: tz || getLocalTimeZone(),
  })
  const nextDate = interval.next() as { getTime?: () => number; toDate?: () => Date; toString: () => string }
  if (typeof nextDate.getTime === 'function') {
    return nextDate.getTime()
  }
  if (typeof nextDate.toDate === 'function') {
    return nextDate.toDate().getTime()
  }
  return new Date(nextDate.toString()).getTime()
}

export function parseCronPreviousRunAt(
  expr: string,
  tz: string | undefined,
  currentDate: number,
): number {
  const interval = CronExpressionParser.parse(expr, {
    currentDate,
    tz: tz || getLocalTimeZone(),
  })
  const previousDate = interval.prev() as { getTime?: () => number; toDate?: () => Date; toString: () => string }
  if (typeof previousDate.getTime === 'function') {
    return previousDate.getTime()
  }
  if (typeof previousDate.toDate === 'function') {
    return previousDate.toDate().getTime()
  }
  return new Date(previousDate.toString()).getTime()
}

export function trimErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function buildDelivery(delivery?: ScheduledTaskDelivery): ScheduledTaskDelivery {
  if (!delivery || delivery.kind === 'none') return { kind: 'none' }

  if (delivery.kind === 'bridge_binding') {
    return delivery.endpointKey.trim() && delivery.channelType
      ? {
          ...delivery,
          endpointKey: delivery.endpointKey.trim(),
        }
      : { kind: 'none' }
  }

  const seen = new Set<string>()
  const targets = delivery.targets.reduce<ScheduledTaskDeliveryTarget[]>((acc, target) => {
    const endpointKey = target.endpointKey.trim()
    if (!endpointKey || !target.channelType) return acc
    const key = `${target.channelType}:${endpointKey}`
    if (seen.has(key)) return acc
    seen.add(key)
    acc.push({
      endpointKey,
      channelType: target.channelType,
    })
    return acc
  }, [])

  if (targets.length === 0) return { kind: 'none' }
  return {
    kind: 'bridge_bindings',
    targets,
    failurePolicy: delivery.failurePolicy === 'any' ? 'any' : 'all',
  }
}

export function normalizeDeliveryTargets(delivery: ScheduledTaskDelivery): ScheduledTaskDeliveryTarget[] {
  if (delivery.kind === 'bridge_binding') {
    return [{ endpointKey: delivery.endpointKey, channelType: delivery.channelType }]
  }
  if (delivery.kind === 'bridge_bindings') {
    return delivery.targets
  }
  return []
}

export function getDeliveryFailurePolicy(delivery: ScheduledTaskDelivery): 'all' | 'any' {
  return delivery.kind === 'bridge_bindings' && delivery.failurePolicy === 'any' ? 'any' : 'all'
}

export function normalizeExecutionTarget(
  runMode: ScheduledTask['runMode'],
  executionTarget: ScheduledTaskExecutionTarget,
): ScheduledTaskExecutionTarget {
  if (runMode === 'new_session' && executionTarget.kind !== 'new_session') {
    throw new Error('new_session 任务必须绑定 new_session 目标')
  }
  if (runMode === 'single_session' && executionTarget.kind !== 'single_session') {
    throw new Error('single_session 任务必须绑定 single_session 目标')
  }
  return executionTarget
}

export function validateScheduleShape(schedule: ScheduledTaskSchedule): void {
  switch (schedule.kind) {
    case 'at': {
      if (!schedule.at || Number.isNaN(Date.parse(schedule.at))) {
        throw new Error('一次性任务时间无效')
      }
      return
    }
    case 'every': {
      if (!Number.isFinite(schedule.minutes) || schedule.minutes < MIN_EVERY_MINUTES) {
        throw new Error(`循环间隔最少 ${MIN_EVERY_MINUTES} 分钟`)
      }
      if (schedule.startAt && Number.isNaN(Date.parse(schedule.startAt))) {
        throw new Error('循环任务起始时间无效')
      }
      return
    }
    case 'cron': {
      parseCronNextRunAt(schedule.expr, schedule.tz, Date.now())
      return
    }
    case 'loop':
      return
  }
}

export function computeInitialNextRunAt(
  schedule: ScheduledTaskSchedule,
  now: number,
  parseCron: (expr: string, tz: string | undefined, currentDate: number) => number,
  getTimeZone: () => string,
): number | undefined {
  switch (schedule.kind) {
    case 'at': {
      const atMs = Date.parse(schedule.at)
      if (atMs <= now) {
        throw new Error('一次性任务的执行时间必须晚于当前时间')
      }
      return atMs
    }
    case 'every': {
      if (schedule.startAt) {
        const startAtMs = Date.parse(schedule.startAt)
        if (!Number.isNaN(startAtMs) && startAtMs > now) {
          return startAtMs
        }
      }
      return now + schedule.minutes * 60_000
    }
    case 'cron':
      return parseCron(schedule.expr, schedule.tz ?? getTimeZone(), now)
    case 'loop':
      return now + DEFAULT_LOOP_SUCCESS_DELAY_MS
  }
}

export function computeRecurringNextRunAt(
  schedule: ScheduledTaskSchedule,
  referenceTime: number,
  parseCron: (expr: string, tz: string | undefined, currentDate: number) => number,
  getTimeZone: () => string,
  loopFailureCount = 0,
): number | undefined {
  switch (schedule.kind) {
    case 'at':
      return undefined
    case 'every':
      return referenceTime + schedule.minutes * 60_000
    case 'cron':
      return parseCron(schedule.expr, schedule.tz ?? getTimeZone(), referenceTime)
    case 'loop': {
      if (loopFailureCount <= 0) {
        return referenceTime + DEFAULT_LOOP_SUCCESS_DELAY_MS
      }
      const delay = LOOP_FAILURE_BACKOFF_MS[Math.min(loopFailureCount - 1, LOOP_FAILURE_BACKOFF_MS.length - 1)]!
      return referenceTime + delay
    }
  }
}

export function shouldStopTaskAfterOutcome(task: ScheduledTask, outcome: ScheduledTaskRunOutcome): boolean {
  if (task.schedule.kind === 'at') {
    return true
  }
  return outcome === 'stopped_by_ai'
}

function formatHealthTime(value: number): string {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getEveryIntervalMs(schedule: Extract<ScheduledTaskSchedule, { kind: 'every' }>): number {
  return schedule.minutes * 60_000
}

function getScheduleIntervalMs(
  schedule: ScheduledTaskSchedule,
  occurrenceStartAt: number | undefined,
  parseCron: (expr: string, tz: string | undefined, currentDate: number) => number,
  getTimeZone: () => string,
): number | undefined {
  switch (schedule.kind) {
    case 'at':
      return undefined
    case 'every':
      return getEveryIntervalMs(schedule)
    case 'cron': {
      if (typeof occurrenceStartAt !== 'number') return undefined
      const nextAt = parseCron(schedule.expr, schedule.tz ?? getTimeZone(), occurrenceStartAt)
      return Number.isFinite(nextAt) ? Math.max(0, nextAt - occurrenceStartAt) : undefined
    }
    case 'loop':
      return undefined
  }
}

function computeScheduleGraceMs(
  schedule: ScheduledTaskSchedule,
  occurrenceStartAt: number | undefined,
  parseCron: (expr: string, tz: string | undefined, currentDate: number) => number,
  getTimeZone: () => string,
): number {
  const intervalMs = getScheduleIntervalMs(schedule, occurrenceStartAt, parseCron, getTimeZone)
  if (!intervalMs || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    return MEDIUM_GRACE_MS
  }
  if (intervalMs >= 12 * 60 * 60_000) {
    return LONG_GRACE_MS
  }
  if (intervalMs >= 60 * 60_000) {
    return MEDIUM_GRACE_MS
  }
  return Math.max(5 * 60_000, Math.min(SHORT_GRACE_MS, Math.floor(intervalMs / 3)))
}

function computeDueSoonWindowMs(
  schedule: ScheduledTaskSchedule,
  occurrenceStartAt: number | undefined,
  parseCron: (expr: string, tz: string | undefined, currentDate: number) => number,
  getTimeZone: () => string,
): number {
  const intervalMs = getScheduleIntervalMs(schedule, occurrenceStartAt, parseCron, getTimeZone)
  if (!intervalMs || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    return SHORT_GRACE_MS
  }
  return Math.max(DUE_SOON_MIN_MS, Math.min(DUE_SOON_MAX_MS, Math.floor(intervalMs / 8)))
}

function getPreviousScheduledAt(
  schedule: ScheduledTaskSchedule,
  referenceAt: number,
  parseCron: (expr: string, tz: string | undefined, currentDate: number) => number,
  getTimeZone: () => string,
): number | undefined {
  switch (schedule.kind) {
    case 'at': {
      const atMs = Date.parse(schedule.at)
      return atMs < referenceAt ? atMs : undefined
    }
    case 'every':
      return referenceAt - getEveryIntervalMs(schedule)
    case 'cron':
      return parseCron(schedule.expr, schedule.tz ?? getTimeZone(), referenceAt)
    case 'loop':
      return undefined
  }
}

function getNextScheduledAt(
  schedule: ScheduledTaskSchedule,
  referenceAt: number,
  parseCron: (expr: string, tz: string | undefined, currentDate: number) => number,
  getTimeZone: () => string,
): number | undefined {
  switch (schedule.kind) {
    case 'at': {
      const atMs = Date.parse(schedule.at)
      return atMs > referenceAt ? atMs : undefined
    }
    case 'every':
      return referenceAt + getEveryIntervalMs(schedule)
    case 'cron':
      return parseCron(schedule.expr, schedule.tz ?? getTimeZone(), referenceAt)
    case 'loop':
      return undefined
  }
}

function buildHealth(
  state: ScheduledTaskHealth['state'],
  reason: string,
  missedRunCount: number,
  expectedByAt?: number,
): ScheduledTaskHealth {
  return {
    state,
    reason,
    missedRunCount,
    expectedByAt,
  }
}

function hasSuccessSince(task: ScheduledTask, windowStartAt: number): boolean {
  return typeof task.lastSuccessfulAt === 'number' && task.lastSuccessfulAt >= windowStartAt
}

function hasFailureSince(task: ScheduledTask, windowStartAt: number): boolean {
  return Boolean(task.lastError?.trim())
    && typeof task.lastCompletedAt === 'number'
    && task.lastCompletedAt >= windowStartAt
    && (!task.lastSuccessfulAt || task.lastSuccessfulAt < windowStartAt)
}

function getMostRecentScheduledAt(
  task: ScheduledTask,
  now: number,
  parseCronPrevious: (expr: string, tz: string | undefined, currentDate: number) => number,
  getTimeZone: () => string,
): number | undefined {
  switch (task.schedule.kind) {
    case 'loop':
      return undefined
    case 'at': {
      const atMs = Date.parse(task.schedule.at)
      return atMs <= now ? atMs : undefined
    }
    case 'every':
      if (typeof task.nextRunAt === 'number') {
        return task.nextRunAt > now
          ? getPreviousScheduledAt(task.schedule, task.nextRunAt, parseCronPrevious, getTimeZone)
          : task.nextRunAt
      }
      return now - getEveryIntervalMs(task.schedule)
    case 'cron':
      if (typeof task.nextRunAt === 'number') {
        return task.nextRunAt > now
          ? getPreviousScheduledAt(task.schedule, task.nextRunAt, parseCronPrevious, getTimeZone)
          : task.nextRunAt
      }
      return parseCronPrevious(task.schedule.expr, task.schedule.tz ?? getTimeZone(), now)
  }
}

function countMissedRunWindows(
  task: ScheduledTask,
  now: number,
  parseCronNext: (expr: string, tz: string | undefined, currentDate: number) => number,
  parseCronPrevious: (expr: string, tz: string | undefined, currentDate: number) => number,
  getTimeZone: () => string,
): number {
  if (task.schedule.kind === 'loop') {
    return 0
  }

  let currentOccurrence = getMostRecentScheduledAt(task, now, parseCronPrevious, getTimeZone)
  const lowerBound = Math.max(task.createdAt, task.lastSuccessfulAt ?? task.createdAt)
  let count = 0
  let iterations = 0

  while (typeof currentOccurrence === 'number' && currentOccurrence > lowerBound && iterations < MAX_MISSED_WINDOW_ITERATIONS) {
    const deadlineAt = currentOccurrence + computeScheduleGraceMs(task.schedule, currentOccurrence, parseCronNext, getTimeZone)
    if (deadlineAt <= now) {
      count += 1
    }
    currentOccurrence = getPreviousScheduledAt(task.schedule, currentOccurrence, parseCronPrevious, getTimeZone)
    iterations += 1
  }

  return count
}

function computeStoppedTaskHealth(
  task: ScheduledTask,
): ScheduledTaskHealth {
  if (task.schedule.kind === 'at' && typeof task.lastSuccessfulAt === 'number') {
    return buildHealth('healthy', `一次性任务已于 ${formatHealthTime(task.lastSuccessfulAt)} 完成`, 0)
  }

  if (task.lastError?.trim()) {
    return buildHealth('paused', `任务已停止，最近错误：${task.lastError.trim()}`, 0)
  }

  if (typeof task.lastSuccessfulAt === 'number') {
    return buildHealth('paused', `任务已暂停，上次成功于 ${formatHealthTime(task.lastSuccessfulAt)}`, 0)
  }

  return buildHealth('paused', task.executionCount > 0 ? '任务当前已暂停' : '任务已暂停，等待首次执行', 0)
}

function computeAtTaskHealth(
  task: ScheduledTask,
  now: number,
): ScheduledTaskHealth {
  const schedule = task.schedule as Extract<ScheduledTaskSchedule, { kind: 'at' }>
  const dueAt = Date.parse(schedule.at)
  const expectedByAt = dueAt + MEDIUM_GRACE_MS

  if (typeof task.lastSuccessfulAt === 'number' && task.lastSuccessfulAt >= dueAt) {
    return buildHealth('healthy', `一次性任务已于 ${formatHealthTime(task.lastSuccessfulAt)} 完成`, 0)
  }

  if (now > expectedByAt) {
    return buildHealth(
      'missed',
      `一次性任务未在 ${formatHealthTime(expectedByAt)} 前成功完成`,
      1,
      expectedByAt,
    )
  }

  if (Boolean(task.lastError?.trim()) && typeof task.lastCompletedAt === 'number' && task.lastCompletedAt >= dueAt) {
    return buildHealth(
      'failing',
      `一次性任务最近一次执行失败，需要在 ${formatHealthTime(expectedByAt)} 前补上`,
      0,
      expectedByAt,
    )
  }

  if (now >= dueAt) {
    return buildHealth(
      'late',
      `一次性任务已到执行时间，需在 ${formatHealthTime(expectedByAt)} 前完成`,
      0,
      expectedByAt,
    )
  }

  const dueSoonWindowMs = Math.max(DUE_SOON_MIN_MS, Math.min(DUE_SOON_MAX_MS, Math.floor((dueAt - task.createdAt) / 8)))
  const state: ScheduledTaskHealth['state'] = dueAt - now <= dueSoonWindowMs ? 'due_soon' : 'healthy'
  return buildHealth(
    state,
    `任务计划于 ${formatHealthTime(dueAt)} 执行`,
    0,
    expectedByAt,
  )
}

function computeLoopTaskHealth(task: ScheduledTask): ScheduledTaskHealth {
  if (Boolean(task.lastError?.trim())) {
    return buildHealth(
      'failing',
      typeof task.lastCompletedAt === 'number'
        ? `loop 最近一次失败于 ${formatHealthTime(task.lastCompletedAt)}`
        : 'loop 最近一次执行失败',
      0,
      task.nextRunAt,
    )
  }

  if (typeof task.lastSuccessfulAt === 'number') {
    return buildHealth(
      'healthy',
      `loop 正在运行，上次成功于 ${formatHealthTime(task.lastSuccessfulAt)}`,
      0,
      task.nextRunAt,
    )
  }

  return buildHealth(
    'healthy',
    task.executionCount > 0 ? 'loop 正在运行，等待下一轮结果' : 'loop 已启动，等待首个结果',
    0,
    task.nextRunAt,
  )
}

function computeRecurringTaskHealth(
  task: ScheduledTask,
  now: number,
  parseCronNext: (expr: string, tz: string | undefined, currentDate: number) => number,
  parseCronPrevious: (expr: string, tz: string | undefined, currentDate: number) => number,
  getTimeZone: () => string,
): ScheduledTaskHealth {
  const upcomingAt = typeof task.nextRunAt === 'number'
    ? task.nextRunAt
    : getNextScheduledAt(task.schedule, now, parseCronNext, getTimeZone)
  const currentWindowStartAt = typeof upcomingAt === 'number' && upcomingAt > now
    ? getPreviousScheduledAt(task.schedule, upcomingAt, parseCronPrevious, getTimeZone)
    : upcomingAt

  if (typeof currentWindowStartAt === 'number' && !hasSuccessSince(task, currentWindowStartAt)) {
    const expectedByAt = currentWindowStartAt + computeScheduleGraceMs(
      task.schedule,
      currentWindowStartAt,
      parseCronNext,
      getTimeZone,
    )
    const failedInWindow = hasFailureSince(task, currentWindowStartAt)

    if (now > expectedByAt) {
      const missedRunCount = countMissedRunWindows(task, now, parseCronNext, parseCronPrevious, getTimeZone)
      return buildHealth(
        'missed',
        failedInWindow
          ? `本轮任务未在 ${formatHealthTime(expectedByAt)} 前成功完成，最近一次执行失败`
          : `本轮任务已错过截止时间 ${formatHealthTime(expectedByAt)}`,
        missedRunCount,
        expectedByAt,
      )
    }

    return buildHealth(
      failedInWindow ? 'failing' : 'late',
      failedInWindow
        ? `本轮任务最近一次执行失败，需要在 ${formatHealthTime(expectedByAt)} 前补上`
        : `本轮任务已进入执行窗口，需在 ${formatHealthTime(expectedByAt)} 前完成`,
      0,
      expectedByAt,
    )
  }

  if (typeof upcomingAt === 'number') {
    const expectedByAt = upcomingAt + computeScheduleGraceMs(task.schedule, upcomingAt, parseCronNext, getTimeZone)
    const dueSoonWindowMs = computeDueSoonWindowMs(task.schedule, upcomingAt, parseCronNext, getTimeZone)
    const state: ScheduledTaskHealth['state'] = upcomingAt - now <= dueSoonWindowMs ? 'due_soon' : 'healthy'
    if (typeof task.lastSuccessfulAt === 'number') {
      return buildHealth(
        state,
        state === 'due_soon'
          ? `当前窗口已完成，下一次将在 ${formatHealthTime(upcomingAt)} 触发`
          : `当前窗口已完成，上次成功于 ${formatHealthTime(task.lastSuccessfulAt)}`,
        0,
        expectedByAt,
      )
    }
    return buildHealth(
      state,
      state === 'due_soon'
        ? `等待首次执行，下一次将在 ${formatHealthTime(upcomingAt)} 触发`
        : `等待首次执行，计划于 ${formatHealthTime(upcomingAt)} 开始`,
      0,
      expectedByAt,
    )
  }

  if (typeof task.lastSuccessfulAt === 'number') {
    return buildHealth('healthy', `上次成功于 ${formatHealthTime(task.lastSuccessfulAt)}`, 0)
  }

  return buildHealth('healthy', '等待首次执行', 0)
}

export function computeScheduledTaskHealth(
  task: ScheduledTask,
  now: number,
  parseCronNext: (expr: string, tz: string | undefined, currentDate: number) => number,
  parseCronPrevious: (expr: string, tz: string | undefined, currentDate: number) => number,
  getTimeZone: () => string,
): ScheduledTaskHealth {
  if (task.status === 'stopped') {
    return computeStoppedTaskHealth(task)
  }

  if (task.schedule.kind === 'loop') {
    return computeLoopTaskHealth(task)
  }

  if (task.schedule.kind === 'at') {
    return computeAtTaskHealth(task, now)
  }

  return computeRecurringTaskHealth(task, now, parseCronNext, parseCronPrevious, getTimeZone)
}

export function buildSkippedRunRecord(
  taskId: string,
  outcome: ScheduledTaskRunOutcome,
  triggerSource: 'scheduler' | 'manual',
  timestamp: number,
  error?: string,
): ScheduledTaskRunRecord {
  return {
    id: randomUUID(),
    taskId,
    triggerSource,
    outcome,
    startedAt: timestamp,
    finishedAt: timestamp,
    durationMs: 0,
    error,
  }
}
