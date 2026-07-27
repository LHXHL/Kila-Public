import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type {
  BridgeChannelType,
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskRunOutcome,
  ScheduledTaskRunRecord,
  ScheduledTaskRuntimeStatus,
  ScheduledTaskUpdateInput,
  ScheduledTaskUpdatedPayload,
  SessionCreateInput,
  SessionMessage,
  SessionMeta,
  SessionSendInput,
} from '@kila/shared'
import { createSession, getSessionMeta, listSessions } from './session-manager'
import { watchSessionProject } from './workspace-watcher'
import { runHeadlessSession, type HeadlessSessionRunResult } from './headless-session-runner'
import { ScheduledTaskStore, normalizeScheduledTask } from './scheduled-task-store'
import { clearScheduledTaskRunContext, consumeScheduledTaskExitReason, setScheduledTaskRunContext } from './scheduled-task-context'
import { resolveChannelModel } from './channel-model-resolution'
import {
  cloneTask,
  getLocalTimeZone,
  parseCronNextRunAt,
  trimErrorMessage,
  buildDelivery,
  normalizeDeliveryTargets,
  normalizeExecutionTarget,
  validateScheduleShape,
  computeInitialNextRunAt,
  computeScheduledTaskHealth,
  parseCronPreviousRunAt,
  buildSkippedRunRecord,
  DEFAULT_SCAN_INTERVAL_MS,
  DEFAULT_STARTUP_RECOVERY_DELAY_MS,
  DEFAULT_MAX_CONCURRENT_RUNS,
} from './scheduled-task-helpers'
import {
  applyRunResult,
  deliverRunResult,
  verifyBridgeDelivery,
  verifyLocalResult,
} from './scheduled-task-run-result'
import {
  computeSchedulerWatchdog,
  resolveHeartbeatStaleMs,
  ScheduledTaskRunTracker,
  DEFAULT_MAX_RUN_DURATION_MS,
  type ActiveRunSnapshot,
  type ExpiredRunReason,
} from './scheduled-task-scheduler'


import { createLogger } from './logger'
const log = createLogger('ScheduledTaskManager')

type ExtendedSessionSendInput = SessionSendInput & {
  extraTools?: unknown[]
}

export interface ScheduledTaskRunnerInput {
  sessionId: string
  sendInput: ExtendedSessionSendInput
}

interface ScheduledTaskStoreLike {
  loadTasks: () => ScheduledTask[]
  saveTasks: (tasks: ScheduledTask[]) => void
  appendRun: (taskId: string, run: ScheduledTaskRunRecord) => void
  listRuns: (taskId: string, limit?: number) => ScheduledTaskRunRecord[]
  deleteRuns: (taskId: string) => void
}

interface ScheduledTaskManagerDeps {
  createStore?: () => ScheduledTaskStoreLike
  createSession?: (input: SessionCreateInput) => SessionMeta
  getSessionMeta?: (sessionId: string) => SessionMeta | undefined
  listSessions?: () => SessionMeta[]
  watchSessionProject?: (sessionId: string, projectPath: string) => void
  getChannelExists?: (channelId: string) => boolean
  getModelEnabled?: (channelId: string, modelId: string) => boolean
  getFirstEnabledModelId?: (channelId: string) => string | undefined
  pathExists?: (targetPath: string) => boolean
  runHeadlessSession?: (input: ScheduledTaskRunnerInput) => Promise<HeadlessSessionRunResult>
  isSessionActive?: (sessionId: string) => boolean
  stopSession?: (sessionId: string) => void
  deliverScheduledTaskResult?: (input: {
    endpointKey: string
    channelType?: BridgeChannelType
    text: string
    sessionId?: string
    taskId: string
    isError?: boolean
  }) => Promise<void>
  appendSessionMessage?: (sessionId: string, message: SessionMessage) => void
  touchSession?: (sessionId: string) => void
  getForegroundSession?: () => SessionMeta | null
  parseCronNextRunAt?: (expr: string, tz: string | undefined, currentDate: number) => number
  now?: () => number
  setTimeoutFn?: (handler: () => void, timeout: number) => NodeJS.Timeout
  clearTimeoutFn?: (timer: NodeJS.Timeout) => void
  scanIntervalMs?: number
  startupRecoveryDelayMs?: number
  maxConcurrentRuns?: number
  maxRunDurationMs?: number
  getDefaultTimeZone?: () => string
  createRuntimeTools?: (input: { sessionId: string }) => unknown[]
}

// 重新导出纯函数供外部使用
export { parseCronNextRunAt } from './scheduled-task-helpers'

