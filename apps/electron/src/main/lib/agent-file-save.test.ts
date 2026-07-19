import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeAgentUploadFilename, saveAgentFilesToRoot } from './agent-file-save'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Agent 附件保存边界', () => {
  test('Given 路径穿越文件名 When 归一化 Then 只保留安全 basename', () => {
    expect(normalizeAgentUploadFilename('../../secret.txt')).toBe('secret.txt')
    expect(normalizeAgentUploadFilename('..\\..\\windows.txt')).toBe('windows.txt')
  })

  test('Given 两个同名附件 When 保存 Then 不覆盖且内容保持独立', () => {
    const root = mkdtempSync(join(tmpdir(), 'kila-agent-files-'))
    temporaryDirectories.push(root)

    const saved = saveAgentFilesToRoot(root, [
      { filename: 'note.txt', data: Buffer.from('first').toString('base64') },
      { filename: 'note.txt', data: Buffer.from('second').toString('base64') },
    ])

    expect(saved.map((file) => file.filename)).toEqual(['note.txt', 'note-1.txt'])
    expect(readFileSync(saved[0]!.targetPath, 'utf8')).toBe('first')
    expect(readFileSync(saved[1]!.targetPath, 'utf8')).toBe('second')
  })

  test('Given 批次中后续文件名无效 When 保存失败 Then 回滚之前已写入文件', () => {
    const root = mkdtempSync(join(tmpdir(), 'kila-agent-files-'))
    temporaryDirectories.push(root)

    expect(() => saveAgentFilesToRoot(root, [
      { filename: 'created.txt', data: Buffer.from('created').toString('base64') },
      { filename: '\0', data: '' },
    ])).toThrow('附件文件名无效')
    expect(existsSync(join(root, 'created.txt'))).toBe(false)
  })
})
