import type { ServerResponse } from 'node:http'
import { CLI_BRIDGE_VERSION } from '@kila/shared'
import { sendJson } from '../http'

export function handleCliBridgeHealth(
  response: ServerResponse,
  appVersion: string,
): void {
  sendJson(response, 200, {
    ok: true,
    pid: process.pid,
    appVersion,
    bridgeVersion: CLI_BRIDGE_VERSION,
  })
}
