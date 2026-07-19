import { afterEach, describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { loadExternalEsm, resolveExternalEsmModule } from './external-esm-loader'

const originalExternalModulesDir = process.env.KILA_EXTERNAL_MODULES_DIR

afterEach(() => {
  if (originalExternalModulesDir === undefined) {
    delete process.env.KILA_EXTERNAL_MODULES_DIR
  } else {
    process.env.KILA_EXTERNAL_MODULES_DIR = originalExternalModulesDir
  }
})

describe('external ESM loader', () => {
  test('Given Pi 仅声明 import condition，When 从 external modules 解析，Then 返回实际 ESM 入口', async () => {
    process.env.KILA_EXTERNAL_MODULES_DIR = resolve(import.meta.dir, '../../../dist/ext-modules/node_modules')

    const rootEntry = resolveExternalEsmModule('@earendil-works/pi-agent-core')
    const compatEntry = resolveExternalEsmModule('@earendil-works/pi-ai/compat')

    expect(rootEntry.endsWith('/@earendil-works/pi-agent-core/dist/index.js')).toBe(true)
    expect(compatEntry.endsWith('/@earendil-works/pi-ai/dist/compat.js')).toBe(true)

    const codingAgent = await loadExternalEsm<typeof import('@earendil-works/pi-coding-agent')>(
      '@earendil-works/pi-coding-agent',
    )
    expect(typeof codingAgent.createAgentSession).toBe('function')
    expect(typeof codingAgent.ModelRuntime.create).toBe('function')
  })
})
