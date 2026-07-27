/**
 * analyze_image 路径边界回归测试
 *
 * image_path 完全由模型决定。原实现用 allowAbsolute 解析后直接 readFileSync，
 * 且扩展名未知时一律当作 image/png —— 模型可以把任意本地文件读成 base64
 * 发给第三方视觉 API。
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

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

/** 1x1 PNG */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

let sandboxDir = ''
let configDir = ''
let projectDir = ''
let previousConfigDir: string | undefined

beforeEach(() => {
  previousConfigDir = process.env.KILA_CONFIG_DIR
  sandboxDir = mkdtempSync(join(tmpdir(), 'kila-vision-'))
  configDir = join(sandboxDir, 'config')
  projectDir = join(sandboxDir, 'project')
  mkdirSync(configDir, { recursive: true })
  mkdirSync(projectDir, { recursive: true })
  process.env.KILA_CONFIG_DIR = configDir
})

afterEach(() => {
  if (previousConfigDir === undefined) delete process.env.KILA_CONFIG_DIR
  else process.env.KILA_CONFIG_DIR = previousConfigDir
  rmSync(sandboxDir, { recursive: true, force: true })
})

describe('analyze_image 路径限制', () => {
  test('Given 附件目录与项目目录之外的绝对路径，When 解析图片路径，Then 拒绝', async () => {
    const { resolveVisionImagePath } = await import('./vision-tool')

    const outside = join(sandboxDir, 'id_rsa.png')
    writeFileSync(outside, PNG_BYTES)

    expect(() => resolveVisionImagePath(outside, [projectDir]))
      .toThrow('图片路径超出当前会话的附件目录与项目目录范围')
  })

  test('Given 用 ../ 跳出项目目录的相对路径，When 解析图片路径，Then 拒绝', async () => {
    const { resolveVisionImagePath } = await import('./vision-tool')

    writeFileSync(join(sandboxDir, 'secret.png'), PNG_BYTES)

    expect(() => resolveVisionImagePath('../secret.png', [projectDir]))
      .toThrow('图片路径超出当前会话的附件目录与项目目录范围')
  })

  test('Given 项目内指向项目外的符号链接，When 解析图片路径，Then 拒绝', async () => {
    const { resolveVisionImagePath } = await import('./vision-tool')

    const outside = join(sandboxDir, 'outside.png')
    writeFileSync(outside, PNG_BYTES)
    symlinkSync(outside, join(projectDir, 'shot.png'))

    expect(() => resolveVisionImagePath('shot.png', [projectDir]))
      .toThrow('图片路径超出当前会话的附件目录与项目目录范围')
  })

  test('Given 项目目录内的图片，When 解析图片路径，Then 放行', async () => {
    const { resolveVisionImagePath } = await import('./vision-tool')

    const inside = join(projectDir, 'screenshot.png')
    writeFileSync(inside, PNG_BYTES)

    expect(resolveVisionImagePath('screenshot.png', [projectDir])).toBe(inside)
    expect(resolveVisionImagePath(inside, [projectDir])).toBe(inside)
  })

  test('Given 会话附件的 localPath，When 解析图片路径，Then 在附件目录内放行', async () => {
    const { resolveVisionImagePath, resolveVisionAllowedRoots } = await import('./vision-tool')
    const { getConversationAttachmentsDir } = await import('../config-paths')

    const attachmentDir = getConversationAttachmentsDir('session-a')
    writeFileSync(join(attachmentDir, 'shot.png'), PNG_BYTES)

    const roots = resolveVisionAllowedRoots('session-a')
    expect(resolveVisionImagePath('session-a/shot.png', roots)).toBe(join(attachmentDir, 'shot.png'))
  })

  test('Given 其它会话的附件路径，When 解析图片路径，Then 拒绝跨会话读取', async () => {
    const { resolveVisionImagePath, resolveVisionAllowedRoots } = await import('./vision-tool')
    const { getConversationAttachmentsDir } = await import('../config-paths')

    const otherDir = getConversationAttachmentsDir('session-b')
    writeFileSync(join(otherDir, 'private.png'), PNG_BYTES)

    const roots = resolveVisionAllowedRoots('session-a')
    expect(() => resolveVisionImagePath('session-b/private.png', roots))
      .toThrow('图片路径超出当前会话的附件目录与项目目录范围')
  })

  test('Given 空路径或含 NUL 的路径，When 解析图片路径，Then 拒绝', async () => {
    const { resolveVisionImagePath } = await import('./vision-tool')

    expect(() => resolveVisionImagePath('', [projectDir])).toThrow('图片路径无效')
    expect(() => resolveVisionImagePath('a\0b.png', [projectDir])).toThrow('图片路径无效')
  })
})

describe('analyze_image 图片类型判定', () => {
  test('Given 扩展名无法判定图片类型，When 读取图片，Then 拒绝而不是默认 image/png', async () => {
    const { readImageAsBase64 } = await import('./vision-tool')

    // 私钥伪装成项目内的「图片」
    writeFileSync(join(projectDir, 'id_rsa'), 'PRIVATE-KEY', 'utf-8')
    expect(() => readImageAsBase64('id_rsa', [projectDir])).toThrow('无法确定图片类型')

    writeFileSync(join(projectDir, 'notes.svg'), '<svg/>', 'utf-8')
    expect(() => readImageAsBase64('notes.svg', [projectDir])).toThrow('无法确定图片类型')
  })

  test('Given 受支持的图片扩展名，When 读取图片，Then 返回正确的 mimeType', async () => {
    const { readImageAsBase64 } = await import('./vision-tool')

    writeFileSync(join(projectDir, 'shot.png'), PNG_BYTES)
    const result = readImageAsBase64('shot.png', [projectDir])

    expect(result.mimeType).toBe('image/png')
    expect(result.data).toBe(PNG_BYTES.toString('base64'))
  })
})
