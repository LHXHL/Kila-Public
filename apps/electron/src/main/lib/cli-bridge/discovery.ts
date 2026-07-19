import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import type { CliBridgeDiscovery } from '@kila/shared'
import { getCliBridgeDiscoveryPath } from '../config-paths'

export function getCliBridgeDiscoveryPathname(): string {
  return getCliBridgeDiscoveryPath()
}

export function writeCliBridgeDiscovery(discovery: CliBridgeDiscovery): void {
  const discoveryPath = getCliBridgeDiscoveryPathname()
  writeFileSync(discoveryPath, JSON.stringify(discovery, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  })

  try {
    chmodSync(discoveryPath, 0o600)
  } catch {
    // ignore chmod failures on unsupported platforms
  }
}

export function removeCliBridgeDiscovery(): void {
  const discoveryPath = getCliBridgeDiscoveryPathname()
  if (!existsSync(discoveryPath)) return

  try {
    unlinkSync(discoveryPath)
  } catch {
    // ignore cleanup failure during shutdown
  }
}

export function readCliBridgeDiscovery(): CliBridgeDiscovery | null {
  const discoveryPath = getCliBridgeDiscoveryPathname()
  if (!existsSync(discoveryPath)) return null

  try {
    return JSON.parse(readFileSync(discoveryPath, 'utf-8')) as CliBridgeDiscovery
  } catch {
    return null
  }
}
