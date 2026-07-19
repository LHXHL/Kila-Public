import { createInterface } from 'node:readline/promises'
import type { CliPermissionResponseRequest, PermissionRequest } from '@kila/shared'

async function ask(prompt: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  })

  try {
    return (await rl.question(prompt)).trim()
  } finally {
    rl.close()
  }
}

export async function promptForPermission(
  request: PermissionRequest,
): Promise<CliPermissionResponseRequest> {
  process.stderr.write(`\n[permission] ${request.toolName} (${request.dangerLevel})\n`)
  process.stderr.write(`${request.description}\n`)
  if (request.command) {
    process.stderr.write(`command: ${request.command}\n`)
  }
  if (request.decisionReason) {
    process.stderr.write(`reason: ${request.decisionReason}\n`)
  }

  while (true) {
    const answer = (await ask('Choose: [a]llow once / [d]eny / allow [A]lways: ')).toLowerCase()
    if (answer === 'a' || answer === 'allow') {
      return { requestId: request.requestId, behavior: 'allow', alwaysAllow: false }
    }
    if (answer === 'd' || answer === 'deny') {
      return { requestId: request.requestId, behavior: 'deny', alwaysAllow: false }
    }
    if (answer === 'aa' || answer === 'always') {
      return { requestId: request.requestId, behavior: 'allow', alwaysAllow: true }
    }
  }
}
