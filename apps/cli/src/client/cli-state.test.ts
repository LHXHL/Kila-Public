import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getLastTouchedSessionId,
  rememberLastTouchedSessionId,
} from './cli-state'

const originalConfigDir = process.env.KILA_CONFIG_DIR

afterEach(() => {
  if (originalConfigDir === undefined) {
    delete process.env.KILA_CONFIG_DIR
  } else {
    process.env.KILA_CONFIG_DIR = originalConfigDir
  }
})

describe('cli state', () => {
  test('stores and reads the last touched session id', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'kila-cli-state-'))
    process.env.KILA_CONFIG_DIR = configDir

    expect(getLastTouchedSessionId()).toBeNull()

    rememberLastTouchedSessionId('session-123')
    expect(getLastTouchedSessionId()).toBe('session-123')

    rmSync(configDir, { recursive: true, force: true })
  })
})
