/**
 * Agent 服务层（IPC 薄层）
 *
 * 职责：
 * - 创建 AgentOrchestrator / EventBus / Adapter 实例
 * - 注册 EventBus IPC 转发中间件（webContents.send）
 * - 导出 IPC handler 调用的薄包装函数
 * - 文件操作（saveFilesToAgentSession）
 *
 * 所有业务逻辑已委托给 AgentOrchestrator。
 */

import { BrowserWindow } from 'electron'
import type { WebContents } from 'electron'
import { AGENT_IPC_CHANNELS } from '@kila/shared'
import type {
  AgentSendInput,
  AgentGenerateTitleInput,
  AgentSaveFilesInput,
  AgentSaveWorkspaceFilesInput,
  AgentSavedFile,
  AgentStreamEvent,
} from '@kila/shared'
import { PiAgentAdapter } from './adapters/pi-agent-adapter'
import { AgentEventBus } from './agent-event-bus'
import { AgentOrchestrator } from './agent-orchestrator'
import { getAgentSessionWorkspacePath, getWorkspaceFilesDir } from './config-paths'
import { getSessionMeta } from './session-manager'
import { saveAgentFilesToRoot } from './agent-file-save'

// ===== 实例创建 =====


import { createLogger } from './logger'
const log = createLogger('Agent 服务')

const eventBus = new AgentEventBus()
const adapter = new PiAgentAdapter()
const orchestrator = new AgentOrchestrator(adapter, eventBus)

/** 导出 EventBus 供飞书 Bridge 等外部服务订阅事件 */
export { eventBus as agentEventBus }

/**
 * 会话 → webContents 映射
 *
 * EventBus IPC 转发中间件通过此映射找到目标 webContents。
 * runAgent 开始时注册，结束时清理。
 */
interface SessionWebContentsRoute {
  owner: symbol
  webContents: WebContents
}

const sessionWebContents = new Map<string, SessionWebContentsRoute>()

// ===== EventBus IPC 转发中间件 =====

eventBus.use((sessionId, event, next) => {
  const wc = sessionWebContents.get(sessionId)?.webContents
  if (wc && !wc.isDestroyed()) {
    wc.send(AGENT_IPC_CHANNELS.STREAM_EVENT, { sessionId, event } as AgentStreamEvent)
  }
  next()
})

// ===== IPC 薄包装函数 =====

/**
 * 运行 Agent 并流式推送事件到渲染进程
 *
 * 注册 webContents 到 EventBus 映射，委托给 Orchestrator。
 */
export async function runAgent(
  input: AgentSendInput,
  webContents: WebContents,
): Promise<void> {
  // 用 owner token 管理路由所有权。并发请求即使被 orchestrator 拒绝，也不能覆盖
  // 已在运行请求的 Renderer sink，否则后续流式事件会被发到错误窗口。
  const owner = Symbol(input.sessionId)
  const previousRoute = sessionWebContents.get(input.sessionId)
  sessionWebContents.set(input.sessionId, { owner, webContents })
  try {
    await orchestrator.sendMessage(input, {
      onError: (error) => {
        if (!webContents.isDestroyed()) {
          webContents.send(AGENT_IPC_CHANNELS.STREAM_ERROR, {
            sessionId: input.sessionId,
            error,
          })
        }
      },
      onComplete: (messages, outcome = 'success') => {
        if (!webContents.isDestroyed()) {
          webContents.send(AGENT_IPC_CHANNELS.STREAM_COMPLETE, {
            sessionId: input.sessionId,
            outcome,
            messages,
          })
        }
      },
      onTitleUpdated: (title) => {
        if (!webContents.isDestroyed()) {
          webContents.send(AGENT_IPC_CHANNELS.TITLE_UPDATED, {
            sessionId: input.sessionId,
            title,
          })
        }
      },
    })
  } finally {
    const currentRoute = sessionWebContents.get(input.sessionId)
    if (currentRoute?.owner === owner) {
      if (orchestrator.isActive(input.sessionId) && previousRoute) {
        sessionWebContents.set(input.sessionId, previousRoute)
      } else {
        sessionWebContents.delete(input.sessionId)
      }
    }
  }
}

/**
 * 无渲染进程的 Agent 运行（供飞书 Bridge 等外部调用方使用）
 *
 * 如果桌面窗口存在，同时注册 webContents 以便事件同步到桌面端 UI。
 * 事件同时通过 EventBus listeners 分发给飞书 Bridge。
 */
