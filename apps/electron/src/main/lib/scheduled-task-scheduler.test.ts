/**
 * 定时任务调度器回归测试
 *
 * 覆盖并发化改造的三条核心行为：
 * - 长任务不阻塞其他到期任务的调度
 * - 超过最大时长的 run 被强制中止并释放槽位
 * - 并发上限生效，超限任务留到下一轮
 * 另外覆盖心跳看门狗与 watchdog 状态判定。
 */

import { describe, expect, test } from 'bun:test'
import type { ScheduledTask, ScheduledTaskRunRecord, SessionMeta } from '@kila/shared'
import { ScheduledTaskManager } from './scheduled-task-manager'
import { computeSchedulerWatchdog, resolveHeartbeatStaleMs } from './scheduled-task-scheduler'

class MemoryScheduledTaskStore {
  tasks: ScheduledTask[] = []
  runs: ScheduledTaskRunRecord[] = []

  loadTasks(): ScheduledTask[] { return structuredClone(this.tasks) }
  saveTasks(tasks: ScheduledTask[]): void { this.tasks = structuredClone(tasks) }
  appendRun(_taskId: string, run: ScheduledTaskRunRecord): void { this.runs.push(structuredClone(run)) }
  listRuns(taskId: string, limit = 50): ScheduledTaskRunRecord[] {
    return this.runs.filter((run) => run.taskId === taskId).slice(-limit).reverse()
  }
  deleteRuns(taskId: string): void { this.runs = this.runs.filter((run) => run.taskId !== taskId) }
}

function session(id: string): SessionMeta {
  return {
    id,
    title: id,
    project: { path: '/repo', name: 'repo', source: 'user', profileId: 'profile-test' },
    createdAt: 1,
    updatedAt: 1,
  }
}

type ManagerDeps = NonNullable<ConstructorParameters<typeof ScheduledTaskManager>[0]>

interface CapturedTimer {
  handler: () => void
  delay: number
  cleared: boolean
}

interface Harness {
  manager: ScheduledTaskManager
  store: MemoryScheduledTaskStore
  /** 已派发到 runHeadlessSession 的 sessionId 顺序 */
  dispatched: string[]
  /** 被中止的 sessionId */
  stopped: string[]
  timers: CapturedTimer[]
  nowRef: { value: number }
  /** 手动结束某个挂起的 headless run */
  settle: (sessionId: string, ok: boolean) => void
}

/**
 * 构造一个 headless run 永不自行结束的调度器
 *
 * 这样可以精确模拟“长任务在跑”而不依赖真实计时。
 */
function createHarness(overrides: Partial<ManagerDeps> = {}): Harness {
  const store = new MemoryScheduledTaskStore()
  const dispatched: string[] = []
  const stopped: string[] = []
  const timers: CapturedTimer[] = []
  const nowRef = { value: 1_000_000 }
  const pending = new Map<string, (ok: boolean) => void>()

  const manager = new ScheduledTaskManager({
    createStore: () => store,
    getSessionMeta: (id) => session(id),
    listSessions: () => [],
    getChannelExists: () => true,
    getModelEnabled: () => true,
    getFirstEnabledModelId: () => 'model-1',
    pathExists: () => true,
    runHeadlessSession: (input) => {
      dispatched.push(input.sessionId)
      return new Promise((resolvePromise) => {
        pending.set(input.sessionId, (ok) => {
          resolvePromise(ok
            ? { ok: true, session: session(input.sessionId), finalReply: '完成', newMessages: [] }
            : { ok: false, session: session(input.sessionId), error: '任务已停止', newMessages: [] })
        })
      })
    },
    isSessionActive: () => false,
    stopSession: (sessionId) => { stopped.push(sessionId) },
    createRuntimeTools: () => [],
    now: () => nowRef.value,
    setTimeoutFn: ((handler: () => void, delay: number) => {
      const timer: CapturedTimer = { handler, delay, cleared: false }
      timers.push(timer)
      return timer as unknown as NodeJS.Timeout
    }) as unknown as typeof setTimeout,
    clearTimeoutFn: ((timer: unknown) => { (timer as CapturedTimer).cleared = true }) as typeof clearTimeout,
    parseCronNextRunAt: (_expr, _tz, current) => current + 60_000,
    ...overrides,
  })

  return {
    manager,
    store,
    dispatched,
    stopped,
    timers,
    nowRef,
    settle: (sessionId, ok) => { pending.get(sessionId)?.(ok) },
  }
}

