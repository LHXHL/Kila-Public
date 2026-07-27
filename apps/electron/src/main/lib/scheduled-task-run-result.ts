/**
 * 定时任务运行结果处理
 *
 * 从 ScheduledTaskManager 拆出的三块与实例状态无关的逻辑：
 * - 结果校验：本地校验（reply / file_exists）与 Bridge 投递校验
 * - 结果投递：按 failurePolicy 汇总多目标 Bridge 投递结果
 * - 运行结果写回：把一条 run 记录合并回任务状态，并推进 nextRunAt / stopReason
 */

import { isAbsolute, resolve } from 'node:path'
import type {
  BridgeChannelType,
  ScheduledTask,
  ScheduledTaskRunOutcome,
  ScheduledTaskRunRecord,
} from '@kila/shared'
import {
  cloneTask,
  computeRecurringNextRunAt,
  getDeliveryFailurePolicy,
  normalizeDeliveryTargets,
  shouldStopTaskAfterOutcome,
  trimErrorMessage,
  MAX_LOOP_FAILURES,
} from './scheduled-task-helpers'
import { createLogger } from './logger'

const log = createLogger('ScheduledTaskRunResult')

/** 单项校验结果：error 表示判定失败，summary 用于 run 记录展示 */
export interface VerificationResult {
  error?: string
  summary?: string
}

/** 相对路径按项目根目录解析，绝对路径原样使用 */
export function buildProjectFilePath(projectPath: string, candidatePath: string): string {
  return isAbsolute(candidatePath) ? candidatePath : resolve(projectPath, candidatePath)
}

/** 本地结果校验：final reply 非空 + 期望文件存在 */
export function verifyLocalResult(
  task: ScheduledTask,
  finalReplyPreview: string | undefined,
  projectPath: string,
  pathExists: (targetPath: string) => boolean,
): VerificationResult {
  const verifiers = (task.resultVerifiers ?? []).filter((verifier) => verifier.kind !== 'bridge_delivery_success')
  if (verifiers.length === 0) {
    return {}
  }

  const checks: string[] = []

  for (const verifier of verifiers) {
    if (verifier.kind === 'reply_non_empty') {
      if (!finalReplyPreview?.trim()) {
        return { error: '结果校验失败：要求 final reply 非空，但本次任务没有产出可用文本回复。' }
      }
      checks.push('reply_non_empty')
      continue
    }

    if (verifier.kind === 'file_exists') {
      if (!pathExists(buildProjectFilePath(projectPath, verifier.path))) {
        return { error: `结果校验失败：未找到期望文件 ${verifier.path}` }
      }
      checks.push(`file_exists:${verifier.path}`)
    }
  }

  return checks.length > 0 ? { summary: `已通过 ${checks.join(' / ')}` } : {}
}

/** Bridge 投递结果校验 */
export function verifyBridgeDelivery(task: ScheduledTask, deliveryFailed: boolean): VerificationResult {
  const requiresBridgeDelivery = (task.resultVerifiers ?? []).some((verifier) => verifier.kind === 'bridge_delivery_success')
  if (!requiresBridgeDelivery) {
    return {}
  }

  const targets = normalizeDeliveryTargets(task.delivery)
  if (targets.length === 0) {
    return { error: '结果校验失败：已启用 bridge_delivery_success，但当前任务没有配置结果投递。' }
  }

  if (deliveryFailed) {
    return { error: '结果校验失败：Bridge 结果投递没有成功完成。' }
  }

  return {
    summary: targets.length > 1
      ? `已通过 bridge_delivery_success(${targets.length} targets)`
      : '已通过 bridge_delivery_success',
  }
}

/** Bridge 结果投递函数（由主进程 im-bridge 注入） */
export type DeliverScheduledTaskResultFn = (input: {
  endpointKey: string
  channelType?: BridgeChannelType
  text: string
  sessionId?: string
  taskId: string
  isError?: boolean
}) => Promise<void>

export interface DeliverRunResultInput {
  task: ScheduledTask
  outcome: ScheduledTaskRunOutcome
  sessionId: string | undefined
  finalReply: string | undefined
  error: string | undefined
  deliver?: DeliverScheduledTaskResultFn
}

/**
 * 把本轮运行结果投递到所有 Bridge 目标
 *
 * failurePolicy='any' 时只要有一个目标成功即视为成功，否则要求全部成功。
 */
