import { statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  SESSION_IPC_CHANNELS,
  type AgentRunOutcome,
  type CliRunCompleteReason,
  type CliRunRequest,
  type SessionStreamEvent,
} from '@kila/shared'
import { readJsonBody, sendError } from '../http'
import { closeSse, initSse, writeSseEvent } from '../sse'
import type { CliBridgeRouteContext } from '../types'
import { resolveCliRunSelection } from '../defaults'
import { createSession, getSessionMeta, updateSessionMeta } from '../../session-manager'
import { sendHeadlessSessionMessage } from '../../session-service'
import { toCliSessionSummary } from '../session-summary'
import { watchSessionProject } from '../../workspace-watcher'

function isExistingDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

export function mapRunOutcomeToCompleteReason(
  outcome: AgentRunOutcome | null,
  stopReason: string | undefined,
  streamError: string | null,
): CliRunCompleteReason {
  if (outcome === 'error') return 'error'
  if (outcome === 'stopped') return 'stopped'
  if (streamError) return 'error'
  if (outcome === 'success') return 'completed'
  if (!stopReason) return 'completed'

  const normalized = stopReason.trim().toLowerCase()
  if (normalized === 'abort' || normalized === 'aborted' || normalized === 'cancelled' || normalized === 'canceled') {
    return 'stopped'
  }

  return 'completed'
}

export async function handleCliBridgeRun(
  request: IncomingMessage,
  response: ServerResponse,
  context: CliBridgeRouteContext,
): Promise<void> {
  const body = await readJsonBody<CliRunRequest>(request)
  const message = body.message?.trim()

  if (!message) {
    sendError(response, 400, 'message 不能为空')
    return
  }

  if (body.sessionId && body.projectPath) {
    sendError(response, 400, '恢复已有 session 时不允许再传 projectPath')
    return
  }

  let session = body.sessionId ? getSessionMeta(body.sessionId) : undefined
  if (body.sessionId && !session) {
    sendError(response, 404, `Session 不存在: ${body.sessionId}`)
    return
  }

  if (!body.sessionId && body.projectPath && !isExistingDirectory(body.projectPath)) {
    sendError(response, 400, `projectPath 不是有效目录: ${body.projectPath}`)
    return
  }

  const selection = resolveCliRunSelection({
    session,
    channelId: body.channelId,
    modelId: body.modelId,
  })
  if (!selection.ok) {
    sendError(response, 400, selection.error)
    return
  }

  if (!session) {
    session = createSession({
      projectPath: body.projectPath,
      channelId: selection.channelId,
      modelId: selection.modelId,
    })
    watchSessionProject(session.id, session.project.path)
  }

  initSse(response)

  if (!body.sessionId) {
    context.broadcastSessionChannel(SESSION_IPC_CHANNELS.UPDATED, {
      sessionId: session.id,
      reason: 'created',
    })
    writeSseEvent(response, 'session_created', {
      session: toCliSessionSummary(session),
    })
  }

  let streamError: string | null = null
  let sessionErrorSent = false
  let stopReason: string | undefined
  let streamOutcome: AgentRunOutcome | null = null
  let sawSessionUpdated = false

  const sink = {
    send: (channel: string, payload: unknown) => {
      context.broadcastSessionChannel(channel, payload)

      switch (channel) {
        case SESSION_IPC_CHANNELS.STREAM_EVENT: {
          const event = payload as SessionStreamEvent
          if (event.type === 'agent_event' && event.event.type === 'complete') {
            stopReason = event.event.stopReason
          }
          writeSseEvent(response, 'session_stream', event)
          break
        }
        case SESSION_IPC_CHANNELS.STREAM_ERROR: {
          const event = payload as { sessionId: string; error: string }
          streamError = event.error
          writeSseEvent(response, 'session_error', event)
          sessionErrorSent = true
          break
        }
        case SESSION_IPC_CHANNELS.STREAM_COMPLETE: {
          const event = payload as { sessionId: string; outcome?: AgentRunOutcome }
          if (event.sessionId === session.id) streamOutcome = event.outcome ?? 'success'
          break
        }
        case SESSION_IPC_CHANNELS.TITLE_UPDATED: {
          writeSseEvent(response, 'title_updated', payload as { sessionId: string; title: string })
          break
        }
        case SESSION_IPC_CHANNELS.UPDATED: {
          sawSessionUpdated = true
          writeSseEvent(response, 'session_updated', payload as { sessionId: string; reason: 'created' | 'updated' | 'deleted' })
          break
        }
      }
    },
    isDestroyed: () => response.destroyed || response.writableEnded,
  }

  try {
    await sendHeadlessSessionMessage({
      sessionId: session.id,
      userMessage: message,
      channelId: selection.channelId,
      modelId: selection.modelId,
      permissionModeOverride: body.permissionModeOverride,
    }, sink)
  } catch (error) {
    streamError = error instanceof Error ? error.message : String(error)
    if (!sessionErrorSent) {
      writeSseEvent(response, 'session_error', {
        sessionId: session.id,
        error: streamError,
      })
      sessionErrorSent = true
    }
  } finally {
    const latestSession = getSessionMeta(session.id) ?? session

    if (!sawSessionUpdated) {
      const updatedSession = updateSessionMeta(latestSession.id, {})
      context.broadcastSessionChannel(SESSION_IPC_CHANNELS.UPDATED, {
        sessionId: updatedSession.id,
        reason: 'updated',
      })
      writeSseEvent(response, 'session_updated', {
        sessionId: updatedSession.id,
        reason: 'updated',
      })
    }

    writeSseEvent(response, 'session_complete', {
      sessionId: latestSession.id,
      reason: mapRunOutcomeToCompleteReason(streamOutcome, stopReason, streamError),
    })
    closeSse(response)
  }
}
