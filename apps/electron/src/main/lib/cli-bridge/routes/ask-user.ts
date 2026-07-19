import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CliAskUserResponseRequest } from '@kila/shared'
import { readJsonBody, sendError, sendJson } from '../http'
import { askUserService } from '../../agent-ask-user-service'

export async function handleCliBridgeAskUserResponse(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJsonBody<CliAskUserResponseRequest>(request)
  if (!body.requestId) {
    sendError(response, 400, '缺少 requestId')
    return
  }

  const sessionId = askUserService.respondToAskUser(body.requestId, body.answers)
  if (!sessionId) {
    sendError(response, 404, `AskUser request 不存在: ${body.requestId}`)
    return
  }

  sendJson(response, 200, { ok: true, sessionId, requestId: body.requestId })
}
