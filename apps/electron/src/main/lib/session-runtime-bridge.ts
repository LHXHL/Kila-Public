import { AGENT_IPC_CHANNELS, SESSION_IPC_CHANNELS } from '@kila/shared'
import type { WebContents } from 'electron'
import { emitSessionRuntimeStream } from './session-runtime-observers'

export function sendUnifiedSessionError(
  webContents: WebContents,
  sessionId: string,
  error: string,
): void {
  webContents.send(SESSION_IPC_CHANNELS.STREAM_ERROR, {
    sessionId,
    error,
  })
}

export function createSessionRuntimeBridge(webContents: WebContents): WebContents {
  return {
    send: (channel: string, payload: unknown) => {
      if (webContents.isDestroyed()) return

      webContents.send(channel, payload)
      emitSessionRuntimeStream(channel, payload)

      switch (channel) {
        case AGENT_IPC_CHANNELS.STREAM_EVENT: {
          const event = payload as { sessionId: string; event: unknown }
          webContents.send(SESSION_IPC_CHANNELS.STREAM_EVENT, {
            type: 'agent_event',
            sessionId: event.sessionId,
            event: event.event,
          })
          return
        }
        case AGENT_IPC_CHANNELS.STREAM_COMPLETE: {
          const event = payload as { sessionId: string; outcome?: 'success' | 'stopped' | 'error' }
          webContents.send(SESSION_IPC_CHANNELS.STREAM_COMPLETE, {
            sessionId: event.sessionId,
            outcome: event.outcome,
          })
          webContents.send(SESSION_IPC_CHANNELS.UPDATED, {
            sessionId: event.sessionId,
            reason: 'updated',
          })
          return
        }
        case AGENT_IPC_CHANNELS.STREAM_ERROR: {
          const event = payload as { sessionId: string; error: string }
          sendUnifiedSessionError(webContents, event.sessionId, event.error)
          webContents.send(SESSION_IPC_CHANNELS.UPDATED, {
            sessionId: event.sessionId,
            reason: 'updated',
          })
          return
        }
        case AGENT_IPC_CHANNELS.TITLE_UPDATED: {
          const event = payload as { sessionId: string; title: string }
          webContents.send(SESSION_IPC_CHANNELS.TITLE_UPDATED, {
            sessionId: event.sessionId,
            title: event.title,
          })
          webContents.send(SESSION_IPC_CHANNELS.UPDATED, {
            sessionId: event.sessionId,
            reason: 'updated',
          })
          return
        }
      }
    },
    isDestroyed: () => webContents.isDestroyed(),
  } as WebContents
}

