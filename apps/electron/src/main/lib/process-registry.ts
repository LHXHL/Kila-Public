import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolveShell } from './shell-resolver'

type ProcessStatus = 'running' | 'completed' | 'failed' | 'stopped'

interface ProcessRecord {
  processId: string
  taskId: string
  sessionId: string
  toolCallId: string
  pid?: number
  command: string
  cwd: string
  startedAt: number
  endedAt?: number
  status: ProcessStatus
  output: string
  child?: ChildProcess
  exitCode?: number | null
  error?: string
  completion: Promise<void>
  resolveCompletion: () => void
}

export interface TaskOutputSnapshot {
  output: string
  isComplete: boolean
  processId?: string
  pid?: number
  status?: ProcessStatus
  exitCode?: number | null
  startedAt?: number
  endedAt?: number
}

interface TrackedBashOptions {
  sessionId: string
  toolCallId: string
}

interface BashExecOptions {
  onData: (data: Buffer) => void
  signal?: AbortSignal
  timeout?: number
  env?: NodeJS.ProcessEnv
}

const MAX_OUTPUT_CHARS = 256 * 1024
const COMPLETED_RECORD_TTL_MS = 15 * 60 * 1000
const MAX_COMPLETED_RECORDS = 100

function createCompletion(): { completion: Promise<void>; resolveCompletion: () => void } {
  let resolveCompletion!: () => void
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve
  })
  return { completion, resolveCompletion }
}

function appendOutput(record: ProcessRecord, data: Buffer | string): void {
  record.output += Buffer.isBuffer(data) ? data.toString('utf-8') : data
  if (record.output.length > MAX_OUTPUT_CHARS) {
    record.output = record.output.slice(record.output.length - MAX_OUTPUT_CHARS)
  }
}

function killProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true }).unref()
    return
  }

  try {
    process.kill(-pid, 'SIGTERM')
    setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        // already exited
      }
    }, 2000).unref()
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // already exited
    }
  }
}

class ProcessRegistry {
  private records = new Map<string, ProcessRecord>()

  private pruneCompleted(now = Date.now()): void {
    const completed = [...this.records.values()]
      .filter((record) => record.status !== 'running')
      .sort((a, b) => (a.endedAt ?? a.startedAt) - (b.endedAt ?? b.startedAt))

    for (const record of completed) {
      const endedAt = record.endedAt ?? record.startedAt
      if (now - endedAt > COMPLETED_RECORD_TTL_MS) {
        this.records.delete(record.taskId)
      }
    }

    const retainedCompleted = [...this.records.values()]
      .filter((record) => record.status !== 'running')
      .sort((a, b) => (a.endedAt ?? a.startedAt) - (b.endedAt ?? b.startedAt))
    for (const record of retainedCompleted.slice(0, Math.max(0, retainedCompleted.length - MAX_COMPLETED_RECORDS))) {
      this.records.delete(record.taskId)
    }
  }

  start(input: {
    sessionId: string
    toolCallId: string
    command: string
    cwd: string
    child: ChildProcess
  }): ProcessRecord {
    const { completion, resolveCompletion } = createCompletion()
    const record: ProcessRecord = {
      processId: input.toolCallId,
      taskId: input.toolCallId,
      sessionId: input.sessionId,
      toolCallId: input.toolCallId,
      pid: input.child.pid,
      command: input.command,
      cwd: input.cwd,
      startedAt: Date.now(),
      status: 'running',
      output: '',
      child: input.child,
      completion,
      resolveCompletion,
    }
    this.pruneCompleted()
    this.records.set(input.toolCallId, record)
    return record
  }

  append(taskId: string, data: Buffer | string): void {
    const record = this.records.get(taskId)
    if (!record) return
    appendOutput(record, data)
  }

  finish(taskId: string, status: Exclude<ProcessStatus, 'running'>, options: { exitCode?: number | null; error?: string } = {}): void {
    const record = this.records.get(taskId)
    if (!record || record.status !== 'running') return
    record.status = status
    record.exitCode = options.exitCode
    record.error = options.error
    record.endedAt = Date.now()
    record.child = undefined
    record.resolveCompletion()
    this.pruneCompleted(record.endedAt)
  }

  async getOutput(taskId: string, options: { block?: boolean } = {}): Promise<TaskOutputSnapshot> {
    this.pruneCompleted()
    const record = this.records.get(taskId)
    if (!record) {
      return { output: '', isComplete: true, status: 'completed' }
    }
    if (options.block && record.status === 'running') {
      await record.completion
    }
    return {
      output: record.output,
      isComplete: record.status !== 'running',
      processId: record.processId,
      pid: record.pid,
      status: record.status,
      exitCode: record.exitCode,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
    }
  }