/** 创建一个已启动、且已经到期的 single_session 任务 */
async function createDueTask(harness: Harness, sessionId: string, name: string): Promise<ScheduledTask> {
  const task = await harness.manager.createTask({
    name,
    prompt: `执行 ${name}`,
    schedule: { kind: 'every', minutes: 10 },
    runMode: 'single_session',
    executionTarget: { kind: 'single_session', sessionId },
    channelId: 'channel-1',
  })
  await harness.manager.startTask(task.id)
  return task
}

/** 让所有已创建任务进入“到期”状态 */
function advancePastDue(harness: Harness): void {
  harness.nowRef.value += 11 * 60_000
}

/** 微任务排空，让同步派发的 run 推进到第一个 await */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}

describe('定时任务并发调度', () => {
  test('Given 一个长任务正在执行 When 扫描到期任务 Then 其他到期任务照常派发且扫描不被阻塞', async () => {
    const harness = createHarness({ maxConcurrentRuns: 2 })
    await createDueTask(harness, 'session-long', '长任务')
    await createDueTask(harness, 'session-fast', '短任务')
    advancePastDue(harness)

    // 长任务的 headless run 永不 resolve；scanNow 必须仍然返回。
    await harness.manager.scanNow()
    await flush()

    expect(harness.dispatched).toEqual(['session-long', 'session-fast'])
    expect(harness.manager.getRuntimeStatus().activeRunCount).toBe(2)
  })

  test('Given 长任务仍在执行 When 下一轮扫描 Then 扫描时间戳继续推进（调度器未冻结）', async () => {
    const harness = createHarness({ maxConcurrentRuns: 2 })
    await createDueTask(harness, 'session-long', '长任务')
    advancePastDue(harness)

    await harness.manager.scanNow()
    await flush()
    const firstScanAt = harness.manager.getRuntimeStatus().lastScanAt

    harness.nowRef.value += 30_000
    await harness.manager.scanNow()

    expect(harness.manager.getRuntimeStatus().lastScanAt).toBe(firstScanAt! + 30_000)
  })

  test('Given 调度器已启动 When 扫描 tick 触发 Then 下一轮定时器在本轮扫描完成前就已重排', async () => {
    const harness = createHarness()
    await harness.manager.start()

    // start() 依次创建：扫描定时器、启动补跑定时器
    const scanTimer = harness.timers[0]!
    expect(harness.timers).toHaveLength(2)

    scanTimer.handler()

    // tick 一开始就重排下一轮，不等待 scanNow 结束
    expect(harness.timers).toHaveLength(3)
    expect(harness.timers[2]!.delay).toBe(scanTimer.delay)
    harness.manager.shutdown()
  })

  test('Given 并发上限为 1 且已有 run 在跑 When 扫描到第二个到期任务 Then 不派发并保留其到期状态', async () => {
    const harness = createHarness({ maxConcurrentRuns: 1 })
    const first = await createDueTask(harness, 'session-a', '任务A')
    const second = await createDueTask(harness, 'session-b', '任务B')
    advancePastDue(harness)
    const secondNextRunAt = harness.manager.getTask(second.id)?.nextRunAt

    await harness.manager.scanNow()
    await flush()

    expect(harness.dispatched).toEqual(['session-a'])
    expect(harness.manager.getRuntimeStatus().activeRunCount).toBe(1)
    // 未派发的任务 nextRunAt 保持不变，下一轮扫描会再次命中
    expect(harness.manager.getTask(second.id)?.nextRunAt).toBe(secondNextRunAt)
    expect(harness.store.runs).toHaveLength(0)
    expect(first.id).not.toBe(second.id)
  })

  test('Given 并发槽位被释放 When 再次扫描 Then 上一轮被跳过的任务得到派发', async () => {
    const harness = createHarness({ maxConcurrentRuns: 1 })
    await createDueTask(harness, 'session-a', '任务A')
    await createDueTask(harness, 'session-b', '任务B')
    advancePastDue(harness)

    await harness.manager.scanNow()
    await flush()
    harness.settle('session-a', true)
    await flush()

    await harness.manager.scanNow()
    await flush()

    expect(harness.dispatched).toEqual(['session-a', 'session-b'])
  })
})

