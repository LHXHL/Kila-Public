import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  parseProviderDbText,
  updateProviderDbSnapshot,
  verifyProviderDbSnapshot,
} from './fetch-provider-db'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createTempFile(): string {
  const directory = mkdtempSync(join(tmpdir(), 'kila-provider-db-'))
  tempDirectories.push(directory)
  return join(directory, 'providers.json')
}

function validDatabase(modelId = 'model-a'): string {
  return JSON.stringify({
    version: 1,
    providers: {
      custom: {
        id: 'custom',
        name: 'Custom',
        models: [{ id: modelId, name: modelId }],
      },
    },
  })
}

describe('Provider DB snapshot', () => {
  test('Given 仓库内有效 snapshot, When 普通构建校验, Then 不修改文件并返回统计', () => {
    const outFile = createTempFile()
    const content = validDatabase()
    writeFileSync(outFile, content)

    expect(verifyProviderDbSnapshot(outFile)).toMatchObject({
      providerCount: 1,
      modelCount: 1,
    })
    expect(readFileSync(outFile, 'utf8')).toBe(content)
  })

  test('Given 上游返回无效 JSON, When 显式更新, Then 旧 snapshot 保持不变并报告失败', async () => {
    const outFile = createTempFile()
    const previous = validDatabase('stable-model')
    writeFileSync(outFile, previous)

    await expect(updateProviderDbSnapshot({
      outFile,
      sourceLabel: 'invalid-test-source',
      readSource: async () => '{invalid',
    })).rejects.toThrow('JSON 解析失败')
    expect(readFileSync(outFile, 'utf8')).toBe(previous)
  })

  test('Given 有效的新上游数据, When 显式更新, Then 原子替换并可再次校验', async () => {
    const outFile = createTempFile()
    writeFileSync(outFile, validDatabase('old-model'))

    const stats = await updateProviderDbSnapshot({
      outFile,
      sourceLabel: 'valid-test-source',
      readSource: async () => validDatabase('new-model'),
    })

    expect(stats).toMatchObject({ providerCount: 1, modelCount: 1 })
    expect(readFileSync(outFile, 'utf8')).toContain('new-model')
    expect(verifyProviderDbSnapshot(outFile)).toEqual(stats)
  })

  test('Given 超出大小上限的内容, When 解析, Then 在 JSON 解析前拒绝', () => {
    const oversized = '你'.repeat(4 * 1024 * 1024)
    expect(() => parseProviderDbText(oversized)).toThrow('内容过大')
  })
})