  stop(taskId: string): boolean {
    const record = this.records.get(taskId)
    if (!record || record.status !== 'running') return false
    if (record.pid) {
      killProcessTree(record.pid)
    } else {
      record.child?.kill('SIGTERM')
    }
    this.finish(taskId, 'stopped', { exitCode: null, error: 'stopped' })
    return true
  }


  listBySession(sessionId: string): TaskOutputSnapshot[] {
    this.pruneCompleted()
    return [...this.records.values()]
      .filter((record) => record.sessionId === sessionId)
      .map((record) => ({
        output: record.output,
        isComplete: record.status !== 'running',
        processId: record.processId,
        pid: record.pid,
        status: record.status,
        exitCode: record.exitCode,
        startedAt: record.startedAt,
        endedAt: record.endedAt,
      }))
  }

  stopBySession(sessionId: string): number {
    const runningIds = [...this.records.values()]
      .filter((record) => record.sessionId === sessionId && record.status === 'running')
      .map((record) => record.taskId)
    for (const taskId of runningIds) this.stop(taskId)
    return runningIds.length
  }

  clearBySession(sessionId: string): void {
    this.stopBySession(sessionId)
    for (const [taskId, record] of this.records) {
      if (record.sessionId === sessionId) this.records.delete(taskId)
    }
  }
}

export const processRegistry = new ProcessRegistry()

export function createTrackedBashOperations(options: TrackedBashOptions): {
  exec: (command: string, cwd: string, execOptions: BashExecOptions) => Promise<{ exitCode: number | null }>
} {
  return {
    exec: (command, cwd, { onData, signal, timeout, env }) => new Promise((resolve, reject) => {
      // 统一 shell 解析：无可用 shell 时显式失败，不再静默降级到 cmd/PowerShell
      // （降级解释器对模型生成的 POSIX 命令无效，只会让 Agent 反复重试）
      const shellResolution = resolveShell()
      if (shellResolution.kind === 'none' || !shellResolution.path) {
        reject(new Error(
          `Shell 环境不可用：${shellResolution.error ?? '未知原因'}\n`
          + '无法执行命令。请把上述修复方式转告用户，等待修复后重试，不要重复调用 bash 工具。',
        ))
        return
      }

      if (!existsSync(cwd)) {
        reject(new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`))
        return
      }

      const child = spawn(shellResolution.path, [...shellResolution.args, command], {
        cwd,
        // Windows: detached 会设置 DETACHED_PROCESS 标志，导致 CREATE_NO_WINDOW（windowsHide）被忽略，
        // 从而弹出黑色控制台窗口。Kila 通过 processRegistry + killProcessTree 管理进程生命周期，
        // 不需要 detached 的"子进程独立存活"语义，因此仅在 Unix 上启用。
        detached: process.platform !== 'win32',
        env: env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      const record = processRegistry.start({
        sessionId: options.sessionId,
        toolCallId: options.toolCallId,
        command,
        cwd,
        child,
      })

      let timedOut = false
      let timeoutHandle: NodeJS.Timeout | undefined
      if (timeout !== undefined && timeout > 0) {
        timeoutHandle = setTimeout(() => {
          timedOut = true
          if (child.pid) killProcessTree(child.pid)
        }, timeout * 1000)
      }

      const handleData = (data: Buffer): void => {
        processRegistry.append(record.taskId, data)
        onData(data)
      }
      child.stdout?.on('data', handleData)
      child.stderr?.on('data', handleData)

      const onAbort = (): void => {
        if (child.pid) killProcessTree(child.pid)
      }
      if (signal) {
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      }

      const cleanup = (): void => {
        if (timeoutHandle) clearTimeout(timeoutHandle)
        if (signal) signal.removeEventListener('abort', onAbort)
      }

      child.once('error', (error) => {
        cleanup()
        processRegistry.finish(record.taskId, 'failed', { exitCode: null, error: error.message })
        reject(error)
      })

      child.once('close', (code) => {
        cleanup()
        if (record.status === 'stopped') {
          reject(new Error('aborted'))
          return
        }
        if (signal?.aborted) {
          processRegistry.finish(record.taskId, 'stopped', { exitCode: null, error: 'aborted' })
          reject(new Error('aborted'))
          return
        }
        if (timedOut) {
          processRegistry.finish(record.taskId, 'stopped', { exitCode: null, error: `timeout:${timeout}` })
          reject(new Error(`timeout:${timeout}`))
          return
        }
        processRegistry.finish(record.taskId, code === 0 ? 'completed' : 'failed', { exitCode: code })
        resolve({ exitCode: code })
      })
    }),
  }
}
