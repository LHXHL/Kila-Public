import { describe, expect, test } from 'bun:test'
import type { AgentPendingFile } from '@kila/shared'
import {
  mergeRecoveredComposerDraft,
  preparePendingFilePayloads,
} from './agent-send-transaction'

function pendingFile(id: string, filename: string): AgentPendingFile {
  return {
    id,
    filename,
    mediaType: 'text/plain',
    size: 4,
  }
}

describe('附件发送事务', () => {
  test('Given 附件原始数据完整 When 准备保存 Then 保持顺序且不产生缺失项', () => {
    const result = preparePendingFilePayloads(
      [pendingFile('a', 'a.txt'), pendingFile('b', 'b.txt')],
      new Map([['a', 'data:a'], ['b', 'data:b']]),
    )

    expect(result).toEqual({
      files: [
        { filename: 'a.txt', data: 'data:a' },
        { filename: 'b.txt', data: 'data:b' },
      ],
      missingFileNames: [],
    })
  })

  test('Given 任一附件数据缺失 When 准备保存 Then 报告缺失且绝不填充空数据', () => {
    const result = preparePendingFilePayloads(
      [pendingFile('a', 'a.txt'), pendingFile('b', 'b.txt')],
      new Map([['a', 'data:a']]),
    )

    expect(result.files).toEqual([{ filename: 'a.txt', data: 'data:a' }])
    expect(result.missingFileNames).toEqual(['b.txt'])
  })
})

describe('发送失败草稿恢复', () => {
  test('Given 请求期间没有新输入 When 发送失败 Then 恢复原草稿', () => {
    expect(mergeRecoveredComposerDraft('原消息', '')).toBe('原消息')
  })

  test('Given 请求期间产生新输入 When 发送失败 Then 同时保留失败消息与新输入', () => {
    expect(mergeRecoveredComposerDraft('原消息', '新输入')).toBe('原消息\n\n新输入')
  })

  test('Given 当前草稿已是失败消息 When 发送失败 Then 不重复恢复', () => {
    expect(mergeRecoveredComposerDraft('原消息', '原消息')).toBe('原消息')
  })
})
