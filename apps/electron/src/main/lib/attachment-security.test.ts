/**
 * 附件域路径安全回归测试
 *
 * 附件曾是唯一脱离 assertAgentFileAccess 白名单的文件 IPC：
 * - readAttachment / deleteAttachment 用 allowAbsolute 接受任意绝对路径
 * - saveAttachment 把未净化的 conversationId 直接 join 后 mkdirSync
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

let sandboxDir = ''
let configDir = ''
let outsideFile = ''
let previousConfigDir: string | undefined

beforeEach(() => {
  previousConfigDir = process.env.KILA_CONFIG_DIR
  sandboxDir = mkdtempSync(join(tmpdir(), 'kila-attachment-sec-'))
  configDir = join(sandboxDir, 'config')
  mkdirSync(configDir, { recursive: true })
  process.env.KILA_CONFIG_DIR = configDir

  // 模拟「附件目录之外的敏感文件」
  outsideFile = join(sandboxDir, 'id_rsa')
  writeFileSync(outsideFile, 'PRIVATE-KEY', 'utf-8')
})

afterEach(() => {
  if (previousConfigDir === undefined) delete process.env.KILA_CONFIG_DIR
  else process.env.KILA_CONFIG_DIR = previousConfigDir
  rmSync(sandboxDir, { recursive: true, force: true })
})

describe('附件读取路径边界', () => {
  test('Given Renderer 传入绝对路径，When 未注入白名单校验器，Then 拒绝读取任意本地文件', async () => {
    const { readAttachmentAsBase64 } = await import('./attachment-service')

    expect(() => readAttachmentAsBase64(outsideFile)).toThrow('附件路径必须是相对路径')
  })

  test('Given 越界相对路径，When 读取附件，Then 抛出附件路径越界', async () => {
    const { readAttachmentAsBase64 } = await import('./attachment-service')

    expect(() => readAttachmentAsBase64('../../../../etc/passwd')).toThrow('附件路径越界')
    expect(() => readAttachmentAsBase64('session/../../../etc/passwd')).toThrow('附件路径越界')
  })

  test('Given 合法的 {sessionId}/{uuid} 相对路径，When 读取附件，Then 正常返回 base64', async () => {
    const { saveAttachment, readAttachmentAsBase64 } = await import('./attachment-service')

    const { attachment } = saveAttachment({
      conversationId: 'session-a',
      filename: 'note.txt',
      mediaType: 'text/plain',
      data: Buffer.from('hello', 'utf-8').toString('base64'),
    })

    expect(Buffer.from(readAttachmentAsBase64(attachment.localPath), 'base64').toString('utf-8')).toBe('hello')
  })

  test('Given 存量绝对路径附件，When IPC 层注入白名单校验器，Then 由白名单决定放行或拒绝', async () => {
    const { readAttachmentAsBase64 } = await import('./attachment-service')

    // 白名单放行：返回内容
    const allow = readAttachmentAsBase64(outsideFile, { assertAbsoluteAccess: (p) => p })
    expect(Buffer.from(allow, 'base64').toString('utf-8')).toBe('PRIVATE-KEY')

    // 白名单拒绝：抛出与其它文件 IPC 一致的错误
    expect(() =>
      readAttachmentAsBase64(outsideFile, {
        assertAbsoluteAccess: () => {
          throw new Error('访问路径超出 Agent 工作区范围')
        },
      }),
    ).toThrow('访问路径超出 Agent 工作区范围')
  })
})

describe('附件删除路径边界', () => {
  test('Given 绝对路径，When 删除附件，Then 拒绝且目标文件仍然存在', async () => {
    const { deleteAttachment } = await import('./attachment-service')

    expect(() => deleteAttachment(outsideFile)).toThrow('附件路径必须是相对路径')
    expect(existsSync(outsideFile)).toBe(true)
  })

  test('Given 含 ../ 的 conversationId，When 删除会话附件，Then 不会递归删除外部目录', async () => {
    const { deleteConversationAttachments } = await import('./attachment-service')

    const victimDir = join(sandboxDir, 'victim')
    mkdirSync(victimDir, { recursive: true })
    writeFileSync(join(victimDir, 'keep.txt'), 'keep', 'utf-8')

    deleteConversationAttachments('../../victim')

    expect(existsSync(join(victimDir, 'keep.txt'))).toBe(true)
  })
})

describe('附件保存目录净化', () => {
  test('Given 含 ../ 的 conversationId，When 保存附件，Then 文件仍落在附件目录内', async () => {
    const { saveAttachment } = await import('./attachment-service')
    const { getAttachmentsDir } = await import('./config-paths')

    const { attachment } = saveAttachment({
      conversationId: '../../../tmp/x',
      filename: 'evil.txt',
      mediaType: 'text/plain',
      data: Buffer.from('payload', 'utf-8').toString('base64'),
    })

    // localPath 与磁盘目录都必须是净化后的单层片段
    expect(attachment.localPath.includes('..')).toBe(false)
    expect(attachment.localPath.startsWith('_________tmp_x/')).toBe(true)
    expect(existsSync(join(getAttachmentsDir(), attachment.localPath))).toBe(true)
    expect(existsSync(join(sandboxDir, '..', 'tmp', 'x'))).toBe(false)
  })

  test('Given 带路径构造的文件名，When 保存附件，Then 扩展名被净化为安全单段', async () => {
    const { saveAttachment } = await import('./attachment-service')

    const { attachment } = saveAttachment({
      conversationId: 'session-b',
      filename: 'evil../../../shell.sh',
      mediaType: 'text/plain',
      data: Buffer.from('x', 'utf-8').toString('base64'),
    })

    expect(attachment.localPath.includes('..')).toBe(false)
    expect(attachment.localPath.endsWith('.sh')).toBe(true)
  })
})
