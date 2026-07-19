import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CliPermissionResponseRequest } from '@kila/shared'
import { readJsonBody, sendError, sendJson } from '../http'
import { permissionService } from '../../agent-permission-service'

export async function handleCliBridgePermissionResponse(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJsonBody<CliPermissionResponseRequest>(request)
  if (!body.requestId) {
    sendError(response, 400, '缺少 requestId')
    return
  }

  const resolution = permissionService.respondToPermission(
    body.requestId,
    body.behavior,
    body.alwaysAllow,
  )

  if (!resolution) {
    sendError(response, 404, `Permission request 不存在: ${body.requestId}`)
    return
  }

  sendJson(response, 200, resolution)
}
