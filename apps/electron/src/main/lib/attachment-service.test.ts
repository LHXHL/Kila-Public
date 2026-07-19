import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import type { SessionMessage } from '@kila/shared'

let root = ''
let parentId = ''
let branchId = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kila-attachment-clone-'))
  parentId = `test-parent-${randomUUID()}`
  branchId = `test-branch-${randomUUID()}`
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(join(process.env.HOME ?? '', '.kila', 'attachments', parentId), { recursive: true, force: true })
  rmSync(join(process.env.HOME ?? '', '.kila', 'attachments', branchId), { recursive: true, force: true })
})

describe('session attachment clone', () => {
  test('Given 分叉消息引用父 Session 附件，When 克隆，Then 新消息只依赖新 Session 目录', async () => {
    const { cloneSessionMessageAttachments } = await import('./session-attachment-clone')
    const { resolveAttachmentPath } = await import('./config-paths')
    const parentPath = resolveAttachmentPath(`${parentId}/note.txt`)
    await Bun.write(parentPath, 'branch-safe')
    const saved = {
      id: 'source', filename: 'note.txt', mediaType: 'text/plain',
      localPath: `${parentId}/note.txt`, size: 11,
    }
    const messages: SessionMessage[] = [{
      id: 'm1', role: 'user', content: '查看附件', createdAt: 1, attachments: [saved, saved],
    }]

    const cloned = cloneSessionMessageAttachments(branchId, messages)
    const attachments = cloned[0]?.attachments ?? []
    expect(attachments).toHaveLength(2)
    expect(attachments[0]?.localPath.startsWith(`${branchId}/`)).toBe(true)
    expect(attachments[0]?.localPath).toBe(attachments[1]?.localPath)
    expect(readFileSync(resolveAttachmentPath(attachments[0]!.localPath), 'utf8')).toBe('branch-safe')
  })
})
