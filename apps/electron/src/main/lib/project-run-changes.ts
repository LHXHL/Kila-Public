import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { AGENT_IPC_CHANNELS } from '@kila/shared'
import type { ProjectRunChanges, SessionMeta, SessionSendInput } from '@kila/shared'
import { registerSessionRuntimeObserver } from './session-runtime-observers'

const MAX_FILES = 20_000
const MAX_HASH_BYTES = 4 * 1024 * 1024
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.cache'])

export interface ProjectSnapshot {
  mode: 'git' | 'filesystem'
  projectPath: string
  files: Map<string, string>
}

interface ActiveRun {
  sessionId: string
  startedAt: number
  snapshot: ProjectSnapshot
}

const activeRuns = new Map<string, ActiveRun>()
const finishingRuns = new Map<string, Promise<void>>()
const completedRuns = new Map<string, ProjectRunChanges>()
const MAX_COMPLETED_RUNS = 100
let trackingInitialized = false

function retainRecentCompletedRuns(): void {
  if (completedRuns.size <= MAX_COMPLETED_RUNS) return
  const oldest = [...completedRuns.values()]
    .sort((a, b) => a.completedAt - b.completedAt)
    .slice(0, completedRuns.size - MAX_COMPLETED_RUNS)
  for (const run of oldest) completedRuns.delete(run.sessionId)
}

async function fileFingerprint(path: string): Promise<string> {
  const stat = await lstat(path)
  if (!stat.isFile()) return `kind:${stat.mode}`
  const hash = createHash('sha256')
  hash.update(`${stat.size}:${stat.mode}:`)
  if (stat.size <= MAX_HASH_BYTES) hash.update(await readFile(path))
  else hash.update(`${stat.mtimeMs}`)
  return hash.digest('hex')
}

/**
 * 异步扫描项目文件，避免大型项目在 Electron 主进程中触发同步 I/O 卡顿。
 * onRunStart 会 await 该快照，因此不会晚于 Agent 的首个工具调用。
 */
export async function listProjectFilesystem(projectPath: string): Promise<Map<string, string>> {
  const root = resolve(projectPath)
  const files = new Map<string, string>()
  const queue = [root]

  while (queue.length && files.size < MAX_FILES) {
    const current = queue.pop()!
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue
      const fullPath = resolve(current, entry.name)
      const rel = relative(root, fullPath).split(sep).join('/')
      if (!rel || rel.startsWith('../')) continue

      if (entry.isDirectory()) {
        queue.push(fullPath)
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        try {
          files.set(rel, await fileFingerprint(fullPath))
        } catch {
          // 文件可能在扫描期间被工具删除或替换。
        }
      }
      if (files.size >= MAX_FILES) break
    }
  }

  return files
}

function gitRoot(projectPath: string): Promise<string | null> {
  return new Promise((resolveResult) => {
    execFile(
      'git',
      ['rev-parse', '--show-toplevel'],
      { cwd: projectPath, encoding: 'utf8', timeout: 5_000 },
      (error, stdout) => resolveResult(error ? null : stdout.trim() || null),
    )
  })
}

export async function captureProjectSnapshot(projectPath: string): Promise<ProjectSnapshot> {
  const root = await gitRoot(projectPath)
  return {
    mode: root ? 'git' : 'filesystem',
    projectPath: root || resolve(projectPath),
    // 对 Git 仓库同样扫描工作树，才能识别运行前已经 dirty、运行中继续变化的文件。
    files: await listProjectFilesystem(root || projectPath),
  }
}

export function diffProjectSnapshots(before: ProjectSnapshot, after: ProjectSnapshot): string[] {
  const paths = new Set([...before.files.keys(), ...after.files.keys()])
  return [...paths].filter((path) => before.files.get(path) !== after.files.get(path)).sort()
}

async function finishRun(sessionId: string): Promise<void> {
  const active = activeRuns.get(sessionId)
  if (!active) return

  try {
    const after = await captureProjectSnapshot(active.snapshot.projectPath)
    completedRuns.set(sessionId, {
      sessionId,
      projectPath: active.snapshot.projectPath,
      mode: active.snapshot.mode,
      startedAt: active.startedAt,
      completedAt: Date.now(),
      changedPaths: diffProjectSnapshots(active.snapshot, after),
    })
  } catch {
    completedRuns.set(sessionId, {
      sessionId,
      projectPath: active.snapshot.projectPath,
      mode: active.snapshot.mode,
      startedAt: active.startedAt,
      completedAt: Date.now(),
      changedPaths: [],
    })
  } finally {
    if (activeRuns.get(sessionId) === active) activeRuns.delete(sessionId)
  }
  retainRecentCompletedRuns()
}

export function initializeProjectRunChangesTracking(): () => void {
  if (trackingInitialized) return () => {}
  trackingInitialized = true

  const unregister = registerSessionRuntimeObserver({
    async onRunStart(session: SessionMeta, _input: SessionSendInput) {
      if (!existsSync(session.project.path)) return
      // 上一轮的 after snapshot 尚未结束时先等待，避免相邻运行的快照交叉。
      await finishingRuns.get(session.id)
      try {
        activeRuns.set(session.id, {
          sessionId: session.id,
          startedAt: Date.now(),
          snapshot: await captureProjectSnapshot(session.project.path),
        })
      } catch {
        // 变更追踪失败不阻塞 Agent 运行。
      }
    },
    onStream(channel, payload) {
      if (channel !== AGENT_IPC_CHANNELS.STREAM_COMPLETE && channel !== AGENT_IPC_CHANNELS.STREAM_ERROR) return
      const sessionId = (payload as { sessionId?: unknown })?.sessionId
      if (typeof sessionId !== 'string') return

      const finishing = finishRun(sessionId).finally(() => {
        if (finishingRuns.get(sessionId) === finishing) finishingRuns.delete(sessionId)
      })
      finishingRuns.set(sessionId, finishing)
    },
  })

  return () => {
    unregister()
    trackingInitialized = false
    activeRuns.clear()
    finishingRuns.clear()
    completedRuns.clear()
  }
}

export function getProjectRunChanges(sessionId: string): ProjectRunChanges | null {
  return completedRuns.get(sessionId) ?? null
}

export function clearProjectRunChanges(sessionId: string): void {
  activeRuns.delete(sessionId)
  finishingRuns.delete(sessionId)
  completedRuns.delete(sessionId)
}
