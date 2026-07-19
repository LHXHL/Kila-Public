import { connectToBridge } from '../client/bridge-client'
import type { ParsedArgs } from '../args'
import { getBooleanFlag } from '../args'
import { printJson } from '../format/json-output'
import { getCliVersion } from '../package-version'

export async function runVersionCommand(args: ParsedArgs): Promise<number> {
  const cliVersion = getCliVersion()
  const asJson = getBooleanFlag(args, 'json')
  const client = await connectToBridge()
  const status = client ? await client.getStatus().catch(() => null) : null

  const payload = {
    cliVersion,
    appVersion: status?.appVersion ?? null,
  }

  if (asJson) {
    printJson(payload)
    return 0
  }

  process.stdout.write(`kila ${cliVersion}\n`)
  if (status?.appVersion) {
    process.stdout.write(`desktop ${status.appVersion}\n`)
  }
  return 0
}
