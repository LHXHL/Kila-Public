import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getCliConfigDir } from './discovery'

interface CliState {
  version: 1
  lastSessionId?: string
}

const CLI_STATE_VERSION = 1

export function getCliStatePath(): string {
  return join(getCliConfigDir(), 'cli-state.json')
}

function readCliState(): CliState {
  const statePath = getCliStatePath()
  if (!existsSync(statePath)) {
    return { version: CLI_STATE_VERSION }
  }

  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf-8')) as Partial<CliState>
    return {
      version: CLI_STATE_VERSION,
      lastSessionId: typeof parsed.lastSessionId === 'string' && parsed.lastSessionId.trim()
        ? parsed.lastSessionId
        : undefined,
    }
  } catch {
    return { version: CLI_STATE_VERSION }
  }
}

function writeCliState(state: CliState): void {
  mkdirSync(getCliConfigDir(), { recursive: true })
  writeFileSync(getCliStatePath(), JSON.stringify(state, null, 2), 'utf-8')
}

export function getLastTouchedSessionId(): string | null {
  return readCliState().lastSessionId ?? null
}

export function rememberLastTouchedSessionId(sessionId: string): void {
  const trimmed = sessionId.trim()
  if (!trimmed) return

  writeCliState({
    version: CLI_STATE_VERSION,
    lastSessionId: trimmed,
  })
}