export class ScheduledTaskManager {
  private readonly store: ScheduledTaskStoreLike
  private readonly createSessionFn: (input: SessionCreateInput) => SessionMeta
  private readonly getSessionMetaFn: (sessionId: string) => SessionMeta | undefined
  private readonly listSessionsFn: () => SessionMeta[]
  private readonly watchSessionProjectFn: (sessionId: string, projectPath: string) => void
  private readonly getChannelExistsFn: (channelId: string) => boolean
  private readonly getModelEnabledFn: (channelId: string, modelId: string) => boolean
  private readonly getFirstEnabledModelIdFn: (channelId: string) => string | undefined
  private readonly pathExistsFn: (targetPath: string) => boolean
  private readonly runHeadlessSessionFn: (input: ScheduledTaskRunnerInput) => Promise<HeadlessSessionRunResult>
  private readonly isSessionActiveFn: (sessionId: string) => boolean
  private readonly stopSessionFn: (sessionId: string) => void
  private readonly deliverScheduledTaskResultFn?: ScheduledTaskManagerDeps['deliverScheduledTaskResult']
  private readonly appendSessionMessageFn: (sessionId: string, message: SessionMessage) => void
  private readonly touchSessionFn: (sessionId: string) => void
  private readonly getForegroundSessionFn: () => SessionMeta | null
  private readonly parseCronNextRunAtFn: NonNullable<ScheduledTaskManagerDeps['parseCronNextRunAt']>
  private readonly nowFn: () => number
  private readonly setTimeoutFn: (handler: () => void, timeout: number) => NodeJS.Timeout
  private readonly clearTimeoutFn: (timer: NodeJS.Timeout) => void
  private readonly scanIntervalMs: number
  private readonly startupRecoveryDelayMs: number
  private readonly maxConcurrentRuns: number
  private readonly maxRunDurationMs: number
  private readonly heartbeatStaleMs: number
  private readonly getDefaultTimeZone: () => string
  private readonly createRuntimeToolsFn: (input: { sessionId: string }) => unknown[]

  private readonly tasks = new Map<string, ScheduledTask>()
  private readonly runTracker: ScheduledTaskRunTracker
  private readonly listeners = new Set<(payload: ScheduledTaskUpdatedPayload) => void>()
  private readonly recoveredOverdueTasks = new Set<string>()
  private readonly loopFailureCounts = new Map<string, number>()
  private scanTimer: NodeJS.Timeout | null = null
  private recoveryTimer: NodeJS.Timeout | null = null
  private running = false
  private startupRecovering = false
  private startupTimestamp = 0
  private lastScanAt?: number
  private lastRecoveryAt?: number
  private lastPersistAt?: number

  constructor(deps?: ScheduledTaskManagerDeps) {
    this.store = deps?.createStore?.() ?? new ScheduledTaskStore()
    this.createSessionFn = deps?.createSession ?? createSession
    this.getSessionMetaFn = deps?.getSessionMeta ?? getSessionMeta
    this.listSessionsFn = deps?.listSessions ?? listSessions
    this.watchSessionProjectFn = deps?.watchSessionProject ?? watchSessionProject
    this.getChannelExistsFn = deps?.getChannelExists ?? ((channelId) => {
      const { getChannelById } = require('./channel-manager') as typeof import('./channel-manager')
      return Boolean(getChannelById(channelId))
    })
    this.getModelEnabledFn = deps?.getModelEnabled ?? ((channelId, modelId) => {
      const { getChannelById } = require('./channel-manager') as typeof import('./channel-manager')
      const channel = getChannelById(channelId)
      if (!channel) return false
      const model = channel.models.find((m) => m.id === modelId)
      return Boolean(model?.enabled)
    })
    this.getFirstEnabledModelIdFn = deps?.getFirstEnabledModelId ?? ((channelId) => {
      const { getChannelById } = require('./channel-manager') as typeof import('./channel-manager')
      const channel = getChannelById(channelId)
      if (!channel) return undefined
      const resolution = resolveChannelModel(channel)
      return resolution.ok ? resolution.modelId : undefined
    })
    this.pathExistsFn = deps?.pathExists ?? ((targetPath) => existsSync(targetPath))
    this.runHeadlessSessionFn = deps?.runHeadlessSession ?? runHeadlessSession
    this.isSessionActiveFn = deps?.isSessionActive ?? ((sessionId) => {
      const { isAgentSessionActive } = require('./agent-service') as typeof import('./agent-service')
      return isAgentSessionActive(sessionId)
    })
    this.stopSessionFn = deps?.stopSession ?? ((sessionId) => {
      const { stopSession } = require('./session-service') as typeof import('./session-service')
      stopSession(sessionId)
    })
    this.deliverScheduledTaskResultFn = deps?.deliverScheduledTaskResult
    this.appendSessionMessageFn = deps?.appendSessionMessage ?? ((sessionId, message) => {
      const { appendSessionMessage } = require('./session-manager') as typeof import('./session-manager')
      appendSessionMessage(sessionId, message)
    })
    this.touchSessionFn = deps?.touchSession ?? ((sessionId) => {
      const { updateSessionMeta } = require('./session-manager') as typeof import('./session-manager')
      updateSessionMeta(sessionId, {})
    })
    this.getForegroundSessionFn = deps?.getForegroundSession ?? (() => {
      const { getForegroundSession } = require('./settings-window-manager') as typeof import('./settings-window-manager')
      return getForegroundSession()
    })
    this.parseCronNextRunAtFn = deps?.parseCronNextRunAt ?? parseCronNextRunAt
    this.nowFn = deps?.now ?? Date.now
    this.setTimeoutFn = deps?.setTimeoutFn ?? setTimeout
    this.clearTimeoutFn = deps?.clearTimeoutFn ?? clearTimeout
    this.scanIntervalMs = deps?.scanIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS
    this.startupRecoveryDelayMs = deps?.startupRecoveryDelayMs ?? DEFAULT_STARTUP_RECOVERY_DELAY_MS
    this.maxConcurrentRuns = deps?.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS
    this.maxRunDurationMs = deps?.maxRunDurationMs ?? DEFAULT_MAX_RUN_DURATION_MS
    this.heartbeatStaleMs = resolveHeartbeatStaleMs(this.scanIntervalMs)
    this.getDefaultTimeZone = deps?.getDefaultTimeZone ?? getLocalTimeZone
    this.createRuntimeToolsFn = deps?.createRuntimeTools ?? ((input) => {
      const { createScheduledTaskRuntimeTools } = require('./pi-tools-bridge') as typeof import('./pi-tools-bridge')
      return createScheduledTaskRuntimeTools(input)
    })
    this.runTracker = new ScheduledTaskRunTracker({
      now: this.nowFn,
      setTimeoutFn: this.setTimeoutFn,
      clearTimeoutFn: this.clearTimeoutFn,
      maxRunDurationMs: this.maxRunDurationMs,
      heartbeatStaleMs: this.heartbeatStaleMs,
      isRunAlive: (sessionId) => this.isSessionActiveFn(sessionId),
      onExpired: (run, reason) => { this.finalizeExpiredRun(run, reason) },
    })
  }

