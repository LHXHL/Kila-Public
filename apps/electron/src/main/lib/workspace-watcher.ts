/**
 * 工作区文件监听器
 *
 * 使用 fs.watch 递归监听 ~/.kila/agent-workspaces/ 目录，
 * 根据变化的文件路径区分事件类型：
 * - ~/.kila/global-agent/ 变化 → 推送 CAPABILITIES_CHANGED
 * - mcp.json / .agents/skills/ 变化 → 推送 CAPABILITIES_CHANGED（侧边栏刷新）
 * - 其他文件变化 → 推送 WORKSPACE_FILES_CHANGED（文件浏览器刷新）
 *
 * 同时支持监听附加目录（外部路径），变化时统一推送 WORKSPACE_FILES_CHANGED。
 *
 * 所有事件均做 debounce 防抖，避免高频文件操作导致渲染进程风暴。
 */

import { watch, existsSync } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { resolve } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { SessionMeta } from '@kila/shared'
import { AGENT_IPC_CHANNELS } from '@kila/shared'
import { getAgentWorkspacesDir, getGlobalAgentConfigDir } from './config-paths'

/** debounce 延迟（ms） */
const DEBOUNCE_MS = 500

interface CloseableWatcher {
  close(): void
}

interface SessionProjectWatchRegistryDeps {
  directoryExists: (dirPath: string) => boolean
  watchDirectory: (dirPath: string, onChange: () => void) => CloseableWatcher
  onFilesChanged: () => void
  logger?: Pick<typeof console, 'log' | 'warn' | 'error'>
}

interface WatchedProjectPathEntry {
  watcher: CloseableWatcher
  refCount: number
}

interface SessionProjectWatchRegistrySnapshot {
  sessionProjectPaths: Array<[string, string]>
  watchedProjectPaths: Array<{ path: string; refCount: number }>
}

interface SessionProjectWatchRegistry {
  watchSessionProject: (sessionId: string, projectPath: string) => void
  unwatchSessionProject: (sessionId: string) => void
  restoreSessionProjectWatches: (sessions: Array<Pick<SessionMeta, 'id' | 'project'>>) => void
  dispose: () => void
  getSnapshot: () => SessionProjectWatchRegistrySnapshot
}

let watcher: FSWatcher | null = null
let globalAgentWatcher: FSWatcher | null = null
let capabilitiesTimer: ReturnType<typeof setTimeout> | null = null
let workspaceFilesTimer: ReturnType<typeof setTimeout> | null = null

/** 附加目录监听器：路径 → FSWatcher */
const attachedWatchers = new Map<string, FSWatcher>()
/** 主窗口引用（供附加目录监听器使用） */
let mainWin: BrowserWindow | null = null

function normalizeWatchPath(dirPath: string): string {
  return resolve(dirPath)
}

function emitWorkspaceFilesChanged(): void {
  if (workspaceFilesTimer) clearTimeout(workspaceFilesTimer)
  workspaceFilesTimer = setTimeout(() => {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send(AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED)
    }
    workspaceFilesTimer = null
  }, DEBOUNCE_MS)
}

function emitCapabilitiesChanged(): void {
  if (capabilitiesTimer) clearTimeout(capabilitiesTimer)
  capabilitiesTimer = setTimeout(() => {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send(AGENT_IPC_CHANNELS.CAPABILITIES_CHANGED)
    }
    capabilitiesTimer = null
  }, DEBOUNCE_MS)
}

