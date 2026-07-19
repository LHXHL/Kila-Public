import type { ServerResponse } from 'node:http'
import { sendError, sendJson } from '../http'
import { getSessionMeta } from '../../session-manager'
import { stopSession } from '../../session-service'

export function handleCliBridgeStop(
  response: ServerResponse,
  sessionId: string,
): void {
  if (!getSessionMeta(sessionId)) {
    sendError(response, 404, `Session 不存在: ${sessionId}`)
    return
  }

  stopSession(sessionId)
  sendJson(response, 200, { ok: true, sessionId })
}
