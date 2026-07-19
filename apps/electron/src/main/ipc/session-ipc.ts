/**
 * 统一 Session IPC 处理器
 *
 * Session CRUD、消息、标题、项目、教程
 */

import { SESSION_IPC_CHANNELS } from '@kila/shared'
import type {
  SessionCreateInput,
  SessionBranchComparison,
  SessionBranchFromMessageInput,
  SessionEditTurnInput,
  SessionExportInput,
  SessionExportResult,
  SessionImportInput,
  SessionImportResult,
  SessionMessage,
  SessionMessagesPageInput,
  SessionMessagesPageResult,
  SessionMeta,
  SessionMetaUpdates,
  SessionRecentMessagesResult,
  SessionSearchInput,
  SessionSearchResults,
  SessionRegenerateTurnInput,
  SessionRewindInput,
  SessionSendInput,
  SessionProjectFilesSaveInput,
  AgentSavedFile,
  GenerateSuggestionsResult,
} from '@kila/shared'
import { handle } from './shared'
import {
  listSessions as listUnifiedSessions,
  createSession as createUnifiedSession,
  getSessionMeta as getUnifiedSessionMeta,
  getSessionMessages as getUnifiedSessionMessages,
  getSessionMessagesPage as getUnifiedSessionMessagesPage,
  getRecentSessionMessages as getUnifiedRecentSessionMessages,
  updateSessionMeta as updateUnifiedSessionMeta,
} from '../lib/session-manager'
import {
  branchSessionFromMessage,
  compareSessionBranch,
  editSessionTurn,
  generateSessionTitleForSession,
  regenerateSessionTurn,
  rewindSession,
  sendSessionMessage,
  stopSession,
} from '../lib/session-service'
import {
  cleanupSessionProject,
  ensureSessionProjectReady,
  replaceSessionProject,
} from '../lib/session-project-manager'
import { stopSessionWebPreviewServer } from '../lib/session-web-preview-manager'
import {
  restoreSessionProjectWatches,
  watchSessionProject,
} from '../lib/workspace-watcher'
import { saveFilesToSessionProject } from '../lib/agent-service'
import { scheduledTaskManager } from '../lib/scheduled-task-singleton'
import { searchSessions } from '../lib/session-search-service'
import {
  exportSessionBundle,
  importSessionBundle,
} from '../lib/session-portability-service'
import { generateSuggestions } from '../lib/session-suggestion-service'
import { deleteSessionWithCleanup } from '../lib/session-cleanup-service'
import {
  assertMessageId,
  assertNumber,
  assertSessionId,
  assertString,
  assertStringArray,
  validateSessionMessagesPageInput,
  validateSessionProjectFilesSaveInput,
  validateSessionSearchInput,
} from './validation'