export function createSessionProjectWatchRegistry(
  deps: SessionProjectWatchRegistryDeps,
): SessionProjectWatchRegistry {
  const logger = deps.logger ?? console
  const sessionProjectPaths = new Map<string, string>()
  const watchedProjectPaths = new Map<string, WatchedProjectPathEntry>()

  const retainProjectPath = (projectPath: string): boolean => {
    const normalizedPath = normalizeWatchPath(projectPath)
    const existing = watchedProjectPaths.get(normalizedPath)

    if (existing) {
      existing.refCount += 1
      return true
    }

    if (!deps.directoryExists(normalizedPath)) {
      logger.warn('[Session 项目监听] 目录不存在，跳过:', normalizedPath)
      return false
    }

    try {
      const pathWatcher = deps.watchDirectory(normalizedPath, deps.onFilesChanged)
      watchedProjectPaths.set(normalizedPath, {
        watcher: pathWatcher,
        refCount: 1,
      })
      logger.log('[Session 项目监听] 已启动:', normalizedPath)
      return true
    } catch (error) {
      logger.error('[Session 项目监听] 启动失败:', normalizedPath, error)
      return false
    }
  }

  const releaseProjectPath = (projectPath: string): void => {
    const normalizedPath = normalizeWatchPath(projectPath)
    const current = watchedProjectPaths.get(normalizedPath)
    if (!current) return

    if (current.refCount > 1) {
      current.refCount -= 1
      return
    }

    current.watcher.close()
    watchedProjectPaths.delete(normalizedPath)
    logger.log('[Session 项目监听] 已停止:', normalizedPath)
  }

  const watchSessionProject = (sessionId: string, projectPath: string): void => {
    const normalizedPath = normalizeWatchPath(projectPath)
    const previousPath = sessionProjectPaths.get(sessionId)

    if (previousPath === normalizedPath) return
    if (!retainProjectPath(normalizedPath)) return

    sessionProjectPaths.set(sessionId, normalizedPath)

    if (previousPath) {
      releaseProjectPath(previousPath)
    }
  }

  const unwatchSessionProject = (sessionId: string): void => {
    const previousPath = sessionProjectPaths.get(sessionId)
    if (!previousPath) return

    sessionProjectPaths.delete(sessionId)
    releaseProjectPath(previousPath)
  }

  const restoreSessionProjectWatches = (sessions: Array<Pick<SessionMeta, 'id' | 'project'>>): void => {
    const incomingSessionIds = new Set(sessions.map((session) => session.id))

    for (const existingSessionId of Array.from(sessionProjectPaths.keys())) {
      if (!incomingSessionIds.has(existingSessionId)) {
        unwatchSessionProject(existingSessionId)
      }
    }

    for (const session of sessions) {
      watchSessionProject(session.id, session.project.path)
    }
  }

  return {
    watchSessionProject,
    unwatchSessionProject,
    restoreSessionProjectWatches,

    dispose(): void {
      for (const watched of watchedProjectPaths.values()) {
        watched.watcher.close()
      }
      watchedProjectPaths.clear()
      sessionProjectPaths.clear()
    },

    getSnapshot(): SessionProjectWatchRegistrySnapshot {
      return {
        sessionProjectPaths: Array.from(sessionProjectPaths.entries()).sort((a, b) => a[0].localeCompare(b[0])),
        watchedProjectPaths: Array.from(watchedProjectPaths.entries())
          .map(([path, entry]) => ({ path, refCount: entry.refCount }))
          .sort((a, b) => a.path.localeCompare(b.path)),
      }
    },
  }
}

const sessionProjectWatchRegistry = createSessionProjectWatchRegistry({
  directoryExists: existsSync,
  watchDirectory: (dirPath, onChange) => watch(dirPath, { recursive: true }, () => {
    onChange()
  }),
  onFilesChanged: () => {
    emitWorkspaceFilesChanged()
  },
})

/**
 * 启动工作区文件监听
 *
 * @param win 主窗口引用，用于向渲染进程推送事件
 */