export async function deliverRunResult(
  input: DeliverRunResultInput,
): Promise<{ error?: string; deliveryFailed: boolean }> {
  const { task, outcome, sessionId, finalReply, error, deliver } = input
  const targets = normalizeDeliveryTargets(task.delivery)
  if (!deliver || targets.length === 0) {
    return { error, deliveryFailed: false }
  }

  const shouldDeliverSuccess = outcome === 'success' || outcome === 'stopped_by_ai'
  const shouldDeliverError = outcome === 'error'
  if (!shouldDeliverSuccess && !shouldDeliverError) {
    return { error, deliveryFailed: false }
  }

  const text = shouldDeliverSuccess
    ? (finalReply?.trim() || `任务《${task.name}》执行完成，但没有可发送的最终文本回复。`)
    : `任务《${task.name}》执行失败：${error || '未知错误'}`
  const failures: string[] = []
  let successCount = 0

  for (const target of targets) {
    try {
      await deliver({
        endpointKey: target.endpointKey,
        channelType: target.channelType,
        text,
        sessionId,
        taskId: task.id,
        ...(shouldDeliverError ? { isError: true } : {}),
      })
      successCount += 1
    } catch (deliveryError) {
      failures.push(`${target.endpointKey} (${target.channelType}): ${trimErrorMessage(deliveryError)}`)
    }
  }

  const deliveryFailed = getDeliveryFailurePolicy(task.delivery) === 'any'
    ? successCount === 0
    : failures.length > 0

  if (deliveryFailed) {
    const message = failures.join('; ')
    return {
      error: error ? `${error}\n投递失败：${message}` : `投递失败：${message}`,
      deliveryFailed: true,
    }
  }

  if (failures.length > 0) {
    log.warn('[定时任务] 部分 Bridge 结果投递失败，但 failurePolicy=any 已满足', {
      taskId: task.id,
      failures,
    })
  }

  return { error, deliveryFailed: false }
}

export interface ApplyRunResultOptions {
  preserveStatus?: boolean
  stopReason?: string
  /** loop 任务的连续失败计数（由调用方持有，本函数负责读写） */
  loopFailureCounts: Map<string, number>
  parseCronNextRunAt: (expr: string, tz: string | undefined, currentDate: number) => number
  getDefaultTimeZone: () => string
}

/**
 * 把一条 run 记录合并回任务状态
 *
 * 负责统计字段更新、终止判定、loop 退避与 nextRunAt 推进。
 */
export function applyRunResult(
  task: ScheduledTask,
  run: ScheduledTaskRunRecord,
  options: ApplyRunResultOptions,
): ScheduledTask {
  const now = run.finishedAt
  const outcome = run.outcome
  const next = cloneTask(task)
  next.updatedAt = now
  next.lastTriggeredAt = run.startedAt
  next.lastCompletedAt = run.finishedAt
  next.lastHeartbeatAt = run.finishedAt
  next.lastDurationMs = run.durationMs
  next.lastError = run.error
  if (outcome === 'success' || outcome === 'stopped_by_ai') {
    next.lastSuccessfulAt = run.finishedAt
  }
  next.executionCount += 1
  next.lastSessionId = run.sessionId ?? next.lastSessionId
  next.lastFinalReplyPreview = run.finalReplyPreview

  if (options.preserveStatus) {
    return next
  }

  if (shouldStopTaskAfterOutcome(task, outcome)) {
    next.status = 'stopped'
    next.nextRunAt = undefined
    next.stopReason = options.stopReason
      ?? (outcome === 'stopped_by_ai' ? 'stopped_by_ai' : task.schedule.kind === 'at' ? 'completed_once' : outcome)
    return next
  }

  if (task.schedule.kind === 'loop') {
    const failureCount = outcome === 'error'
      ? (options.loopFailureCounts.get(task.id) ?? 0) + 1
      : 0

    if (failureCount > 0) {
      options.loopFailureCounts.set(task.id, failureCount)
    } else {
      options.loopFailureCounts.delete(task.id)
    }

    if (failureCount >= MAX_LOOP_FAILURES) {
      next.status = 'stopped'
      next.nextRunAt = undefined
      next.stopReason = 'loop_failure_limit'
      next.lastError = run.error || `连续失败 ${failureCount} 次，已自动停止`
      return next
    }

    next.nextRunAt = computeRecurringNextRunAt(
      task.schedule,
      now,
      options.parseCronNextRunAt,
      options.getDefaultTimeZone,
      failureCount,
    )
    next.stopReason = undefined
    return next
  }

  if (outcome === 'error' || outcome === 'success' || outcome === 'skipped_busy' || outcome === 'skipped_concurrency_limit') {
    next.nextRunAt = computeRecurringNextRunAt(
      task.schedule,
      now,
      options.parseCronNextRunAt,
      options.getDefaultTimeZone,
    )
    next.stopReason = undefined
    return next
  }

  return next
}
