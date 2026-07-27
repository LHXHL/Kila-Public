import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ScheduledTask, ScheduledTaskRunRecord } from '@kila/shared'
import { ScheduledTaskStore, SCHEDULED_TASK_MAX_RUN_RECORDS } from './scheduled-task-store'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

interface StoreContext {
  rootDir: string
  runsDir: string
  indexPath: string
  runPath: string
  store: ScheduledTaskStore
}

function createStore(taskId = 'task-1'): StoreContext {
  const rootDir = mkdtempSync(join(tmpdir(), 'kila-scheduled-store-test-'))
  tempDirs.push(rootDir)
  const runsDir = join(rootDir, 'runs')
  const indexPath = join(rootDir, 'tasks.json')

  return {
    rootDir,
    runsDir,
    indexPath,
    runPath: join(runsDir, `${taskId}.jsonl`),
    store: new ScheduledTaskStore({
      getIndexPath: () => indexPath,
      getRunsDir: () => runsDir,
    }),
  }
}

function runRecord(index: number): ScheduledTaskRunRecord {
  return {
    id: `run-${index}`,
    taskId: 'task-1',
    triggerSource: 'scheduler',
    outcome: 'success',
    startedAt: 1_700_000_000_000 + index,
    finishedAt: 1_700_000_000_001 + index,
    durationMs: 1,
  }
}

function task(id: string): ScheduledTask {
  return {
    id,
    name: '巡检',
    prompt: '检查项目',
    schedule: { kind: 'every', minutes: 10 },
    runMode: 'single_session',
    executionTarget: { kind: 'single_session', sessionId: 'session-1' },
    status: 'stopped',
    channelId: 'channel-1',
    createdAt: 1,
    updatedAt: 1,
    executionCount: 0,
  } as ScheduledTask
}

describe('定时任务执行记录持久化', () => {
  test('Given 已有历史记录，When 追加新记录，Then 只在文件尾部追加而不重写整个文件', () => {
    const context = createStore()
    context.store.appendRun('task-1', runRecord(1))
    const afterFirst = readFileSync(context.runPath, 'utf-8')

    context.store.appendRun('task-1', runRecord(2))

    const afterSecond = readFileSync(context.runPath, 'utf-8')
    // 追加语义：旧内容必须逐字节保持在文件开头，任何"读全量再覆盖"都会破坏这个前缀关系
    expect(afterSecond.startsWith(afterFirst)).toBe(true)
    expect(afterSecond.trim().split('\n')).toHaveLength(2)
    expect(context.store.listRuns('task-1').map((item) => item.id)).toEqual(['run-1', 'run-2'])
  })

  test('Given 记录数超过上限，When 继续追加，Then 裁剪为最近 N 条且文件仍然可解析', () => {
    const context = createStore()
    const total = SCHEDULED_TASK_MAX_RUN_RECORDS + 3

    for (let index = 1; index <= total; index += 1) {
      context.store.appendRun('task-1', runRecord(index))
    }

    const runs = context.store.listRuns('task-1', SCHEDULED_TASK_MAX_RUN_RECORDS)
    expect(runs).toHaveLength(SCHEDULED_TASK_MAX_RUN_RECORDS)
    expect(runs.at(-1)!.id).toBe(`run-${total}`)
    expect(runs[0]!.id).toBe(`run-${total - SCHEDULED_TASK_MAX_RUN_RECORDS + 1}`)
    expect(readdirSync(context.runsDir).filter((name) => name.includes('.tmp'))).toHaveLength(0)
  })

  test('Given 文件里混有损坏行，When 追加并读取，Then 跳过坏行且不丢新记录', () => {
    const context = createStore()
    context.store.appendRun('task-1', runRecord(1))
    writeFileSync(context.runPath, `${readFileSync(context.runPath, 'utf-8')}{ 半截行\n`, 'utf-8')

    context.store.appendRun('task-1', runRecord(2))

    expect(context.store.listRuns('task-1').map((item) => item.id)).toEqual(['run-1', 'run-2'])
  })

  test('Given 保存任务索引，When 写入完成，Then 不残留临时文件且内容完整可解析', () => {
    const context = createStore()

    context.store.saveTasks([task('task-1'), task('task-2')])

    expect(existsSync(context.indexPath)).toBe(true)
    expect(readdirSync(context.rootDir).filter((name) => name.includes('.tmp'))).toHaveLength(0)
    expect(JSON.parse(readFileSync(context.indexPath, 'utf-8')).tasks).toHaveLength(2)
    expect(context.store.loadTasks().map((item) => item.id)).toEqual(['task-1', 'task-2'])
  })
})
