import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { KilaPermissionMode, ScheduledTask, ScheduledTaskResultVerifier, ScheduledTaskRunRecord } from '@kila/shared'
import { getScheduledTaskRunPath, getScheduledTaskRunsDir, getScheduledTasksIndexPath } from './config-paths'
import { buildDelivery } from './scheduled-task-helpers'


import { createLogger } from './logger'
const log = createLogger('ScheduledTaskStore')

const INDEX_VERSION = 1
const MAX_RUN_RECORDS = 500
const MAX_PREVIEW_CHARS = 2000
const VALID_PERMISSION_MODES = new Set<KilaPermissionMode>(['auto', 'smart'])

interface ScheduledTaskStoreDeps {
  getIndexPath?: () => string
  getRunsDir?: () => string
  readFile?: (filePath: string) => string
  writeFile?: (filePath: string, content: string) => void
  renameFile?: (fromPath: string, toPath: string) => void
  unlinkFile?: (filePath: string) => void
  exists?: (filePath: string) => boolean
  mkdir?: (dirPath: string) => void
}

interface ScheduledTaskIndexFile {
  version: number
  tasks: ScheduledTask[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function trimPreview(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  if (value.length <= MAX_PREVIEW_CHARS) return value
  return value.slice(0, MAX_PREVIEW_CHARS)
}

function normalizeRunRecord(record: ScheduledTaskRunRecord): ScheduledTaskRunRecord {
  return {
    ...record,
    finalReplyPreview: trimPreview(record.finalReplyPreview),
    verificationSummary: trimPreview(record.verificationSummary),
  }
}

function normalizeResultVerifiers(verifiers: ScheduledTask['resultVerifiers']): ScheduledTaskResultVerifier[] {
  if (!Array.isArray(verifiers)) return []

  return verifiers.reduce<ScheduledTaskResultVerifier[]>((acc, verifier) => {
    if (!verifier || typeof verifier !== 'object' || typeof verifier.kind !== 'string') {
      return acc
    }

    if (verifier.kind === 'reply_non_empty' || verifier.kind === 'bridge_delivery_success') {
      acc.push(verifier)
      return acc
    }

    if (verifier.kind === 'file_exists' && typeof verifier.path === 'string' && verifier.path.trim()) {
      acc.push({ kind: 'file_exists', path: verifier.path.trim() })
    }

    return acc
  }, [])
}

export function normalizeScheduledTask(raw: ScheduledTask): ScheduledTask {
  const { health: _health, ...task } = raw
  const inferredLastSuccessfulAt = typeof task.lastSuccessfulAt === 'number'
    ? task.lastSuccessfulAt
    : (!task.lastError && typeof task.lastCompletedAt === 'number' ? task.lastCompletedAt : undefined)
  const rawPermissionMode = task.permissionModeOverride as KilaPermissionMode | 'supervised' | undefined
  const normalizedPermissionMode = rawPermissionMode === 'supervised'
    ? 'smart'
    : (rawPermissionMode && VALID_PERMISSION_MODES.has(rawPermissionMode) ? rawPermissionMode : 'auto')

  return {
    ...task,
    delivery: buildDelivery(task.delivery),
    permissionModeOverride: normalizedPermissionMode,
    aiCanExit: Boolean(task.aiCanExit),
    notifyOnMissedRun: Boolean(task.notifyOnMissedRun),
    executionCount: Number.isFinite(task.executionCount) ? task.executionCount : 0,
    resultVerifiers: normalizeResultVerifiers(task.resultVerifiers),
    lastSuccessfulAt: inferredLastSuccessfulAt,
    lastFinalReplyPreview: trimPreview(task.lastFinalReplyPreview),
  }
}

function isScheduledTask(value: unknown): value is ScheduledTask {
  if (!isObject(value)) return false
  if (typeof value.id !== 'string' || !value.id.trim()) return false
  if (typeof value.name !== 'string') return false
  if (typeof value.prompt !== 'string') return false
  if (!isObject(value.schedule) || typeof value.schedule.kind !== 'string') return false
  if (!isObject(value.executionTarget) || typeof value.executionTarget.kind !== 'string') return false
  if (value.runMode !== 'new_session' && value.runMode !== 'single_session') return false
  if (value.status !== 'running' && value.status !== 'stopped') return false
  if (typeof value.channelId !== 'string' || !value.channelId.trim()) return false
  if (typeof value.createdAt !== 'number' || typeof value.updatedAt !== 'number') return false
  if (typeof value.executionCount !== 'number') return false
  return true
}

function extractParseableTasks(raw: string): ScheduledTask[] {
  const tasks: ScheduledTask[] = []
  const seen = new Set<string>()

  for (let start = 0; start < raw.length; start += 1) {
    if (raw[start] !== '{') continue

    let depth = 0
    for (let end = start; end < raw.length; end += 1) {
      const char = raw[end]
      if (char === '{') depth += 1
      if (char === '}') {
        depth -= 1
        if (depth !== 0) continue

        const candidate = raw.slice(start, end + 1)
        try {
          const parsed = JSON.parse(candidate) as unknown
          if (!isScheduledTask(parsed)) break
          if (seen.has(parsed.id)) break
          seen.add(parsed.id)
          tasks.push(normalizeScheduledTask(parsed))
          break
        } catch {
          break
        }
      }
    }
  }

  return tasks
}

function ensureParentDir(filePath: string, mkdir: (dirPath: string) => void): void {
  mkdir(dirname(filePath))
}

function defaultReadFile(filePath: string): string {
  return readFileSync(filePath, 'utf-8')
}

function defaultWriteFile(filePath: string, content: string): void {
  writeFileSync(filePath, content, 'utf-8')
}

function defaultRenameFile(fromPath: string, toPath: string): void {
  renameSync(fromPath, toPath)
}

function defaultUnlinkFile(filePath: string): void {
  unlinkSync(filePath)
}

function defaultExists(filePath: string): boolean {
  return existsSync(filePath)
}

function defaultMkdir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

export function sanitizeScheduledTaskId(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9_-]/g, '_')
}

