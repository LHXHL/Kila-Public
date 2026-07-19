import { describe, expect, test } from 'bun:test'
import type { ScheduledTask, ScheduledTaskRunRecord, SessionMeta } from '@kila/shared'
import { ScheduledTaskManager } from './scheduled-task-manager'

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

function createManager(nowRef = { value: 10_000 }, overrides: Partial<ManagerDeps> = {}) {
  const store = new MemoryScheduledTaskStore()
  const runInputs: Array<{ sessionId: string; prompt: string }> = []
  const manager = new ScheduledTaskManager({
    createStore: () => store,
    getSessionMeta: (id) => session(id),
    listSessions: () => [],
    getChannelExists: () => true,
    getModelEnabled: () => true,
    getFirstEnabledModelId: () => 'model-1',
    pathExists: () => true,
    runHeadlessSession: async (input) => {
      runInputs.push({ sessionId: input.sessionId, prompt: input.sendInput.userMessage })
      return { ok: true, session: session(input.sessionId), finalReply: '任务完成', newMessages: [] }
    },
    isSessionActive: () => false,
      createRuntimeTools: () => [],
    now: () => nowRef.value,
    setTimeoutFn: ((() => ({}) as NodeJS.Timeout) as unknown) as typeof setTimeout,
    clearTimeoutFn: (() => {}) as typeof clearTimeout,
    parseCronNextRunAt: (_expr, _tz, current) => current + 60_000,
    ...overrides,
  })
  return { manager, store, runInputs }
}

async function addSingleSessionTask(manager: ScheduledTaskManager, schedule: ScheduledTask['schedule']) {
  return manager.createTask({
    name: '巡检',
    prompt: '检查项目',
    schedule,
    runMode: 'single_session',
    executionTarget: { kind: 'single_session', sessionId: 'session-1' },
    channelId: 'channel-1',
  })
}

describe('ScheduledTaskManager 核心执行路径', () => {
  test('Run now 即使任务处于 stopped 也执行一次并保留状态', async () => {
    const { manager, store, runInputs } = createManager()
    const task = await addSingleSessionTask(manager, { kind: 'every', minutes: 10 })
    expect(manager.getTask(task.id)?.status).toBe('stopped')

    await manager.runTaskNow(task.id)

    expect(runInputs).toEqual([{ sessionId: 'session-1', prompt: '检查项目' }])
    expect(store.runs).toHaveLength(1)
    expect(store.runs[0]).toMatchObject({ triggerSource: 'manual', outcome: 'success' })
    expect(manager.getTask(task.id)).toMatchObject({ status: 'stopped', executionCount: 1, lastFinalReplyPreview: '任务完成' })
  })

  test('启动恢复只补跑一次逾期任务', async () => {
    const nowRef = { value: 10_000 }
    const { manager, store, runInputs } = createManager(nowRef)
    const task = await addSingleSessionTask(manager, { kind: 'every', minutes: 5 })
    await manager.startTask(task.id)
    const persisted = store.tasks.find((item) => item.id === task.id)!
    persisted.nextRunAt = 9_000
    store.tasks = [persisted]

    // 重新启动一个 manager，模拟应用重启后从磁盘加载逾期任务。
    const second = new ScheduledTaskManager({
      createStore: () => store,
      getSessionMeta: (id) => session(id),
      listSessions: () => [],
      getChannelExists: () => true,
      getModelEnabled: () => true,
      getFirstEnabledModelId: () => 'model-1',
      runHeadlessSession: async (input) => {
        runInputs.push({ sessionId: input.sessionId, prompt: input.sendInput.userMessage })
        return { ok: true, session: session(input.sessionId), finalReply: '恢复完成', newMessages: [] }
      },
      isSessionActive: () => false,
    createRuntimeTools: () => [],
      now: () => nowRef.value,
      setTimeoutFn: ((() => ({}) as NodeJS.Timeout) as unknown) as typeof setTimeout,
      clearTimeoutFn: (() => {}) as typeof clearTimeout,
    })
    await second.start()
    await second.recoverOverdueTasksNow()
    await second.recoverOverdueTasksNow()

    expect(runInputs).toHaveLength(1)
    expect(store.runs).toHaveLength(1)
    expect(store.runs[0]).toMatchObject({ triggerSource: 'scheduler', outcome: 'success' })
    expect(second.getRuntimeStatus().lastRecoveryAt).toBe(10_000)
    second.shutdown()
  })

  test('start 重复调用只创建一组扫描与恢复定时器，shutdown 会清理两者', async () => {
    const timers: NodeJS.Timeout[] = []
    const cleared: NodeJS.Timeout[] = []
    const { manager } = createManager({ value: 10_000 }, {
      setTimeoutFn: ((_handler: () => void) => {
        const timer = { index: timers.length } as unknown as NodeJS.Timeout
        timers.push(timer)
        return timer
      }) as typeof setTimeout,
      clearTimeoutFn: ((timer: NodeJS.Timeout) => { cleared.push(timer) }) as typeof clearTimeout,
    })

    await manager.start()
    await manager.start()

    expect(timers).toHaveLength(2)
    manager.shutdown()
    expect(cleared).toEqual(timers)
  })

  test('shutdown 会停止活跃 Session，stopped Headless 结果不会记录为 success', async () => {
    let resolveRun: ((result: Awaited<ReturnType<NonNullable<ManagerDeps['runHeadlessSession']>>>) => void) | undefined
    const stoppedSessions: string[] = []
    const { manager, store } = createManager({ value: 10_000 }, {
      runHeadlessSession: () => new Promise((resolve) => { resolveRun = resolve }),
      stopSession: (sessionId) => { stoppedSessions.push(sessionId) },
    })
    const task = await addSingleSessionTask(manager, { kind: 'every', minutes: 10 })

    const running = manager.runTaskNow(task.id)
    for (let attempt = 0; attempt < 5 && !resolveRun; attempt += 1) await Promise.resolve()
    expect(manager.getRuntimeStatus().activeRunCount).toBe(1)

    manager.shutdown()
    expect(stoppedSessions).toEqual(['session-1'])

    resolveRun?.({
      ok: false,
      session: session('session-1'),
      error: '任务已停止',
      newMessages: [],
    })
    await running

    expect(store.runs.at(-1)).toMatchObject({ outcome: 'error', error: '任务已停止' })
    expect(manager.getRuntimeStatus().activeRunCount).toBe(0)
  })
})
