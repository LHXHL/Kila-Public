import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadExternalEsm, resolveExternalEsmModule } from './external-esm-loader'

const originalExternalModulesDir = process.env.KILA_EXTERNAL_MODULES_DIR
const tempDirs: string[] = []

afterEach(() => {
  if (originalExternalModulesDir === undefined) {
    delete process.env.KILA_EXTERNAL_MODULES_DIR
  } else {
    process.env.KILA_EXTERNAL_MODULES_DIR = originalExternalModulesDir
  }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('external ESM loader', () => {
  test('Given 包仅声明 import condition，When 从 external modules 加载，Then 解析根入口和子路径并执行 ESM', async () => {
    // 使用独立夹具模拟打包目录，不依赖本地预先生成 dist/ext-modules。
    const modulesDir = mkdtempSync(join(tmpdir(), 'kila-external-esm-test-'))
    tempDirs.push(modulesDir)
    process.env.KILA_EXTERNAL_MODULES_DIR = modulesDir
    const packageDir = join(modulesDir, '@kila-test', 'esm-only')
    mkdirSync(join(packageDir, 'dist'), { recursive: true })
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
      type: 'module',
      exports: {
        '.': { import: './dist/index.js' },
        './compat': { import: './dist/compat.js' },
      },
    }))
    writeFileSync(join(packageDir, 'dist/index.js'), 'export const loaded = true')
    writeFileSync(join(packageDir, 'dist/compat.js'), 'export const compatible = true')

    expect(resolveExternalEsmModule('@kila-test/esm-only')).toBe(join(packageDir, 'dist/index.js'))
    expect(resolveExternalEsmModule('@kila-test/esm-only/compat')).toBe(join(packageDir, 'dist/compat.js'))
    expect(await loadExternalEsm<{ loaded: boolean }>('@kila-test/esm-only')).toEqual({ loaded: true })
    expect(await loadExternalEsm<{ compatible: boolean }>('@kila-test/esm-only/compat')).toEqual({ compatible: true })
  })

  test('Given 已安装 Pi SDK，When 原生动态加载，Then canonical Session API 可用', async () => {
    const codingAgent = await loadExternalEsm<typeof import('@earendil-works/pi-coding-agent')>(
      '@earendil-works/pi-coding-agent',
    )
    expect(typeof codingAgent.createAgentSession).toBe('function')
    expect(typeof codingAgent.ModelRuntime.create).toBe('function')
  })
})
