import type { ServerResponse } from 'node:http'
import { sendJson } from '../http'
import { buildCliBridgeStatusResponse } from '../defaults'

export function handleCliBridgeStatus(
  response: ServerResponse,
  appVersion: string,
): void {
  sendJson(response, 200, buildCliBridgeStatusResponse(appVersion))
}
