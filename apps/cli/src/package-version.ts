import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = dirname(fileURLToPath(import.meta.url))

export function getCliVersion(): string {
  const packageJsonPath = resolve(currentDir, '..', 'package.json')
  const raw = readFileSync(packageJsonPath, 'utf-8')
  const parsed = JSON.parse(raw) as { version?: string }
  return parsed.version ?? '0.0.0'
}