export class ScheduledTaskStore {
  private readonly getIndexPath: () => string
  private readonly getRunsDir: () => string
  private readonly readFile: (filePath: string) => string
  private readonly writeFile: (filePath: string, content: string) => void
  private readonly renameFile: (fromPath: string, toPath: string) => void
  private readonly unlinkFile: (filePath: string) => void
  private readonly exists: (filePath: string) => boolean
  private readonly mkdir: (dirPath: string) => void

  constructor(deps?: ScheduledTaskStoreDeps) {
    this.getIndexPath = deps?.getIndexPath ?? getScheduledTasksIndexPath
    this.getRunsDir = deps?.getRunsDir ?? getScheduledTaskRunsDir
    this.readFile = deps?.readFile ?? defaultReadFile
    this.writeFile = deps?.writeFile ?? defaultWriteFile
    this.renameFile = deps?.renameFile ?? defaultRenameFile
    this.unlinkFile = deps?.unlinkFile ?? defaultUnlinkFile
    this.exists = deps?.exists ?? defaultExists
    this.mkdir = deps?.mkdir ?? defaultMkdir
  }

  private getRunPath(taskId: string): string {
    return join(this.getRunsDir(), `${sanitizeScheduledTaskId(taskId)}.jsonl`)
  }

  loadTasks(): ScheduledTask[] {
    const indexPath = this.getIndexPath()
    if (!this.exists(indexPath)) {
      return []
    }

    try {
      const parsed = JSON.parse(this.readFile(indexPath)) as ScheduledTaskIndexFile
      if (!Array.isArray(parsed.tasks)) {
        return []
      }
      return parsed.tasks
        .filter(isScheduledTask)
        .map((task) => normalizeScheduledTask(task))
    } catch (error) {
      log.warn('[ScheduledTaskStore] 读取索引失败，尝试逐条恢复:', error)
      return extractParseableTasks(this.readFile(indexPath))
    }
  }

  saveTasks(tasks: ScheduledTask[]): void {
    const indexPath = this.getIndexPath()
    ensureParentDir(indexPath, this.mkdir)
    const normalized = tasks.map((task) => normalizeScheduledTask(task))
    const tempPath = `${indexPath}.tmp`
    const content = JSON.stringify({
      version: INDEX_VERSION,
      tasks: normalized,
    }, null, 2)

    this.writeFile(tempPath, content)
    this.renameFile(tempPath, indexPath)
  }

  listRuns(taskId: string, limit = 50): ScheduledTaskRunRecord[] {
    const runPath = this.getRunPath(taskId)
    if (!this.exists(runPath)) {
      return []
    }

    const lines = this.readFile(runPath)
      .split('\n')
      .filter((line) => line.trim())

    const runs = lines
      .map((line) => {
        try {
          return normalizeRunRecord(JSON.parse(line) as ScheduledTaskRunRecord)
        } catch {
          return null
        }
      })
      .filter((item): item is ScheduledTaskRunRecord => item !== null)

    if (limit <= 0) return []
    return runs.slice(-limit)
  }

  appendRun(taskId: string, record: ScheduledTaskRunRecord): void {
    const runPath = this.getRunPath(taskId)
    ensureParentDir(runPath, this.mkdir)

    const existing = this.listRuns(taskId, MAX_RUN_RECORDS)
    const nextRuns = [...existing, normalizeRunRecord(record)].slice(-MAX_RUN_RECORDS)
    const content = nextRuns.map((item) => JSON.stringify(item)).join('\n')
    this.writeFile(runPath, content ? `${content}\n` : '')
  }

  deleteRuns(taskId: string): void {
    const runPath = this.getRunPath(taskId)
    if (!this.exists(runPath)) {
      return
    }
    this.unlinkFile(runPath)
  }

  deleteAll(): void {
    const indexPath = this.getIndexPath()
    if (this.exists(indexPath)) {
      this.unlinkFile(indexPath)
    }
    if (this.exists(this.getRunsDir())) {
      rmSync(this.getRunsDir(), { recursive: true, force: true })
    }
  }
}

export {
  MAX_PREVIEW_CHARS as SCHEDULED_TASK_MAX_PREVIEW_CHARS,
  MAX_RUN_RECORDS as SCHEDULED_TASK_MAX_RUN_RECORDS,
}
