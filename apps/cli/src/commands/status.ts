import { connectToBridge, inspectBridgeConnection } from '../client/bridge-client'
import type { ParsedArgs } from '../args'
import { getBooleanFlag } from '../args'
import { printHint } from '../format/hints'
import { printJson } from '../format/json-output'

export async function runStatusCommand(args: ParsedArgs): Promise<number> {
  const asJson = getBooleanFlag(args, 'json')
  const inspection = await inspectBridgeConnection()
  const client = await connectToBridge()

  if (!client) {
    const payload = {
      connected: false,
      discoveryPath: inspection.discoveryPath,
      discoveryFound: Boolean(inspection.discovery),
      staleDiscovery: inspection.staleDiscovery,
    }

    if (asJson) {
      printJson(payload)
      return 0
    }

    process.stdout.write('Bridge: disconnected\n')
    process.stdout.write(`Discovery: ${inspection.discoveryPath}\n`)
    if (inspection.staleDiscovery) {
      process.stdout.write('State: stale discovery file\n')
    }
    printHint('启动 Kila Desktop 后运行 `kila doctor` 检查默认 channel/model')
    return 0
  }

  const status = await client.getStatus()
  const payload = {
    connected: true,
    discoveryPath: inspection.discoveryPath,
    staleDiscovery: false,
    ...status,
  }

  if (asJson) {
    printJson(payload)
    return 0
  }

  process.stdout.write('Bridge: connected\n')
  process.stdout.write(`App version: ${status.appVersion}\n`)
  process.stdout.write(`Bridge version: ${status.bridgeVersion}\n`)
  process.stdout.write(`PID: ${status.pid}\n`)
  process.stdout.write(`Default channel: ${status.defaults.channelId ?? '(unset)'}${status.defaults.channelName ? ` (${status.defaults.channelName})` : ''}\n`)
  process.stdout.write(`Default model: ${status.defaults.modelId ?? '(unset)'}\n`)
  if (!status.defaults.channelId || !status.defaults.modelId) {
    printHint('运行 `kila doctor` 或 `kila channels` 补全默认 channel/model')
  }
  return 0
}
