import { describe, expect, test } from 'bun:test'
import type { AgentPendingFile } from '@kila/shared'
import {
  disposePendingFiles,
  setSessionPendingFilesMap,
} from './agent-ui-atoms'

function file(id: string): AgentPendingFile {
  return {
    id,
    filename: `${id}.txt`,
    mediaType: 'text/plain',
    size: 1,
  }
}

describe('Session 待发送附件隔离', () => {
  test('Given 两个 Session 各有附件, When 更新其中一个, Then 不影响另一个 Session', () => {
    const initial = new Map<string, AgentPendingFile[]>([
      ['session-a', [file('a')]],
      ['session-b', [file('b')]],
    ])

    const next = setSessionPendingFilesMap(initial, 'session-a', [file('a2')])

    expect(next.get('session-a')?.map((item) => item.id)).toEqual(['a2'])
    expect(next.get('session-b')?.map((item) => item.id)).toEqual(['b'])
    expect(initial.get('session-a')?.map((item) => item.id)).toEqual(['a'])
  })

  test('Given 当前 Session 清空附件, When 写入空数组, Then 删除该 Session 条目', () => {
    const initial = new Map<string, AgentPendingFile[]>([['session-a', [file('a')]]])
    const next = setSessionPendingFilesMap(initial, 'session-a', [])

    expect(next.has('session-a')).toBe(false)
  })
})


describe('附件资源释放', () => {
  test('Given Session 被删除 When 释放待发送附件 Then 清理 base64 与 Blob URL', () => {
    const dataStore = new Map([
      ['image', 'base64-image'],
      ['doc', 'base64-doc'],
      ['other-session', 'keep'],
    ])
    const revoked: string[] = []

    disposePendingFiles([
      { id: 'image', filename: 'a.png', mediaType: 'image/png', size: 1, previewUrl: 'blob:image' },
      { id: 'doc', filename: 'a.txt', mediaType: 'text/plain', size: 1 },
    ], dataStore, (url) => revoked.push(url))

    expect(revoked).toEqual(['blob:image'])
    expect(dataStore).toEqual(new Map([['other-session', 'keep']]))
  })
})
