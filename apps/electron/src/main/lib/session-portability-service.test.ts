import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSession, getSessionMeta } from './session-manager'

mock.module('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
  BrowserWindow: Object.assign(class {}, { getFocusedWindow: () => null, fromWebContents: () => null }),
  shell: { openPath: () => {}, showItemInFolder: () => {}, openExternal: () => {} },
  nativeTheme: { shouldUseDarkColors: false },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: () => Buffer.from(''), decryptString: () => '' },
  ipcMain: { handle: () => {}, on: () => {} },
  session: { fromPartition: () => ({}) },
  clipboard: { writeText: () => {} },
}))

const originalConfigDir = process.env.KILA_CONFIG_DIR
const tempDirs: string[] = []

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.KILA_CONFIG_DIR
  else process.env.KILA_CONFIG_DIR = originalConfigDir
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function createContext(): string {
  const root = mkdtempSync(join(tmpdir(), 'kila-portability-test-'))
  tempDirs.push(root)
  process.env.KILA_CONFIG_DIR = join(root, 'config')
  return root
}

describe('Session 目标偏好导入导出', () => {
  test('Given 会话有自定义目标偏好，When 导出并导入，Then 模式和提示词完整保留', async () => {
    const { exportSessionBundle, importSessionBundle } = await import('./session-portability-service')
    const root = createContext()
    const source = createSession({
      projectPath: root,
      goalExecutionMode: 'incremental',
      goalEvaluationPrompt: '每个里程碑都运行测试',
    })
    const bundle = join(root, 'bundle')
    await exportSessionBundle({ sessionId: source.id, targetDir: bundle })

    const result = await importSessionBundle({ sourceDir: bundle })

    expect(result.sessionId).toBeDefined()
    expect(getSessionMeta(result.sessionId!)).toMatchObject({
      goalExecutionMode: 'incremental',
      goalEvaluationPrompt: '每个里程碑都运行测试',
    })
  })

  test('Given 旧版导出没有目标字段，When 导入，Then 默认自动模式且无自定义提示词', async () => {
    const { exportSessionBundle, importSessionBundle } = await import('./session-portability-service')
    const root = createContext()
    const source = createSession({ projectPath: root })
    const bundle = join(root, 'bundle')
    await exportSessionBundle({ sessionId: source.id, targetDir: bundle })
    const path = join(bundle, 'session.json')
    const exported = JSON.parse(readFileSync(path, 'utf8'))
    delete exported.goalExecutionMode
    delete exported.goalEvaluationPrompt
    writeFileSync(path, JSON.stringify(exported))

    const result = await importSessionBundle({ sourceDir: bundle })

    expect(getSessionMeta(result.sessionId!)?.goalExecutionMode).toBe('auto')
    expect(getSessionMeta(result.sessionId!)?.goalEvaluationPrompt).toBeUndefined()
  })
})