export async function runAgentHeadless(
  input: AgentSendInput,
  callbacks: {
    onError: (error: string) => void
    onComplete: () => void
    onTitleUpdated: (title: string) => void
  },
): Promise<void> {
  // 尝试注册主窗口 webContents，让流式事件同步推送到桌面端
  const win = BrowserWindow.getAllWindows()[0]
  const wc = win && !win.isDestroyed() ? win.webContents : null
  const owner = Symbol(input.sessionId)
  const previousRoute = sessionWebContents.get(input.sessionId)
  if (wc) sessionWebContents.set(input.sessionId, { owner, webContents: wc })

  try {
    await orchestrator.sendMessage(input, {
      onError: (error) => {
        callbacks.onError(error)
        // 同步到渲染进程
        if (wc && !wc.isDestroyed()) {
          wc.send(AGENT_IPC_CHANNELS.STREAM_ERROR, {
            sessionId: input.sessionId,
            error,
          })
        }
      },
      onComplete: (messages, outcome = 'success') => {
        callbacks.onComplete()
        // 同步到渲染进程
        if (wc && !wc.isDestroyed()) {
          wc.send(AGENT_IPC_CHANNELS.STREAM_COMPLETE, {
            sessionId: input.sessionId,
            outcome,
            messages,
          })
        }
      },
      onTitleUpdated: (title) => {
        callbacks.onTitleUpdated(title)
        // 同步到渲染进程
        if (wc && !wc.isDestroyed()) {
          wc.send(AGENT_IPC_CHANNELS.TITLE_UPDATED, {
            sessionId: input.sessionId,
            title,
          })
        }
      },
    })
  } finally {
    const currentRoute = sessionWebContents.get(input.sessionId)
    if (currentRoute?.owner === owner) {
      if (orchestrator.isActive(input.sessionId) && previousRoute) {
        sessionWebContents.set(input.sessionId, previousRoute)
      } else {
        sessionWebContents.delete(input.sessionId)
      }
    }
  }
}

/**
 * 生成 Agent 会话标题
 */
export async function generateAgentTitle(input: AgentGenerateTitleInput): Promise<string | null> {
  return orchestrator.generateTitle(input)
}

/**
 * 中止指定会话的 Agent 执行
 */
export function stopAgent(sessionId: string): void {
  orchestrator.stop(sessionId)
}

/**
 * 中止指定会话并等待底层 runtime 完全 settle
 */
export async function stopAgentAndWait(sessionId: string, timeoutMs = 5000): Promise<void> {
  await orchestrator.stopAndWait(sessionId, timeoutMs)
  if (!orchestrator.isActive(sessionId)) {
    sessionWebContents.delete(sessionId)
  }
}

export async function steerAgent(input: AgentSendInput): Promise<void> {
  await orchestrator.steerMessage(input)
}

export async function followUpAgent(input: AgentSendInput): Promise<void> {
  await orchestrator.followUpMessage(input)
}

export async function waitForAgentIdle(sessionId: string): Promise<void> {
  await orchestrator.waitForIdle(sessionId)
}

/** 丢弃指定 Session 的内存 Pi runtime，供 rewind/regenerate/delete 使用。 */
export async function resetAgentSession(sessionId: string): Promise<void> {
  await orchestrator.resetSession(sessionId)
  sessionWebContents.delete(sessionId)
}

/**
 * 检查指定会话是否正在运行
 */
export function isAgentSessionActive(sessionId: string): boolean {
  return orchestrator.isActive(sessionId)
}

/** 中止所有活跃的 Agent 会话（应用退出时调用） */
export function stopAllAgents(): void {
  orchestrator.stopAll()
}

// ===== 文件操作 =====

/**
 * 保存文件到 Agent session 工作目录
 *
 * 将 base64 编码的文件写入 session 的 cwd，供 Agent 通过 Read 工具读取。
 */
function saveFilesToRoot(rootDir: string, files: Array<{ filename: string; data: string }>): AgentSavedFile[] {
  return saveAgentFilesToRoot(rootDir, files, (targetPath, size) => {
    log.info(`[Agent 服务] 文件已保存: ${targetPath} (${size} bytes)`)
  })
}

export function saveFilesToAgentSession(input: AgentSaveFilesInput): AgentSavedFile[] {
  const sessionDir = getAgentSessionWorkspacePath(input.workspaceSlug, input.sessionId)
  return saveFilesToRoot(sessionDir, input.files)
}

/**
 * 保存文件到工作区文件目录
 *
 * 将 base64 编码的文件写入工作区 workspace-files/ 目录，所有会话均可访问。
 */
export function saveFilesToWorkspaceFiles(input: AgentSaveWorkspaceFilesInput): AgentSavedFile[] {
  const wsFilesDir = getWorkspaceFilesDir(input.workspaceSlug)
  return saveFilesToRoot(wsFilesDir, input.files)
}

/**
 * 保存文件到统一 Session 当前项目目录
 */
export function saveFilesToSessionProject(
  sessionId: string,
  files: Array<{ filename: string; data: string }>,
): AgentSavedFile[] {
  const session = getSessionMeta(sessionId)
  if (!session) {
    throw new Error(`Session 不存在: ${sessionId}`)
  }

  return saveFilesToRoot(session.project.path, files)
}
