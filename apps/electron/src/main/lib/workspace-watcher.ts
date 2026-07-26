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
import { watch as chokidarWatch } from 'chokidar'
import { resolve } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { SessionMeta } from '@kila/shared'
import { AGENT_IPC_CHANNELS } from '@kila/shared'
import { getAgentWorkspacesDir, getGlobalAgentConfigDir } from './config-paths'
import { createLogger } from './logger'

const log = createLogger('工作区监听')

/** debounce 延迟（ms） */
const DEBOUNCE_MS = 500

interface CloseableWatcher {
  close(): void
}

/**
 * 跨平台递归目录监听。
 *
 * macOS / Windows 用 OS 原生 `fs.watch({recursive})`（单 watcher、开销低）；
 * Linux 不支持 recursive fs.watch，回退到 chokidar，并忽略 node_modules/.git 等
 * 高频且与文件浏览器/能力刷新无关的重目录，避免海量 watcher 拖垮进程。
 *
 * onChange 回传发生变化的路径（fs.watch 为相对路径，chokidar 为绝对路径；
 * 上层仅做 endsWith / includes 子串判断，两者均适用），无法获知时回传 null。
 */
function createRecursiveWatcher(
  dirPath: string,
  onChange: (changedPath: string | null) => void,
): CloseableWatcher {
  if (process.platform === 'linux') {
    const chokidarWatcher = chokidarWatch(dirPath, {
      ignoreInitial: true,
      ignored: (watchedPath: string) =>
        watchedPath.includes('/node_modules/') || watchedPath.includes('/.git/'),
    })
    chokidarWatcher.on('all', (_event, changedPath) => onChange(changedPath ?? null))
    chokidarWatcher.on('error', (error) => log.warn('[递归监听] chokidar 错误:', error))
    return { close: () => { void chokidarWatcher.close() } }
  }

  const fsWatcher = watch(dirPath, { recursive: true }, (_eventType, filename) =>
    onChange(typeof filename === 'string' ? filename : null),
  )
  return { close: () => fsWatcher.close() }
}

interface SessionProjectWatchRegistryDeps {
  directoryExists: (dirPath: string) => boolean
  watchDirectory: (dirPath: string, onChange: () => void) => CloseableWatcher
  onFilesChanged: () => void
  logger?: Pick<typeof console, 'info' | 'warn' | 'error'>
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

let watcher: CloseableWatcher | null = null
let globalAgentWatcher: CloseableWatcher | null = null
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
  // 会话监听的两类“持有”来源：可见 Pane reconcile 持有、以及运行时/headless 直接持有。
  // 只要任一来源持有，会话监听就保留——避免可见 Pane reconcile 误拆一个正在后台运行
  // （bridge / scheduled / cli）会话的项目监听。
  const reconcileHeldSessionIds = new Set<string>()
  const explicitHeldSessionIds = new Set<string>()

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
      logger.info('[Session 项目监听] 已启动:', normalizedPath)
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
    logger.info('[Session 项目监听] 已停止:', normalizedPath)
  }

  // 确保某会话监听到指定路径（幂等）；路径变化时释放旧路径、保留新路径。
  const ensureSessionWatch = (sessionId: string, projectPath: string): void => {
    const normalizedPath = normalizeWatchPath(projectPath)
    const previousPath = sessionProjectPaths.get(sessionId)

    if (previousPath === normalizedPath) return
    if (!retainProjectPath(normalizedPath)) return

    sessionProjectPaths.set(sessionId, normalizedPath)
    if (previousPath) {
      releaseProjectPath(previousPath)
    }
  }

  // 仅当两类持有来源都不再持有该会话时，才真正停止其项目监听。
  const dropSessionWatchIfUnheld = (sessionId: string): void => {
    if (reconcileHeldSessionIds.has(sessionId) || explicitHeldSessionIds.has(sessionId)) return
    const previousPath = sessionProjectPaths.get(sessionId)
    if (!previousPath) return
    sessionProjectPaths.delete(sessionId)
    releaseProjectPath(previousPath)
  }

  const watchSessionProject = (sessionId: string, projectPath: string): void => {
    explicitHeldSessionIds.add(sessionId)
    ensureSessionWatch(sessionId, projectPath)
  }

  const unwatchSessionProject = (sessionId: string): void => {
    explicitHeldSessionIds.delete(sessionId)
    dropSessionWatchIfUnheld(sessionId)
  }

  const restoreSessionProjectWatches = (sessions: Array<Pick<SessionMeta, 'id' | 'project'>>): void => {
    const incomingSessionIds = new Set(sessions.map((session) => session.id))

    // 释放不再可见的 reconcile 持有；若该会话仍被 headless 显式持有，则保留监听。
    for (const existingSessionId of Array.from(reconcileHeldSessionIds)) {
      if (!incomingSessionIds.has(existingSessionId)) {
        reconcileHeldSessionIds.delete(existingSessionId)
        dropSessionWatchIfUnheld(existingSessionId)
      }
    }

    for (const session of sessions) {
      reconcileHeldSessionIds.add(session.id)
      ensureSessionWatch(session.id, session.project.path)
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
      reconcileHeldSessionIds.clear()
      explicitHeldSessionIds.clear()
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
  watchDirectory: (dirPath, onChange) => createRecursiveWatcher(dirPath, onChange),
  onFilesChanged: () => {
    emitWorkspaceFilesChanged()
  },
  logger: log,
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
    log.warn('[工作区监听] 目录不存在，跳过:', watchDir)
  } else {
    try {
      watcher = createRecursiveWatcher(watchDir, (filename) => {
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

      log.info('[工作区监听] 已启动文件监听:', watchDir)
    } catch (error) {
      log.error('[工作区监听] 启动失败:', error)
    }
  }

  if (!existsSync(globalAgentDir)) {
    log.warn('[全局 Agent 配置监听] 目录不存在，跳过:', globalAgentDir)
    return
  }

  try {
    globalAgentWatcher = createRecursiveWatcher(globalAgentDir, () => {
      if (win.isDestroyed()) return
      emitCapabilitiesChanged()
    })
    log.info('[全局 Agent 配置监听] 已启动:', globalAgentDir)
  } catch (error) {
    log.error('[全局 Agent 配置监听] 启动失败:', error)
  }
}

/**
 * 停止工作区文件监听
 */
export function stopWorkspaceWatcher(): void {
  if (watcher) {
    watcher.close()
    watcher = null
    log.info('[工作区监听] 已停止')
  }

  if (globalAgentWatcher) {
    globalAgentWatcher.close()
    globalAgentWatcher = null
    log.info('[全局 Agent 配置监听] 已停止')
  }

  // 同时清理所有附加目录监听器
  for (const [dirPath, w] of attachedWatchers) {
    w.close()
    log.info('[附加目录监听] 已停止:', dirPath)
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
    log.warn('[附加目录监听] 目录不存在，跳过:', normalizedPath)
    return
  }

  try {
    const w = watch(normalizedPath, { recursive: true }, () => {
      emitWorkspaceFilesChanged()
    })

    attachedWatchers.set(normalizedPath, w)
    log.info('[附加目录监听] 已启动:', normalizedPath)
  } catch (error) {
    log.error('[附加目录监听] 启动失败:', normalizedPath, error)
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
    log.info('[附加目录监听] 已停止:', normalizedPath)
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