  private emitUpdated(payload: ScheduledTaskUpdatedPayload): void {
    for (const listener of this.listeners) {
      listener(payload)
    }
  }

  private buildTaskView(task: ScheduledTask): ScheduledTask {
    const cloned = cloneTask(task)
    cloned.health = computeScheduledTaskHealth(
      cloned,
      this.nowFn(),
      this.parseCronNextRunAtFn,
      parseCronPreviousRunAt,
      this.getDefaultTimeZone,
    )
    return cloned
  }

  private getTaskAlertKey(task: ScheduledTask): string | null {
    const view = this.buildTaskView(task)
    if (!task.notifyOnMissedRun || view.health?.state !== 'missed') {
      return null
    }
    if (typeof view.health.expectedByAt === 'number') {
      return `missed:${view.health.expectedByAt}`
    }
    return `missed:${view.health.reason}`
  }

  private buildAlertText(task: ScheduledTask): string {
    const view = this.buildTaskView(task)
    const deadline = typeof view.health?.expectedByAt === 'number'
      ? `（deadline ${new Date(view.health.expectedByAt).toLocaleString('zh-CN')}）`
      : ''
    return `定时任务《${task.name}》已错过本轮完成窗口${deadline}。\n${view.health?.reason || '请检查任务配置或手动补跑一次。'}`
  }

  private resolveAlertSessionId(task: ScheduledTask): string | undefined {
    if (task.executionTarget.kind === 'single_session') {
      return task.executionTarget.sessionId
    }

    const foregroundSession = this.getForegroundSessionFn()
    if (foregroundSession?.id) {
      return foregroundSession.id
    }

    return task.lastSessionId
  }

  private async notifyMissedTasksIfNeeded(taskIds?: string[]): Promise<void> {
    const candidates = taskIds?.length
      ? taskIds.map((taskId) => this.tasks.get(taskId)).filter((task): task is ScheduledTask => Boolean(task))
      : [...this.tasks.values()]

    for (const task of candidates) {
      const alertKey = this.getTaskAlertKey(task)
      if (!alertKey || alertKey === task.lastMissedAlertKey) {
        continue
      }

      const text = this.buildAlertText(task)
      const localSessionId = this.resolveAlertSessionId(task)

      if (localSessionId) {
        try {
          this.appendSessionMessageFn(localSessionId, {
            id: randomUUID(),
            role: 'system',
            content: text,
            createdAt: this.nowFn(),
            messageSource: 'scheduled-task',
            messageSourceLabel: `定时任务提醒 · ${task.name}`,
            relatedTaskId: task.id,
          })
          this.touchSessionFn(localSessionId)
        } catch (error) {
          log.warn('[ScheduledTaskManager] 写入 missed-run 本地提醒失败', {
            taskId: task.id,
            sessionId: localSessionId,
            error: trimErrorMessage(error),
          })
        }
      }

      const deliveryTargets = normalizeDeliveryTargets(task.delivery)
      if (this.deliverScheduledTaskResultFn && deliveryTargets.length > 0) {
        for (const target of deliveryTargets) {
          try {
            await this.deliverScheduledTaskResultFn({
              endpointKey: target.endpointKey,
              channelType: target.channelType,
              text,
              sessionId: localSessionId,
              taskId: task.id,
              isError: true,
            })
          } catch (error) {
            log.warn('[ScheduledTaskManager] 投递 missed-run Bridge 提醒失败', {
              taskId: task.id,
              endpointKey: target.endpointKey,
              error: trimErrorMessage(error),
            })
          }
        }
      }

      const current = this.tasks.get(task.id)
      if (!current) continue
      this.tasks.set(task.id, normalizeScheduledTask({
        ...current,
        lastMissedAlertKey: alertKey,
        lastMissedAlertAt: this.nowFn(),
      }))
      this.persistTasks()
      this.emitUpdated({ taskId: task.id, reason: 'updated' })
    }
  }

