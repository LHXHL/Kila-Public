import type { ServerResponse } from 'node:http'
import { SESSION_IPC_CHANNELS, type CliBridgeSessionResponse } from '@kila/shared'
import { sendError, sendJson } from '../http'
import { getRecentSessionMessages, getSessionMeta, listSessions, updateSessionMeta, createSession } from '../../session-manager'
import { toCliSessionSummary } from '../session-summary'
import { watchSessionProject } from '../../workspace-watcher'
import { scheduledTaskManager } from '../../scheduled-task-singleton'
import { stopSessionWebPreviewServer } from '../../session-web-preview-manager'
import { broadcastSessionChannel } from '../broadcaster'
import { cleanupSessionProject, replaceSessionProject } from '../../session-project-manager'
import { deleteSessionWithCleanup } from '../../session-cleanup-service'

export function handleCliBridgeSessions(
  response: ServerResponse,
  limit: number,
): void {
  sendJson(response, 200, {
    sessions: listSessions().slice(0, limit).map(toCliSessionSummary),
  })
}

export function handleCliBridgeSessionMessages(
  response: ServerResponse,
  sessionId: string,
  limit: number,
): void {
  const session = getSessionMeta(sessionId)
  if (!session) {
    sendError(response, 404, `Session 不存在: ${sessionId}`)
    return
  }

  const recent = getRecentSessionMessages(sessionId, limit)
  sendJson(response, 200, {
    sessionId,
    messages: recent.messages,
    total: recent.total,
    hasMore: recent.hasMore,
  })
}

export function handleCliBridgeSession(
  response: ServerResponse,
  sessionId: string,
): void {
  const session = getSessionMeta(sessionId)
  if (!session) {
    sendError(response, 404, `Session 不存在: ${sessionId}`)
    return
  }

  const payload: CliBridgeSessionResponse = {
    session: {
      ...toCliSessionSummary(session),
      pinned: session.pinned,
      attachedDirectories: session.attachedDirectories,
      thinkingLevel: session.thinkingLevel,
      historyTurns: session.historyTurns,
      enabledToolIds: session.enabledToolIds,
    },
  }

  sendJson(response, 200, payload)
}

export function handleCliBridgeCreateSession(
  response: ServerResponse,
  body: {
    title?: string
    projectPath?: string
    channelId?: string
    modelId?: string
  },
  ): void {
  const session = createSession({
    title: body.title,
    projectPath: body.projectPath,
    channelId: body.channelId,
    modelId: body.modelId,
  })
  watchSessionProject(session.id, session.project.path)
  sendJson(response, 201, {
    session: {
      ...toCliSessionSummary(session),
      pinned: session.pinned,
      attachedDirectories: session.attachedDirectories,
      thinkingLevel: session.thinkingLevel,
      historyTurns: session.historyTurns,
      enabledToolIds: session.enabledToolIds,
    },
  } satisfies CliBridgeSessionResponse)
}

export function handleCliBridgeUpdateSession(
  response: ServerResponse,
  sessionId: string,
  updates: {
    title?: string
    pinned?: boolean
    projectPath?: string
    channelId?: string
    modelId?: string
    thinkingLevel?: CliBridgeSessionResponse['session']['thinkingLevel']
    historyTurns?: CliBridgeSessionResponse['session']['historyTurns']
    enabledToolIds?: string[]
  },
): void {
  const session = getSessionMeta(sessionId)
  if (!session) {
    sendError(response, 404, `Session 不存在: ${sessionId}`)
    return
  }

  const updated = updateSessionMeta(sessionId, {
    ...(typeof updates.title === 'string' ? { title: updates.title } : {}),
    ...(typeof updates.pinned === 'boolean' ? { pinned: updates.pinned } : {}),
    ...(typeof updates.channelId === 'string' ? { channelId: updates.channelId } : {}),
    ...(typeof updates.modelId === 'string' ? { modelId: updates.modelId } : {}),
    ...(typeof updates.thinkingLevel === 'string' ? { thinkingLevel: updates.thinkingLevel } : {}),
    ...(typeof updates.historyTurns !== 'undefined' ? { historyTurns: updates.historyTurns } : {}),
    ...(Array.isArray(updates.enabledToolIds) ? { enabledToolIds: updates.enabledToolIds } : {}),
  })

  let finalSession = updated

  if (typeof updates.projectPath === 'string' && updates.projectPath !== session.project.path) {
    const { nextProject, previousProject } = replaceSessionProject(session, updates.projectPath)
    finalSession = updateSessionMeta(sessionId, { project: nextProject })
    watchSessionProject(finalSession.id, finalSession.project.path)
    if (previousProject && previousProject.path !== nextProject.path) {
      void stopSessionWebPreviewServer(sessionId)
      cleanupSessionProject(previousProject)
    }
  }

  // 广播给桌面 app，确保渲染进程和内部缓存同步
  broadcastSessionChannel(SESSION_IPC_CHANNELS.UPDATED, {
    sessionId,
    reason: 'updated',
  })

  sendJson(response, 200, {
    session: {
      ...toCliSessionSummary(finalSession),
      pinned: finalSession.pinned,
      attachedDirectories: finalSession.attachedDirectories,
      thinkingLevel: finalSession.thinkingLevel,
      historyTurns: finalSession.historyTurns,
      enabledToolIds: finalSession.enabledToolIds,
    },
  } satisfies CliBridgeSessionResponse)
}

export async function handleCliBridgeDeleteSession(
  response: ServerResponse,
  sessionId: string,
): Promise<void> {
  const blockingTasks = scheduledTaskManager.listRunningTasksForSession(sessionId)
  if (blockingTasks.length > 0) {
    sendError(response, 400, '请先停止关联的定时任务')
    return
  }

  const session = getSessionMeta(sessionId)
  if (!session) {
    sendError(response, 404, `Session 不存在: ${sessionId}`)
    return
  }

  await deleteSessionWithCleanup(sessionId)

  sendJson(response, 200, { ok: true })
}
