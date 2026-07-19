import { describe, expect, test } from 'bun:test'
import { makeUniqueAttachmentFilename } from './use-agent-attachments'

describe('附件文件名去重', () => {
  test('Given 同名文件已存在, When 添加附件, Then 在扩展名前追加递增序号', () => {
    expect(makeUniqueAttachmentFilename('report.pdf', ['report.pdf'])).toBe('report-1.pdf')
    expect(makeUniqueAttachmentFilename('report.pdf', ['report.pdf', 'report-1.pdf'])).toBe('report-2.pdf')
  })

  test('Given 无扩展名或隐藏文件, When 添加重名附件, Then 保留可读文件名', () => {
    expect(makeUniqueAttachmentFilename('LICENSE', ['LICENSE'])).toBe('LICENSE-1')
    expect(makeUniqueAttachmentFilename('.env', ['.env'])).toBe('.env-1')
  })
})
