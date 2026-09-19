import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const mainRoot = resolve(import.meta.dir, '../..')
const utilityEntry = resolve(import.meta.dir, '../../../utility/pi-runtime.ts')
const utilityAdapter = resolve(import.meta.dir, '../../../utility/pi-agent-adapter.ts')
const legacyAdapter = resolve(import.meta.dir, '../adapters/pi-agent-adapter.ts')
const PI_PACKAGE_PATTERN = /@earendil-works\/(?:pi-agent-core|pi-ai|pi-coding-agent)/
const LEGACY_ADAPTER_PATTERN = /adapters\/pi-agent-adapter/

describe('Pi Runtime 主进程边界', () => {
  test('Given 主进程生产源码 When 扫描 Pi 包引用 Then 只允许 import type', () => {
    const violations: string[] = []
    for (const filePath of collectTypeScriptFiles(mainRoot)) {
      if (filePath.endsWith('.test.ts') || filePath.endsWith('.test.tsx')) continue
      const lines = readFileSync(filePath, 'utf8').split('\n')
      for (let index = 0; index < lines.length; index += 1) {
        if (!lines[index]!.trimStart().startsWith('import ')) continue
        let statement = lines[index]!
        while (!statement.includes(' from ') && index + 1 < lines.length) {
          index += 1
          statement += lines[index]!
        }
        if (
          (PI_PACKAGE_PATTERN.test(statement) && !/^\s*import\s+type\b/.test(statement))
          || LEGACY_ADAPTER_PATTERN.test(statement)
        ) {
          violations.push(`${filePath}:${index + 1}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  test('Given Electron Utility Process 入口 When 读取父进程端口 Then 使用 process.parentPort', () => {
    const source = readFileSync(utilityEntry, 'utf8')

    expect(source).toContain('const runtimePort = process.parentPort')
    expect(source).not.toContain("import { parentPort } from 'electron'")
  })

  test('Given Pi Agent 实现 When 检查源码归属 Then 只位于 Utility 目录而非主进程 adapters', () => {
    expect(statSync(utilityAdapter).isFile()).toBe(true)
    expect(() => statSync(legacyAdapter)).toThrow()
  })
})

function collectTypeScriptFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory)) {
    const filePath = join(directory, entry)
    if (statSync(filePath).isDirectory()) files.push(...collectTypeScriptFiles(filePath))
    else if (/\.(?:ts|tsx)$/.test(entry)) files.push(filePath)
  }
  return files
}
