/**
 * 定时任务调度基础设施
 *
 * 从 ScheduledTaskManager 拆出的两块与业务逻辑无关的调度机制：
 * - 活跃 run 追踪：并发槽位、会话映射、run token（防止过期 run 重复写回结果）
 * - run 超时与心跳看门狗：单次执行超时、运行时已死但 Promise 未落地的孤儿 run 回收
 * - 调度器健康度判定：区分“扫描循环卡住”与“有长任务在跑”
 */

/** 单次 run 的最大执行时长，超过后强制中止并释放并发槽位 */
export const DEFAULT_MAX_RUN_DURATION_MS = 30 * 60_000

/** run 心跳停滞判定：至少覆盖 4 个扫描周期 */
export const RUN_HEARTBEAT_STALE_FACTOR = 4

/** 心跳停滞判定下限，避免扫描周期被调得过短时误杀正常任务 */
export const MIN_RUN_HEARTBEAT_STALE_MS = 5 * 60_000

/** run 启动后的心跳宽限期：运行时注册会话需要时间，期间不做卡死判定 */
export const RUN_HEARTBEAT_GRACE_MS = 60_000

/** 由心跳阈值参数推导实际使用的停滞判定窗口 */
export function resolveHeartbeatStaleMs(scanIntervalMs: number): number {
  return Math.max(scanIntervalMs * RUN_HEARTBEAT_STALE_FACTOR, MIN_RUN_HEARTBEAT_STALE_MS)
}

/** run 被强制回收的原因 */
export type ExpiredRunReason = 'timeout' | 'stuck'

/** 活跃 run 的只读快照 */
export interface ActiveRunSnapshot {
  taskId: string
  sessionId: string
  /** 本次 run 的触发来源，回收时用于记录 run 历史 */
  triggerSource: 'scheduler' | 'manual'
  startedAt: number
  lastHeartbeatAt: number
}

interface ActiveRun extends ActiveRunSnapshot {
  token: number
  timer: NodeJS.Timeout | null
}

export interface ScheduledTaskRunTrackerOptions {
  now: () => number
  setTimeoutFn: (handler: () => void, timeout: number) => NodeJS.Timeout
  clearTimeoutFn: (timer: NodeJS.Timeout) => void
  /** 单次 run 最大执行时长 */
  maxRunDurationMs: number
  /** 心跳停滞判定窗口 */
  heartbeatStaleMs: number
  /** 运行时是否仍认为该会话在执行中（心跳来源） */
  isRunAlive: (sessionId: string) => boolean
  /** 超时或卡死时的回收回调；调用前 tracker 已释放槽位并清理定时器 */
  onExpired: (run: ActiveRunSnapshot, reason: ExpiredRunReason) => void
}

/**
 * 活跃 run 追踪器
 *
 * 同时承担并发槽位管理与超时/卡死回收，避免 Provider 卡住后 taskId 永久占位。
 */
export class ScheduledTaskRunTracker {
  private readonly runs = new Map<string, ActiveRun>()
  private nextToken = 1

  constructor(private readonly options: ScheduledTaskRunTrackerOptions) {}

  get size(): number {
    return this.runs.size
  }

  has(taskId: string): boolean {
    return this.runs.has(taskId)
  }

  getSessionId(taskId: string): string | undefined {
    return this.runs.get(taskId)?.sessionId
  }

  /** 去重后的活跃会话 id（多任务可能共用同一会话） */
  activeSessionIds(): string[] {
    return [...new Set([...this.runs.values()].map((run) => run.sessionId))]
  }

  snapshots(): ActiveRunSnapshot[] {
    return [...this.runs.values()].map((run) => ({
      taskId: run.taskId,
      sessionId: run.sessionId,
      triggerSource: run.triggerSource,
      startedAt: run.startedAt,
      lastHeartbeatAt: run.lastHeartbeatAt,
    }))
  }

  /**
   * 登记一次 run 并占用并发槽位
   *
   * @returns run token；结束时必须带同一 token 归还，否则视为该 run 已被回收
   */
  begin(input: { taskId: string; sessionId: string; triggerSource: 'scheduler' | 'manual'; startedAt: number }): number {
    const token = this.nextToken
    this.nextToken += 1

    const run: ActiveRun = {
      taskId: input.taskId,
      sessionId: input.sessionId,
      triggerSource: input.triggerSource,
      startedAt: input.startedAt,
      lastHeartbeatAt: input.startedAt,
      token,
      timer: null,
    }
    run.timer = this.options.setTimeoutFn(() => {
      this.expire(input.taskId, token, 'timeout')
    }, this.options.maxRunDurationMs)

    this.runs.set(input.taskId, run)
    return token
  }

