import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { connectToBridgeOrThrow } from '../client/bridge-client'
import type { ParsedArgs } from '../args'
import { getBooleanFlag, getStringFlag } from '../args'
import { printJson } from '../format/json-output'

async function runPersonalityCommand(
  kind: 'soul' | 'user',
  args: ParsedArgs,
): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const response = await client.getPersonality(kind)

  if (asJson) {
    printJson(response)
    return 0
  }

  process.stdout.write(response.document.content)
  if (!response.document.content.endsWith('\n')) {
    process.stdout.write('\n')
  }
  return 0
}

async function readPersonalityInput(args: ParsedArgs): Promise<string> {
  const filePath = getStringFlag(args, 'file')
  const useStdin = getBooleanFlag(args, 'stdin')

  if (filePath && useStdin) {
    throw new Error('--file 和 --stdin 不能同时使用')
  }

  if (filePath) {
    return readFileSync(resolve(filePath), 'utf-8')
  }

  if (useStdin || !process.stdin.isTTY) {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks).toString('utf-8')
  }

  throw new Error('请提供 --file <path> 或 --stdin')
}

async function runSetPersonalityCommand(
  kind: 'soul' | 'user',
  args: ParsedArgs,
): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const content = await readPersonalityInput(args)
  const response = await client.updatePersonality(kind, content)

  if (asJson) {
    printJson(response)
    return 0
  }

  process.stdout.write(`[kila] updated ${kind === 'soul' ? 'SOUL.md' : 'USER.md'}\n`)
  return 0
}

export function runSoulCommand(args: ParsedArgs): Promise<number> {
  return runPersonalityCommand('soul', args)
}

export function runUserCommand(args: ParsedArgs): Promise<number> {
  return runPersonalityCommand('user', args)
}

export function runSoulSetCommand(args: ParsedArgs): Promise<number> {
  return runSetPersonalityCommand('soul', args)
}

export function runUserSetCommand(args: ParsedArgs): Promise<number> {
  return runSetPersonalityCommand('user', args)
}