export function registerSessionHandlers(): void {
  handle(
    SESSION_IPC_CHANNELS.LIST_SESSIONS,
    async (): Promise<SessionMeta[]> => {
      return listUnifiedSessions()
    }
  )

  handle(
    SESSION_IPC_CHANNELS.CREATE_SESSION,
    async (event, input?: SessionCreateInput): Promise<SessionMeta> => {
      const session = createUnifiedSession(input)
      watchSessionProject(session.id, session.project.path)
      event.sender.send(SESSION_IPC_CHANNELS.UPDATED, {
        sessionId: session.id,
        reason: 'created',
      })
      return session
    }
  )

  handle(
    SESSION_IPC_CHANNELS.GET_MESSAGES,
    async (_, id: string): Promise<SessionMessage[]> => {
      return getUnifiedSessionMessages(assertSessionId(id))
    }
  )

  handle(
    SESSION_IPC_CHANNELS.GET_RECENT_MESSAGES,
    async (
      _,
      id: string,
      limit: number
    ): Promise<SessionRecentMessagesResult> => {
      return getUnifiedRecentSessionMessages(
        assertSessionId(id),
        assertNumber(limit, 'limit', { min: 1, max: 500, integer: true })
      )
    }
  )

  handle(
    SESSION_IPC_CHANNELS.GET_MESSAGES_PAGE,
    async (
      _,
      input: SessionMessagesPageInput
    ): Promise<SessionMessagesPageResult> => {
      const validated = validateSessionMessagesPageInput(input)
      return getUnifiedSessionMessagesPage(
        validated.sessionId,
        validated.offset,
        validated.limit
      )
    }
  )

  handle(
    SESSION_IPC_CHANNELS.SET_ACTIVE_PROJECT_WATCHES,
    async (_, rawSessionIds: string[]): Promise<void> => {
      const sessionIds = assertStringArray(rawSessionIds, 'sessionIds', {
        maxItems: 4,
        maxItemLength: 128,
      })
      const watchableSessions: Array<Pick<SessionMeta, 'id' | 'project'>> = []

      for (const sessionId of new Set(sessionIds)) {
        const session = getUnifiedSessionMeta(sessionId)
        if (!session) continue
        try {
          ensureSessionProjectReady(session.project)
          watchableSessions.push(session)
        } catch (error) {
          console.warn(
            `[Session 项目监听] Session ${sessionId} 的项目不可用:`,
            error
          )
        }
      }

      restoreSessionProjectWatches(watchableSessions)
    }
  )

  handle(
    SESSION_IPC_CHANNELS.SEARCH,
    async (_, input: SessionSearchInput): Promise<SessionSearchResults> => {
      return searchSessions(validateSessionSearchInput(input))
    }
  )

  handle(
    SESSION_IPC_CHANNELS.EXPORT,
    async (_, input: SessionExportInput): Promise<SessionExportResult> => {
      return exportSessionBundle(input)
    }
  )

  handle(
    SESSION_IPC_CHANNELS.IMPORT,
    async (event, input?: SessionImportInput): Promise<SessionImportResult> => {
      const result = await importSessionBundle(input)
      if (!result.canceled && !result.dryRun && result.sessionId) {
        const session = getUnifiedSessionMeta(result.sessionId)
        if (session) watchSessionProject(session.id, session.project.path)
        event.sender.send(SESSION_IPC_CHANNELS.UPDATED, {
          sessionId: result.sessionId,
          reason: 'created',
        })
      }
      return result
    }
  )

  handle(
    SESSION_IPC_CHANNELS.UPDATE_META,
    async (
      event,
      id: string,
      updates: SessionMetaUpdates
    ): Promise<SessionMeta> => {
      const sessionId = assertSessionId(id)
      const previous = getUnifiedSessionMeta(sessionId)
      const session = updateUnifiedSessionMeta(sessionId, updates)

      if (updates.project?.path) {
        watchSessionProject(sessionId, session.project.path)
      }

      if (
        typeof updates.title === 'string' &&
        updates.title !== previous?.title
      ) {
        event.sender.send(SESSION_IPC_CHANNELS.TITLE_UPDATED, {
          sessionId: session.id,
          title: session.title,
        })
      }

      event.sender.send(SESSION_IPC_CHANNELS.UPDATED, {
        sessionId: session.id,
        reason: 'updated',
      })

      return session
    }
  )

  handle(
    SESSION_IPC_CHANNELS.UPDATE_TITLE,
    async (event, id: string, title: string): Promise<SessionMeta> => {
      const session = updateUnifiedSessionMeta(assertSessionId(id), {
        title: assertString(title, 'title', { nonEmpty: true, max: 500 }),
      })
      event.sender.send(SESSION_IPC_CHANNELS.TITLE_UPDATED, {
        sessionId: session.id,
        title: session.title,
      })
      event.sender.send(SESSION_IPC_CHANNELS.UPDATED, {
        sessionId: session.id,
        reason: 'updated',
      })
      return session
    }
  )

  handle(
    SESSION_IPC_CHANNELS.DELETE_SESSION,
    async (event, id: string): Promise<void> => {
      const sessionId = assertSessionId(id)
      const blockingTasks =
        scheduledTaskManager.listRunningTasksForSession(sessionId)
      if (blockingTasks.length > 0) {
        throw new Error('请先停止关联的定时任务')
      }

      await deleteSessionWithCleanup(sessionId)
      event.sender.send(SESSION_IPC_CHANNELS.UPDATED, {
        sessionId,
        reason: 'deleted',
      })
    }
  )

  handle(
    SESSION_IPC_CHANNELS.TOGGLE_PIN,
    async (event, id: string): Promise<SessionMeta> => {
      const sessionId = assertSessionId(id)
      const sessions = listUnifiedSessions()
      const current = sessions.find((session) => session.id === sessionId)
      if (!current) throw new Error(`Session 不存在: ${sessionId}`)
      const session = updateUnifiedSessionMeta(sessionId, {
        pinned: !current.pinned,
      })
      event.sender.send(SESSION_IPC_CHANNELS.UPDATED, {
        sessionId: session.id,
        reason: 'updated',
      })
      return session
    }
  )

  handle(
    SESSION_IPC_CHANNELS.SEND_MESSAGE,
    async (event, input: SessionSendInput): Promise<void> => {
      const sessionId = assertSessionId(input?.sessionId)
      const validatedInput = { ...input, sessionId }
      const session = getUnifiedSessionMeta(sessionId)
      if (!session) throw new Error(`Session 不存在: ${sessionId}`)
      if (!(validatedInput.channelId ?? session.channelId)) {
        throw new Error('请先选择 Agent 模型渠道')
      }

      // 桌面 IPC 只确认请求已通过预检并启动；完整运行结果继续由流事件交付。
      void sendSessionMessage(validatedInput, event.sender).catch((error) => {
        console.error('[Session IPC] Agent 运行失败:', error)
        if (!event.sender.isDestroyed()) {
          event.sender.send(SESSION_IPC_CHANNELS.STREAM_ERROR, {
            sessionId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })
    }
  )

  handle(
    SESSION_IPC_CHANNELS.REGENERATE_TURN,
    async (event, input: SessionRegenerateTurnInput): Promise<void> => {
      await regenerateSessionTurn(
        {
          ...input,
          sessionId: assertSessionId(input?.sessionId),
          messageId: assertMessageId(input?.messageId),
        },
        event.sender
      )
    }
  )

  handle(
    SESSION_IPC_CHANNELS.REWIND,
    async (event, input: SessionRewindInput): Promise<SessionMessage[]> => {
      const validatedInput = {
        ...input,
        sessionId: assertSessionId(input?.sessionId),
        messageId: assertMessageId(input?.messageId),
      }
      const messages = await rewindSession(validatedInput)
      event.sender.send(SESSION_IPC_CHANNELS.UPDATED, {
        sessionId: validatedInput.sessionId,
        reason: 'updated',
      })
      return messages
    }
  )

  handle(
    SESSION_IPC_CHANNELS.EDIT_TURN,
    async (event, input: SessionEditTurnInput): Promise<void> => {
      await editSessionTurn(
        {
          ...input,
          sessionId: assertSessionId(input?.sessionId),
          messageId: assertMessageId(input?.messageId),
          userMessage: assertString(input?.userMessage, 'userMessage', {
            max: 1_000_000,
          }),
        },
        event.sender
      )
    }
  )

  handle(
    SESSION_IPC_CHANNELS.BRANCH_FROM_MESSAGE,
    async (
      event,
      input: SessionBranchFromMessageInput
    ): Promise<SessionMeta> => {
      const session = branchSessionFromMessage({
        ...input,
        sessionId: assertSessionId(input?.sessionId),
        messageId: assertMessageId(input?.messageId),
      })
      watchSessionProject(session.id, session.project.path)
      event.sender.send(SESSION_IPC_CHANNELS.UPDATED, {
        sessionId: session.id,
        reason: 'created',
      })
      return session
    }
  )

  handle(
    SESSION_IPC_CHANNELS.COMPARE_BRANCH,
    async (_event, sessionId: string): Promise<SessionBranchComparison> => {
      return compareSessionBranch(assertSessionId(sessionId))
    }
  )

  handle(
    SESSION_IPC_CHANNELS.GENERATE_TITLE,
    async (event, sessionId: string): Promise<string | null> => {
      return generateSessionTitleForSession(
        assertSessionId(sessionId),
        event.sender
      )
    }
  )

  handle(
    SESSION_IPC_CHANNELS.GENERATE_SUGGESTIONS,
    async (): Promise<GenerateSuggestionsResult> => {
      const suggestions = await generateSuggestions()
      return { suggestions }
    }
  )

  handle(
    SESSION_IPC_CHANNELS.STOP,
    async (_, sessionId: string): Promise<void> => {
      stopSession(assertSessionId(sessionId))
    }
  )

  handle(
    SESSION_IPC_CHANNELS.UPDATE_PROJECT,
    async (_, sessionId: string, projectPath: string): Promise<SessionMeta> => {
      const validatedSessionId = assertSessionId(sessionId)
      const validatedProjectPath = assertString(projectPath, 'projectPath', {
        nonEmpty: true,
        max: 4096,
      })
      const session = getUnifiedSessionMeta(validatedSessionId)
      if (!session) throw new Error(`Session 不存在: ${sessionId}`)
      const { nextProject, previousProject } = replaceSessionProject(
        session,
        validatedProjectPath
      )
      if (previousProject && previousProject.path !== nextProject.path) {
        await stopSessionWebPreviewServer(validatedSessionId)
      }
      const updated = updateUnifiedSessionMeta(validatedSessionId, {
        project: nextProject,
      })
      watchSessionProject(validatedSessionId, updated.project.path)

      if (previousProject && previousProject.path !== nextProject.path) {
        cleanupSessionProject(previousProject)
      }

      return updated
    }
  )

  handle(
    SESSION_IPC_CHANNELS.SAVE_PROJECT_FILES,
    async (
      _,
      input: SessionProjectFilesSaveInput
    ): Promise<AgentSavedFile[]> => {
      const validated = validateSessionProjectFilesSaveInput(input)
      return saveFilesToSessionProject(validated.sessionId, validated.files)
    }
  )
}