  /**
   * 归还并发槽位
   *
   * @returns false 表示该 run 已被超时/看门狗回收，调用方不得再写回结果
   */
  end(taskId: string, token: number): boolean {
    const run = this.runs.get(taskId)
    if (!run || run.token !== token) return false
    this.clearTimer(run)
    this.runs.delete(taskId)
    return true
  }

  /**
   * 巡检所有活跃 run
   *
   * - 运行时仍认为会话活跃：刷新心跳
   * - 超过宽限期且心跳停滞：判定为孤儿 run（Promise 永不落地），强制回收
   *
   * @returns 心跳被刷新的 run 列表，供调用方持久化 lastHeartbeatAt
   */
  sweep(now: number): ActiveRunSnapshot[] {
    const refreshed: ActiveRunSnapshot[] = []

    for (const run of [...this.runs.values()]) {
      if (this.options.isRunAlive(run.sessionId)) {
        run.lastHeartbeatAt = now
        refreshed.push({ ...run })
        continue
      }

      const beyondGrace = now - run.startedAt > RUN_HEARTBEAT_GRACE_MS
      const heartbeatStale = now - run.lastHeartbeatAt > this.options.heartbeatStaleMs
      if (beyondGrace && heartbeatStale) {
        this.expire(run.taskId, run.token, 'stuck')
      }
    }

    return refreshed
  }

  /** 只停掉定时器，保留 run 条目让在途 executeTask 正常收尾（shutdown 使用） */
  stopTimers(): void {
    for (const run of this.runs.values()) {
      this.clearTimer(run)
    }
  }

  private clearTimer(run: ActiveRun): void {
    if (run.timer) {
      this.options.clearTimeoutFn(run.timer)
      run.timer = null
    }
  }

  private expire(taskId: string, token: number, reason: ExpiredRunReason): void {
    const run = this.runs.get(taskId)
    if (!run || run.token !== token) return
    this.clearTimer(run)
    this.runs.delete(taskId)
    this.options.onExpired({
      taskId: run.taskId,
      sessionId: run.sessionId,
      triggerSource: run.triggerSource,
      startedAt: run.startedAt,
      lastHeartbeatAt: run.lastHeartbeatAt,
    }, reason)
  }
}

// ===== 调度器健康度 =====

export interface SchedulerWatchdogInput {
  now: number
  lastScanAt?: number
  startupTimestamp: number
  scanIntervalMs: number
  heartbeatStaleMs: number
  activeRuns: ActiveRunSnapshot[]
}

export interface SchedulerWatchdogResult {
  state: 'healthy' | 'stale'
  reason: string
}

/**
 * 判定调度器健康度
 *
 * 扫描循环已改为固定周期、不受单次执行时长影响，因此：
 * - scan 停摆才是“调度器卡住”
 * - 有长任务在跑属于正常状态，只在 reason 中说明，不再误报 stale
 */
export function computeSchedulerWatchdog(input: SchedulerWatchdogInput): SchedulerWatchdogResult {
  const { now, scanIntervalMs, activeRuns } = input
  const referenceAt = input.lastScanAt ?? input.startupTimestamp
  const staleThresholdMs = scanIntervalMs * 2

  if (!referenceAt || now - referenceAt > staleThresholdMs) {
    return {
      state: 'stale',
      reason: `调度器扫描已停摆：最近一次 scan 距今超过 ${Math.round(staleThresholdMs / 1000)} 秒`,
    }
  }

  const stuckRuns = activeRuns.filter((run) => now - run.lastHeartbeatAt > input.heartbeatStaleMs)
  if (stuckRuns.length > 0) {
    return {
      state: 'stale',
      reason: `${stuckRuns.length} 个执行中的任务心跳已停止，正在回收`,
    }
  }

  if (activeRuns.length > 0) {
    const longestMinutes = Math.round(
      Math.max(...activeRuns.map((run) => now - run.startedAt)) / 60_000,
    )
    return {
      state: 'healthy',
      reason: `扫描正常；${activeRuns.length} 个任务执行中，最长已运行 ${longestMinutes} 分钟`,
    }
  }

  return { state: 'healthy', reason: '调度器 heartbeat 正常' }
}