describe('run 超时与看门狗', () => {
  test('Given run 超过最大执行时长 When 超时定时器触发 Then 中止会话、记 error 并释放槽位', async () => {
    const harness = createHarness({ maxConcurrentRuns: 2, maxRunDurationMs: 60_000 })
    const task = await createDueTask(harness, 'session-hang', '卡住的任务')
    advancePastDue(harness)

    await harness.manager.scanNow()
    await flush()
    expect(harness.manager.getRuntimeStatus().activeRunCount).toBe(1)

    const timeoutTimer = harness.timers.find((timer) => timer.delay === 60_000)
    expect(timeoutTimer).toBeDefined()
    harness.nowRef.value += 60_000
    timeoutTimer!.handler()

    expect(harness.stopped).toEqual(['session-hang'])
    expect(harness.manager.getRuntimeStatus().activeRunCount).toBe(0)
    expect(harness.store.runs).toHaveLength(1)
    expect(harness.store.runs[0]).toMatchObject({ taskId: task.id, outcome: 'error' })
    expect(harness.store.runs[0]?.error).toContain('超过最大时长')
  })

  test('Given run 已被超时回收 When 原 Promise 迟到落地 Then 不重复写回结果', async () => {
    const harness = createHarness({ maxConcurrentRuns: 2, maxRunDurationMs: 60_000 })
    await createDueTask(harness, 'session-hang', '卡住的任务')
    advancePastDue(harness)

    await harness.manager.scanNow()
    await flush()
    harness.timers.find((timer) => timer.delay === 60_000)!.handler()
    expect(harness.store.runs).toHaveLength(1)

    // 迟到的 headless 结果不得再追加一条 run 记录
    harness.settle('session-hang', true)
    await flush()

    expect(harness.store.runs).toHaveLength(1)
    expect(harness.manager.getRuntimeStatus().activeRunCount).toBe(0)
  })

  test('Given 运行时已不认该会话且心跳长期停滞 When 扫描巡检 Then 判定卡死并回收槽位', async () => {
    const harness = createHarness({ maxConcurrentRuns: 2, scanIntervalMs: 30_000 })
    await createDueTask(harness, 'session-orphan', '孤儿任务')
    advancePastDue(harness)

    await harness.manager.scanNow()
    await flush()
    expect(harness.manager.getRuntimeStatus().activeRunCount).toBe(1)

    // 越过宽限期 + 心跳停滞窗口后再扫描
    harness.nowRef.value += resolveHeartbeatStaleMs(30_000) + 60_000 + 1
    await harness.manager.scanNow()
    await flush()

    expect(harness.manager.getRuntimeStatus().activeRunCount).toBe(0)
    expect(harness.store.runs.at(-1)).toMatchObject({ outcome: 'error' })
    expect(harness.store.runs.at(-1)?.error).toContain('心跳已停止')
  })
})

describe('调度器健康度判定', () => {
  const base = {
    startupTimestamp: 0,
    scanIntervalMs: 30_000,
    heartbeatStaleMs: 300_000,
  }

  test('Given 扫描正常且没有任务在跑 When 判定健康度 Then 返回 healthy', () => {
    expect(computeSchedulerWatchdog({
      ...base,
      now: 100_000,
      lastScanAt: 90_000,
      activeRuns: [],
    })).toEqual({ state: 'healthy', reason: '调度器 heartbeat 正常' })
  })

  test('Given 扫描正常但有长任务在跑 When 判定健康度 Then 仍是 healthy 并说明任务在执行', () => {
    const result = computeSchedulerWatchdog({
      ...base,
      now: 3_700_000,
      lastScanAt: 3_690_000,
      activeRuns: [{
        taskId: 't1',
        sessionId: 's1',
        triggerSource: 'scheduler',
        startedAt: 100_000,
        lastHeartbeatAt: 3_690_000,
      }],
    })

    expect(result.state).toBe('healthy')
    expect(result.reason).toContain('1 个任务执行中')
    expect(result.reason).toContain('60 分钟')
  })

  test('Given 扫描循环停摆 When 判定健康度 Then 返回 stale 并指向调度器本身', () => {
    const result = computeSchedulerWatchdog({
      ...base,
      now: 400_000,
      lastScanAt: 100_000,
      activeRuns: [],
    })

    expect(result.state).toBe('stale')
    expect(result.reason).toContain('调度器扫描已停摆')
  })

  test('Given 扫描正常但 run 心跳停滞 When 判定健康度 Then 返回 stale 并指向任务心跳', () => {
    const result = computeSchedulerWatchdog({
      ...base,
      now: 1_000_000,
      lastScanAt: 990_000,
      activeRuns: [{
        taskId: 't1',
        sessionId: 's1',
        triggerSource: 'scheduler',
        startedAt: 100_000,
        lastHeartbeatAt: 200_000,
      }],
    })

    expect(result.state).toBe('stale')
    expect(result.reason).toContain('心跳已停止')
  })
})
