import { readFileSync } from 'node:fs'
import { connectToBridgeOrThrow } from '../client/bridge-client'
import type { ParsedArgs } from '../args'
import { getBooleanFlag, getStringFlag } from '../args'
import { printJson } from '../format/json-output'

export function parseConfigValue(raw: string, jsonMode: boolean): unknown {
  if (jsonMode) {
    return JSON.parse(raw)
  }

  const trimmed = raw.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  if (trimmed && /^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed)
  }

  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return raw
    }
  }

  return raw
}

export async function runConfigListCommand(args: ParsedArgs): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const response = await client.listConfig()
  printJson(response)
  return 0
}

export async function runConfigGetCommand(args: ParsedArgs): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const path = args.positionals[0]
  if (!path) {
    throw new Error('缺少 config path')
  }

  const response = await client.getConfig(path)
  if (asJson) {
    printJson(response)
    return 0
  }

  if (!response.exists) {
    process.stdout.write('(missing)\n')
    return 0
  }

  if (typeof response.value === 'string') {
    process.stdout.write(`${response.value}\n`)
    return 0
  }

  printJson(response.value)
  return 0
}

export async function runConfigSetCommand(args: ParsedArgs): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const jsonValue = getBooleanFlag(args, 'json-value')
  const path = args.positionals[0]
  if (!path) {
    throw new Error('缺少 config path')
  }

  const filePath = getStringFlag(args, 'file')
  const rawValue = filePath
    ? readFileSync(filePath, 'utf-8')
    : args.positionals.slice(1).join(' ')
  if (!rawValue.trim()) {
    throw new Error('缺少 config value')
  }

  const response = await client.setConfig(path, parseConfigValue(rawValue, jsonValue) as never)
  if (asJson) {
    printJson(response)
    return 0
  }

  process.stdout.write(`[kila] config updated: ${response.path}\n`)
  return 0
}