  private updateTaskHeartbeat(taskId: string, timestamp: number): void {
    const current = this.tasks.get(taskId)
    if (!current) return

    this.tasks.set(taskId, normalizeScheduledTask({
      ...current,
      lastHeartbeatAt: timestamp,
    }))
    this.persistTasks()
  }

  /**
   * 巡检活跃 run：刷新心跳并回收卡死 run
   *
   * 运行时仍认为会话活跃即刷新心跳；心跳长期停滞说明底层 Promise 已经不会落地，
   * 由 tracker 走 onExpired 强制释放槽位。
   */
  private sweepActiveRuns(now: number): void {
    for (const run of this.runTracker.sweep(now)) {
      this.updateTaskHeartbeat(run.taskId, now)
    }
  }

  /**
   * 非阻塞派发一次执行
   *
   * 返回的 Promise 已吞掉异常，仅供启动补跑等待使用；扫描路径不得 await。
   */
  private dispatchTask(taskId: string, triggerSource: 'scheduler' | 'manual'): Promise<void> {
    return this.executeTask(taskId, triggerSource).catch((error) => {
      log.warn('[ScheduledTaskManager] 任务派发失败', { taskId, error: trimErrorMessage(error) })
    })
  }

  /** 超时/卡死回收：停止会话并落一条 error run 记录，槽位已由 tracker 释放 */
  private finalizeExpiredRun(run: ActiveRunSnapshot, reason: ExpiredRunReason): void {
    try {
      this.stopSessionFn(run.sessionId)
    } catch (error) {
      log.warn('[ScheduledTaskManager] 回收超时 run 时停止会话失败', {
        taskId: run.taskId,
        error: trimErrorMessage(error),
      })
    }
    clearScheduledTaskRunContext(run.sessionId)

    const task = this.tasks.get(run.taskId)
    if (!task) return

    const finishedAt = this.nowFn()
    const record: ScheduledTaskRunRecord = {
      id: randomUUID(),
      taskId: task.id,
      triggerSource: run.triggerSource,
      outcome: 'error',
      startedAt: run.startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - run.startedAt),
      sessionId: run.sessionId,
      error: reason === 'timeout'
        ? `任务执行超过最大时长 ${Math.round(this.maxRunDurationMs / 60_000)} 分钟，已强制中止`
        : '任务运行心跳已停止，判定为卡死并强制回收',
    }
    log.warn('[ScheduledTaskManager] 强制回收 run', { taskId: task.id, reason })

