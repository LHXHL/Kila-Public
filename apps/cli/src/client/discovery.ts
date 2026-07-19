import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { CliBridgeDiscovery } from '@kila/shared'

const CONFIG_DIR_NAME = '.kila'

export function getCliConfigDir(): string {
  const overriddenDir = process.env.KILA_CONFIG_DIR?.trim()
  if (!overriddenDir) {
    return join(homedir(), CONFIG_DIR_NAME)
  }

  return isAbsolute(overriddenDir)
    ? overriddenDir
    : resolve(overriddenDir)
}

export function getCliBridgeDiscoveryPath(): string {
  return join(getCliConfigDir(), 'cli-bridge.json')
}

export function readCliBridgeDiscovery(): CliBridgeDiscovery | null {
  const discoveryPath = getCliBridgeDiscoveryPath()
  if (!existsSync(discoveryPath)) {
    return null
  }

  try {
    return JSON.parse(readFileSync(discoveryPath, 'utf-8')) as CliBridgeDiscovery
  } catch {
    return null
  }
}