export function startWorkspaceWatcher(win: BrowserWindow): void {
  mainWin = win
  const watchDir = getAgentWorkspacesDir()
  const globalAgentDir = getGlobalAgentConfigDir()

  if (!existsSync(watchDir)) {
    console.warn('[工作区监听] 目录不存在，跳过:', watchDir)
  } else {
    try {
      watcher = watch(watchDir, { recursive: true }, (_eventType, filename) => {
        if (!filename || win.isDestroyed()) return

        // filename 格式: {slug}/mcp.json、{slug}/.agents/skills/xxx/SKILL.md 或 {slug}/{sessionId}/file.txt
        const isCapabilitiesChange =
          filename.endsWith('/mcp.json') ||
          filename.endsWith('\\mcp.json') ||
          filename.includes('/.agents/skills/') ||
          filename.includes('\\.agents\\skills\\') ||
          filename.includes('/skills/') ||
          filename.includes('\\skills/')

        if (isCapabilitiesChange) {
          emitCapabilitiesChanged()
        } else {
          emitWorkspaceFilesChanged()
        }
      })

      console.log('[工作区监听] 已启动文件监听:', watchDir)
    } catch (error) {
      console.error('[工作区监听] 启动失败:', error)
    }
  }

  if (!existsSync(globalAgentDir)) {
    console.warn('[全局 Agent 配置监听] 目录不存在，跳过:', globalAgentDir)
    return
  }

  try {
    globalAgentWatcher = watch(globalAgentDir, { recursive: true }, () => {
      if (win.isDestroyed()) return
      emitCapabilitiesChanged()
    })
    console.log('[全局 Agent 配置监听] 已启动:', globalAgentDir)
  } catch (error) {
    console.error('[全局 Agent 配置监听] 启动失败:', error)
  }
}

/**
 * 停止工作区文件监听
 */
export function stopWorkspaceWatcher(): void {
  if (watcher) {
    watcher.close()
    watcher = null
    console.log('[工作区监听] 已停止')
  }

  if (globalAgentWatcher) {
    globalAgentWatcher.close()
    globalAgentWatcher = null
    console.log('[全局 Agent 配置监听] 已停止')
  }

  // 同时清理所有附加目录监听器
  for (const [dirPath, w] of attachedWatchers) {
    w.close()
    console.log('[附加目录监听] 已停止:', dirPath)
  }
  attachedWatchers.clear()

  sessionProjectWatchRegistry.dispose()

  if (capabilitiesTimer) {
    clearTimeout(capabilitiesTimer)
    capabilitiesTimer = null
  }
  if (workspaceFilesTimer) {
    clearTimeout(workspaceFilesTimer)
    workspaceFilesTimer = null
  }

  mainWin = null
}

/**
 * 开始监听附加目录
 * 当目录内文件变化时，推送 WORKSPACE_FILES_CHANGED 事件
 */
export function watchAttachedDirectory(dirPath: string): void {
  const normalizedPath = normalizeWatchPath(dirPath)

  if (attachedWatchers.has(normalizedPath)) return
  if (!existsSync(normalizedPath)) {
    console.warn('[附加目录监听] 目录不存在，跳过:', normalizedPath)
    return
  }

  try {
    const w = watch(normalizedPath, { recursive: true }, () => {
      emitWorkspaceFilesChanged()
    })

    attachedWatchers.set(normalizedPath, w)
    console.log('[附加目录监听] 已启动:', normalizedPath)
  } catch (error) {
    console.error('[附加目录监听] 启动失败:', normalizedPath, error)
  }
}

/**
 * 停止监听附加目录
 */
export function unwatchAttachedDirectory(dirPath: string): void {
  const normalizedPath = normalizeWatchPath(dirPath)
  const w = attachedWatchers.get(normalizedPath)
  if (w) {
    w.close()
    attachedWatchers.delete(normalizedPath)
    console.log('[附加目录监听] 已停止:', normalizedPath)
  }
}

export function watchSessionProject(sessionId: string, projectPath: string): void {
  sessionProjectWatchRegistry.watchSessionProject(sessionId, projectPath)
}

export function unwatchSessionProject(sessionId: string): void {
  sessionProjectWatchRegistry.unwatchSessionProject(sessionId)
}

export function restoreSessionProjectWatches(
  sessions: Array<Pick<SessionMeta, 'id' | 'project'>>,
): void {
  sessionProjectWatchRegistry.restoreSessionProjectWatches(sessions)
}
