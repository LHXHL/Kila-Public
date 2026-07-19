import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CliBridgeConfigListResponse, CliBridgeConfigSetRequest, CliBridgeConfigValueResponse, CliConfigValue } from '@kila/shared'
import { getSettings, updateSettings } from '../../settings-service'
import { readJsonBody, sendError, sendJson } from '../http'

type JsonRecord = Record<string, CliConfigValue>

function isJsonRecord(value: CliConfigValue | undefined): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function splitPath(path: string): string[] {
  return path.split('.').map((segment) => segment.trim()).filter(Boolean)
}

function getValueAtPath(root: CliConfigValue, path: string): { exists: boolean; value?: CliConfigValue } {
  const segments = splitPath(path)
  if (segments.length === 0) {
    return { exists: true, value: root }
  }

  let current: CliConfigValue | undefined = root
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { exists: false }
      }
      current = current[index]
      continue
    }

    if (!isJsonRecord(current) || !(segment in current)) {
      return { exists: false }
    }
    current = current[segment]
  }

  return { exists: true, value: current }
}

function setValueAtPath(root: CliConfigValue, path: string, value: CliConfigValue): CliConfigValue {
  const segments = splitPath(path)
  if (segments.length === 0) {
    return value
  }

  const nextRoot: JsonRecord = isJsonRecord(root) ? { ...root } : {}
  let current: JsonRecord = nextRoot

  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index]!
    const existing = current[key]
    current[key] = isJsonRecord(existing) ? { ...existing } : {}
    current = current[key] as JsonRecord
  }

  current[segments[segments.length - 1]!] = value
  return nextRoot
}

export function handleCliBridgeConfigList(response: ServerResponse): void {
  const payload: CliBridgeConfigListResponse = {
    config: getSettings() as unknown as CliConfigValue,
  }
  sendJson(response, 200, payload)
}

export function handleCliBridgeConfigGet(
  response: ServerResponse,
  path: string,
): void {
  const result = getValueAtPath(getSettings() as unknown as CliConfigValue, path)
  const payload: CliBridgeConfigValueResponse = {
    path,
    exists: result.exists,
    ...(result.exists ? { value: result.value } : {}),
  }
  sendJson(response, 200, payload)
}

export async function handleCliBridgeConfigSet(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJsonBody<CliBridgeConfigSetRequest>(request)
  if (!body.path?.trim()) {
    sendError(response, 400, 'config path 不能为空')
    return
  }

  const current = getSettings() as unknown as CliConfigValue
  const updated = setValueAtPath(current, body.path, body.value)
  const nextSettings = updated

  if (!isJsonRecord(nextSettings)) {
    sendError(response, 400, 'settings 根节点必须是 object')
    return
  }

  const saved = updateSettings(nextSettings as Record<string, unknown>)
  const result = getValueAtPath(saved as unknown as CliConfigValue, body.path)
  sendJson(response, 200, {
    path: body.path,
    exists: result.exists,
    ...(result.exists ? { value: result.value } : {}),
  } satisfies CliBridgeConfigValueResponse)
}