    this.recordRun(task, record)
    const updated = this.applyRunResult(task, record, { preserveStatus: task.status === 'stopped' })
    this.tasks.set(task.id, updated)
    this.persistTasks()
    this.emitUpdated({ taskId: task.id, reason: 'run-finished' })
  }

  private persistTasks(): void {
    this.store.saveTasks([...this.tasks.values()])
    this.lastPersistAt = this.nowFn()
  }

  private loadTasksFromStore(): void {
    this.tasks.clear()
    for (const task of this.store.loadTasks()) {
      this.tasks.set(task.id, normalizeScheduledTask(task))
    }
  }

  /**
   * 安排下一轮扫描
   *
   * 下一轮定时器在 tick 开始时立即重排，不等待本轮扫描/任务执行完成，
   * 因此单个长任务不会再冻结整个调度器。
   */
  private scheduleNextScan(): void {
    if (!this.running) return
    if (this.scanTimer) {
      this.clearTimeoutFn(this.scanTimer)
    }
    this.scanTimer = this.setTimeoutFn(() => {
      this.scheduleNextScan()
      void this.scanNow().catch((error) => {
        log.error('[ScheduledTaskManager] 定时扫描失败:', error)
      })
    }, this.scanIntervalMs)
  }

  private validateInput(input: ScheduledTaskCreateInput | ScheduledTaskUpdateInput, current?: ScheduledTask): void {
    const nextRunMode = input.runMode ?? current?.runMode
    const nextExecutionTarget = input.executionTarget ?? current?.executionTarget
    const nextSchedule = input.schedule ?? current?.schedule
    const nextChannelId = input.channelId ?? current?.channelId

    if (!nextRunMode || !nextExecutionTarget || !nextSchedule || !nextChannelId) {
      throw new Error('定时任务配置不完整')
    }

    validateScheduleShape(nextSchedule)
    normalizeExecutionTarget(nextRunMode, nextExecutionTarget)

    if (nextRunMode === 'new_session' && nextExecutionTarget.kind !== 'new_session') {
      throw new Error('new_session 任务缺少 projectPath')
    }

    if (nextRunMode === 'single_session' && nextExecutionTarget.kind !== 'single_session') {
      throw new Error('single_session 任务缺少 sessionId')
    }

    if (nextSchedule.kind === 'loop' && nextRunMode !== 'single_session') {
      throw new Error('loop 仅支持 single_session')
    }
  }

  private createTaskRecord(input: ScheduledTaskCreateInput): ScheduledTask {
    this.validateInput(input)
    const now = this.nowFn()

    return normalizeScheduledTask({
      id: randomUUID(),
      name: input.name.trim(),
      prompt: input.prompt,
      schedule: input.schedule,
      runMode: input.runMode,
      executionTarget: normalizeExecutionTarget(input.runMode, input.executionTarget),
      delivery: buildDelivery(input.delivery),
      status: 'stopped',
      channelId: input.channelId,
      modelId: input.modelId,
      thinkingLevel: input.thinkingLevel,
      historyTurns: input.historyTurns,
      enabledToolIds: input.enabledToolIds,
      additionalDirectories: input.additionalDirectories,
      resultVerifiers: input.resultVerifiers ?? [],
      permissionModeOverride: input.permissionModeOverride ?? 'auto',
      aiCanExit: input.schedule.kind === 'loop'
        ? (input.aiCanExit ?? true)
        : Boolean(input.aiCanExit),
      notifyOnMissedRun: Boolean(input.notifyOnMissedRun),
      createdAt: now,
      updatedAt: now,
      executionCount: 0,
    })
  }

  private updateTaskRecord(current: ScheduledTask, patch: ScheduledTaskUpdateInput): ScheduledTask {
    this.validateInput(patch, current)
    const updated: ScheduledTask = normalizeScheduledTask({
      ...current,
      ...patch,
      executionTarget: patch.executionTarget
        ? normalizeExecutionTarget(patch.runMode ?? current.runMode, patch.executionTarget)
        : current.executionTarget,
      delivery: buildDelivery(patch.delivery ?? current.delivery),
      resultVerifiers: patch.resultVerifiers ?? current.resultVerifiers ?? [],
      permissionModeOverride: patch.permissionModeOverride ?? current.permissionModeOverride ?? 'auto',
      aiCanExit: (patch.schedule ?? current.schedule).kind === 'loop'
        ? (patch.aiCanExit ?? current.aiCanExit ?? true)
        : Boolean(patch.aiCanExit ?? current.aiCanExit),
      notifyOnMissedRun: patch.notifyOnMissedRun ?? current.notifyOnMissedRun ?? false,
      updatedAt: this.nowFn(),
    })

    if (updated.status === 'running') {
      updated.nextRunAt = computeInitialNextRunAt(
        updated.schedule,
        this.nowFn(),
        this.parseCronNextRunAtFn,
        this.getDefaultTimeZone,
      )
    }

    return updated
  }

  private mutateTask(taskId: string, updater: (current: ScheduledTask) => ScheduledTask): ScheduledTask {
    const current = this.tasks.get(taskId)
    if (!current) {
      throw new Error(`定时任务不存在: ${taskId}`)
    }
    const next = updater(cloneTask(current))
    this.tasks.set(taskId, next)
    this.persistTasks()
    return cloneTask(next)
  }

  private resolveSessionTarget(task: ScheduledTask): {
    sessionId: string
    projectPath: string
    modelId: string
    session?: SessionMeta
  } | {
    invalid: true
    error: string
    stopReason: string
  } {
    if (!this.getChannelExistsFn(task.channelId)) {
      return {
        invalid: true,
        error: `渠道不存在或已失效: ${task.channelId}`,
        stopReason: 'invalid_config',
      }
    }

    if (task.modelId && !this.getModelEnabledFn(task.channelId, task.modelId)) {
      return {
        invalid: true,
        error: `模型不可用: ${task.modelId}（渠道 ${task.channelId} 中不存在或已禁用）`,
        stopReason: 'invalid_config',
      }
    }

    const resolvedModelId = task.modelId ?? this.getFirstEnabledModelIdFn(task.channelId)
    if (!resolvedModelId) {
      return {
        invalid: true,
        error: `渠道 ${task.channelId} 未配置可用模型`,
        stopReason: 'invalid_config',
      }
    }

    if (task.executionTarget.kind === 'new_session') {
      const projectPath = task.executionTarget.projectPath
      if (!projectPath || !this.pathExistsFn(projectPath)) {
        return {
          invalid: true,
          error: `项目目录不存在: ${projectPath || '未设置'}`,
          stopReason: 'invalid_config',
        }
      }
      return {
        sessionId: '',
        projectPath,
        modelId: resolvedModelId,
      }
    }

    const session = this.getSessionMetaFn(task.executionTarget.sessionId)
    if (!session) {
      return {
        invalid: true,
        error: `目标会话不存在: ${task.executionTarget.sessionId}`,
        stopReason: 'missing_target_session',
      }
    }

    return {
      sessionId: session.id,
      projectPath: session.project.path,
      modelId: resolvedModelId,
      session,
    }
  }

  /** applyRunResult 薄封装：注入 loop 失败计数与 cron 依赖 */
  private applyRunResult(
    task: ScheduledTask,
    run: ScheduledTaskRunRecord,
    options?: { preserveStatus?: boolean; stopReason?: string },
  ): ScheduledTask {
    return applyRunResult(task, run, {
      ...options,
      loopFailureCounts: this.loopFailureCounts,
      parseCronNextRunAt: this.parseCronNextRunAtFn,
      getDefaultTimeZone: this.getDefaultTimeZone,
    })
  }

  private recordRun(task: ScheduledTask, run: ScheduledTaskRunRecord): void {
    this.store.appendRun(task.id, run)
  }

  /** 任务有在跑的 run 时发出会话中止信号（删除/手动停止共用） */
  private stopActiveRunSession(task: ScheduledTask): void {
    if (!this.runTracker.has(task.id)) return
    const sessionId = this.runTracker.getSessionId(task.id)
      ?? (task.executionTarget.kind === 'single_session'
        ? task.executionTarget.sessionId
        : task.lastSessionId)
    if (sessionId) {
      this.stopSessionFn(sessionId)
    }
  }

  private async executeTask(
    taskId: string,
    triggerSource: 'scheduler' | 'manual',
    options?: {
      preserveStatus?: boolean
    },
  ): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error(`定时任务不存在: ${taskId}`)
    }

    if (this.runTracker.has(taskId)) {
      throw new Error('任务正在执行中')
    }

    const now = this.nowFn()
    const target = this.resolveSessionTarget(task)
    if ('invalid' in target) {
      const run = buildSkippedRunRecord(task.id, 'skipped_invalid_config', triggerSource, now, target.error)
      this.recordRun(task, run)
      const updated = this.applyRunResult({
        ...task,
        status: 'running',
      }, run, {
        preserveStatus: options?.preserveStatus,
        stopReason: target.stopReason,
      })
      this.tasks.set(task.id, updated)
      this.persistTasks()
      this.emitUpdated({ taskId: task.id, reason: 'run-finished' })
      return
    }

    if (triggerSource === 'manual' && this.runTracker.size >= this.maxConcurrentRuns) {
      throw new Error('当前后台并发已达上限')
    }

    if (this.runTracker.size >= this.maxConcurrentRuns) {
      const run = buildSkippedRunRecord(task.id, 'skipped_concurrency_limit', triggerSource, now)
      this.recordRun(task, run)
      const updated = this.applyRunResult(task, run, {
        preserveStatus: options?.preserveStatus,
        stopReason: 'skipped_concurrency_limit',
      })
      this.tasks.set(task.id, updated)
      this.persistTasks()
      this.emitUpdated({ taskId: task.id, reason: 'run-finished' })
      return
    }

    if (task.executionTarget.kind === 'single_session' && this.isSessionActiveFn(task.executionTarget.sessionId)) {
      if (triggerSource === 'manual') {
        throw new Error('目标会话正在执行中')
      }

      const run = buildSkippedRunRecord(task.id, 'skipped_busy', triggerSource, now)
      this.recordRun(task, run)
      const updated = this.applyRunResult(task, run, {
        preserveStatus: options?.preserveStatus,
        stopReason: 'skipped_busy',
      })
      this.tasks.set(task.id, updated)
      this.persistTasks()
      this.emitUpdated({ taskId: task.id, reason: 'run-finished' })
      return
    }

    let sessionId = target.sessionId
    if (task.executionTarget.kind === 'new_session') {
      const session = this.createSessionFn({
        title: task.name,
        projectPath: target.projectPath,
        channelId: task.channelId,
        modelId: target.modelId,
        thinkingLevel: task.thinkingLevel,
        historyTurns: task.historyTurns,
        enabledToolIds: task.enabledToolIds,
      })
      sessionId = session.id
      this.watchSessionProjectFn(session.id, session.project.path)
    }

    const startedAt = now
    const runToken = this.runTracker.begin({ taskId: task.id, sessionId, triggerSource, startedAt })
    this.updateTaskHeartbeat(task.id, startedAt)
    this.emitUpdated({ taskId: task.id, reason: 'run-started' })

    let runOwned = true
    let outcome: ScheduledTaskRunOutcome = 'success'
    let runError: string | undefined
    let finalReplyPreview: string | undefined
    let verificationSummary: string | undefined
    let stopReason: string | undefined
    let deliveryFailed = false

    try {
      setScheduledTaskRunContext(sessionId, {
        taskId: task.id,
        taskName: task.name,
        aiCanExit: task.aiCanExit,
      })

      const result = await this.runHeadlessSessionFn({
        sessionId,
        sendInput: {
          sessionId,
          userMessage: task.prompt,
          channelId: task.channelId,
          modelId: target.modelId,
          thinkingLevel: task.thinkingLevel,
          historyTurns: task.historyTurns,
          enabledToolIds: task.enabledToolIds,
          additionalDirectories: task.additionalDirectories,
          permissionModeOverride: task.permissionModeOverride,
          messageSource: task.executionTarget.kind === 'single_session' ? 'scheduled-task' : 'scheduled-task',
          messageSourceLabel: `定时任务 · ${task.name}`,
          relatedTaskId: task.id,
          extraTools: this.createRuntimeToolsFn({ sessionId }),
        },
      })

      if (result.ok) {
        finalReplyPreview = result.finalReply.slice(0, 2000)
        stopReason = consumeScheduledTaskExitReason(sessionId) ?? undefined
        if (stopReason) {
          outcome = 'stopped_by_ai'
        }

        const localVerification = verifyLocalResult(task, finalReplyPreview, target.projectPath, this.pathExistsFn)
        if (localVerification.error) {
          outcome = 'error'
          stopReason = undefined
          runError = localVerification.error
        } else {
          verificationSummary = localVerification.summary
        }
      } else {
        outcome = 'error'
        runError = result.error
      }
    } catch (error) {
      outcome = 'error'
      runError = trimErrorMessage(error)
    } finally {
      clearScheduledTaskRunContext(sessionId)
      runOwned = this.runTracker.end(task.id, runToken)
    }

    // 本次 run 已被超时/看门狗回收并落过 error 记录，禁止重复写回结果。
    if (!runOwned) {
      log.info('[ScheduledTaskManager] run 已被强制回收，跳过结果写回', { taskId: task.id })
      return
    }

    let currentTask = this.tasks.get(task.id)
    if (!currentTask) {
      log.info('[ScheduledTaskManager] 任务已删除，跳过运行结果写回', { taskId: task.id })
      return
    }

    const deliveryResult = await deliverRunResult({
      task: currentTask,
      outcome,
      sessionId,
      finalReply: finalReplyPreview,
      error: runError,
      deliver: this.deliverScheduledTaskResultFn,
    })
    runError = deliveryResult.error
    deliveryFailed = deliveryResult.deliveryFailed

    if (outcome !== 'error') {
      const bridgeVerification = verifyBridgeDelivery(currentTask, deliveryFailed)
      if (bridgeVerification.error) {
        outcome = 'error'
        stopReason = undefined
        runError = runError
          ? `${runError}\n${bridgeVerification.error}`
          : bridgeVerification.error
      } else if (bridgeVerification.summary) {
        verificationSummary = verificationSummary
          ? `${verificationSummary} / ${bridgeVerification.summary}`
          : bridgeVerification.summary
      }
    }

    currentTask = this.tasks.get(task.id)
    if (!currentTask) {
      log.info('[ScheduledTaskManager] 任务在投递期间被删除，跳过运行结果写回', { taskId: task.id })
      return
    }

    const finishedAt = this.nowFn()
    const run: ScheduledTaskRunRecord = {
      id: randomUUID(),
      taskId: task.id,
      triggerSource,
      outcome,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - startedAt),
      sessionId,
      finalReplyPreview,
      error: runError,
      verificationSummary,
    }
    this.recordRun(currentTask, run)

    const updated = this.applyRunResult(currentTask, run, {
      preserveStatus: options?.preserveStatus || currentTask.status === 'stopped',
      stopReason,
    })
    this.tasks.set(task.id, updated)
    this.persistTasks()
    this.emitUpdated({ taskId: task.id, reason: 'run-finished' })
    await this.notifyMissedTasksIfNeeded([task.id])
  }

  onUpdated(listener: (payload: ScheduledTaskUpdatedPayload) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async start(): Promise<void> {
    if (this.running) return
    this.loadTasksFromStore()
    this.running = true
    this.startupRecovering = true
    this.startupTimestamp = this.nowFn()
    this.lastScanAt = this.startupTimestamp
    this.scheduleNextScan()

    if (this.recoveryTimer) {
      this.clearTimeoutFn(this.recoveryTimer)
    }
    this.recoveryTimer = this.setTimeoutFn(() => {
      void this.recoverOverdueTasksNow()
    }, this.startupRecoveryDelayMs)

    await this.notifyMissedTasksIfNeeded()
  }

  shutdown(): void {
    this.running = false
    this.startupRecovering = false
    if (this.scanTimer) {
      this.clearTimeoutFn(this.scanTimer)
      this.scanTimer = null
    }
    if (this.recoveryTimer) {
      this.clearTimeoutFn(this.recoveryTimer)
      this.recoveryTimer = null
    }

    // 调度器停止后不能让已启动的 headless run 继续修改项目或写入会话。
    // stopSessionFn 只发出中止信号；executeTask 的 finally 仍负责完整清理上下文。
    // 这里只停掉超时定时器，保留 run 条目让在途 executeTask 正常收尾。
    this.runTracker.stopTimers()
    for (const sessionId of this.runTracker.activeSessionIds()) {
      this.stopSessionFn(sessionId)
    }
  }

  listTasks(): ScheduledTask[] {
    return [...this.tasks.values()]
      .map((task) => this.buildTaskView(task))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  getTask(taskId: string): ScheduledTask | null {
    const task = this.tasks.get(taskId)
    return task ? this.buildTaskView(task) : null
  }

  getRuntimeStatus(): ScheduledTaskRuntimeStatus {
    const base = {
      activeRunCount: this.runTracker.size,
      lastScanAt: this.lastScanAt,
      lastRecoveryAt: this.lastRecoveryAt,
      lastPersistAt: this.lastPersistAt,
    }

    if (!this.running) {
      return { ...base, running: false, watchdogState: 'idle', watchdogReason: '调度器当前未启动' }
    }

    const watchdog = computeSchedulerWatchdog({
      now: this.nowFn(),
      lastScanAt: this.lastScanAt,
      startupTimestamp: this.startupTimestamp,
      scanIntervalMs: this.scanIntervalMs,
      heartbeatStaleMs: this.heartbeatStaleMs,
      activeRuns: this.runTracker.snapshots(),
    })

    return {
      ...base,
      running: true,
      watchdogState: watchdog.state,
      watchdogReason: watchdog.reason,
    }
  }

  async createTask(input: ScheduledTaskCreateInput): Promise<ScheduledTask> {
    const task = this.createTaskRecord(input)
    this.tasks.set(task.id, task)
    this.persistTasks()
    this.emitUpdated({ taskId: task.id, reason: 'created' })
    return this.buildTaskView(task)
  }

  async updateTaskMeta(taskId: string, patch: ScheduledTaskUpdateInput): Promise<ScheduledTask> {
    const updated = this.mutateTask(taskId, (current) => this.updateTaskRecord(current, patch))
    this.emitUpdated({ taskId, reason: 'updated' })
    return this.buildTaskView(updated)
  }

  async updateTask(taskId: string, patch: ScheduledTaskUpdateInput): Promise<ScheduledTask> {
    return this.updateTaskMeta(taskId, patch)
  }

  async deleteTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task) return

    this.stopActiveRunSession(task)

    this.tasks.delete(taskId)
    this.loopFailureCounts.delete(taskId)
    this.recoveredOverdueTasks.delete(taskId)
    this.persistTasks()
    this.store.deleteRuns(taskId)
    this.emitUpdated({ taskId, reason: 'deleted' })
  }

  async startTask(taskId: string): Promise<ScheduledTask> {
    const updated = this.mutateTask(taskId, (current) => ({
      ...current,
      status: 'running',
      stopReason: undefined,
      lastError: current.lastError,
      lastHeartbeatAt: this.nowFn(),
      nextRunAt: computeInitialNextRunAt(
        current.schedule,
        this.nowFn(),
        this.parseCronNextRunAtFn,
        this.getDefaultTimeZone,
      ),
      updatedAt: this.nowFn(),
    }))
    this.emitUpdated({ taskId, reason: 'started' })
    return this.buildTaskView(updated)
  }

  async stopTask(taskId: string, reason = 'manual'): Promise<ScheduledTask> {
    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error(`定时任务不存在: ${taskId}`)
    }

    this.stopActiveRunSession(task)

    const updated = this.mutateTask(taskId, (current) => ({
      ...current,
      status: 'stopped',
      nextRunAt: undefined,
      stopReason: reason,
      updatedAt: this.nowFn(),
    }))
    this.emitUpdated({ taskId, reason: 'stopped' })
    return this.buildTaskView(updated)
  }

  async runTaskNow(taskId: string): Promise<void> {
    await this.executeTask(taskId, 'manual', { preserveStatus: true })
  }

  listRuns(taskId: string, limit = 50): ScheduledTaskRunRecord[] {
    return this.store.listRuns(taskId, limit)
  }

  listRunningTasksForSession(sessionId: string): ScheduledTask[] {
    return this.listTasks().filter((task) => (
      task.status === 'running'
      && task.runMode === 'single_session'
      && task.executionTarget.kind === 'single_session'
      && task.executionTarget.sessionId === sessionId
    ))
  }

  /**
   * 执行一轮扫描
   *
   * 到期任务只做非阻塞派发，并发由 runTracker 槽位与 maxConcurrentRuns 控制：
   * 超出上限的任务保持 nextRunAt 不变，留到下一轮扫描，不排队堆积。
   */
  async scanNow(): Promise<void> {
    const now = this.nowFn()
    this.lastScanAt = now
    this.sweepActiveRuns(now)

    const dueTasks = [...this.tasks.values()]
      .filter((task) => {
        if (task.status !== 'running') return false
        if (typeof task.nextRunAt !== 'number') return false
        // 长任务的 nextRunAt 要等本轮跑完才推进，期间不能重复派发。
        if (this.runTracker.has(task.id)) return false
        if (this.startupRecovering && task.nextRunAt <= this.startupTimestamp) {
          return false
        }
        return task.nextRunAt <= now
      })
      .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))

    for (const task of dueTasks) {
      if (this.runTracker.size >= this.maxConcurrentRuns) break
      void this.dispatchTask(task.id, 'scheduler')
    }

    await this.notifyMissedTasksIfNeeded()
  }

  async recoverOverdueTasksNow(): Promise<void> {
    this.lastRecoveryAt = this.nowFn()
    const overdueTasks = [...this.tasks.values()]
      .filter((task) => (
        task.status === 'running'
        && typeof task.nextRunAt === 'number'
        && task.nextRunAt <= this.startupTimestamp
        && !this.recoveredOverdueTasks.has(task.id)
        && !this.runTracker.has(task.id)
      ))
      .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))

    // 补跑同样受并发上限约束；未派发的逾期任务交给后续扫描处理。
    const dispatched: Array<Promise<void>> = []
    for (const task of overdueTasks) {
      if (this.runTracker.size >= this.maxConcurrentRuns) break
      this.recoveredOverdueTasks.add(task.id)
      dispatched.push(this.dispatchTask(task.id, 'scheduler'))
    }
    await Promise.all(dispatched)

    this.startupRecovering = false
    await this.notifyMissedTasksIfNeeded()
  }
}
