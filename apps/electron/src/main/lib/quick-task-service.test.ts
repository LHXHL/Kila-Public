import { describe, expect, test } from 'bun:test'
import type { FileAttachment, SessionMeta, SessionSendInput } from '@kila/shared'
import { submitQuickTask, type QuickTaskSubmitDeps } from './quick-task-service'

function createSessionMeta(id = 'session-1'): SessionMeta {
  const now = Date.now()
  return {
    id,
    title: '快速任务',
    project: { path: '/tmp/kila-project', name: 'kila-project', source: 'temp', profileId: 'profile-test' },
    createdAt: now,
    updatedAt: now,
  }
}

function createHarness(overrides: Partial<QuickTaskSubmitDeps<{ id: string }>> = {}) {
  const calls = {
    created: 0,
    deleted: [] as string[],
    deletedAttachments: [] as string[],
    watched: [] as string[],
    unwatched: [] as string[],
    opened: [] as string[],
    hidden: 0,
    sent: [] as SessionSendInput[],
  }
  const deps: QuickTaskSubmitDeps<{ id: string }> = {
    getSettings: () => ({ agentChannelId: 'channel-1', agentModelId: 'model-1' }),
    getMainTarget: () => ({ id: 'main' }),
    createSession: () => {
      calls.created += 1
      return createSessionMeta()
    },
    saveAttachment: ({ filename, mediaType }) => ({
      attachment: {
        id: `attachment-${filename}`,
        filename,
        mediaType,
        localPath: `session-1/${filename}`,
        size: 1,
      },
    }),
    deleteSession: (id) => { calls.deleted.push(id) },
    deleteSessionAttachments: (id) => { calls.deletedAttachments.push(id) },
    watchSessionProject: (id) => { calls.watched.push(id) },
    unwatchSessionProject: (id) => { calls.unwatched.push(id) },
    openSession: ({ sessionId }) => { calls.opened.push(sessionId) },
    hideWindow: () => { calls.hidden += 1 },
    sendMessage: async (input) => { calls.sent.push(input) },
    ...overrides,
  }
  return { deps, calls }
}

describe('Quick Task 原子提交', () => {
  test('主窗口未就绪时不创建 Session', () => {
    const { deps, calls } = createHarness({ getMainTarget: () => null })
    expect(() => submitQuickTask({ prompt: '分析项目' }, deps))
      .toThrow('主窗口尚未就绪')
    expect(calls.created).toBe(0)
  })

  test('正常提交携带项目和附件', async () => {
    const { deps, calls } = createHarness()
    const result = submitQuickTask({
      prompt: '先分析再修改',
      projectPath: '/repo',
      attachments: [{ filename: 'a.txt', mediaType: 'text/plain', data: 'YQ==', size: 1 }],
    }, deps)

    await Promise.resolve()
    expect(result).toEqual({ sessionId: 'session-1' })
    expect(calls.watched).toEqual(['session-1'])
    expect(calls.opened).toEqual(['session-1'])
    expect(calls.hidden).toBe(1)
    expect(calls.sent).toHaveLength(1)
    expect(calls.sent[0]).toMatchObject({
      sessionId: 'session-1',
      userMessage: '先分析再修改',
      channelId: 'channel-1',
      modelId: 'model-1',
      messageSource: 'manual',
    })
    expect(calls.sent[0]?.attachments?.[0]).toMatchObject({ filename: 'a.txt' })
  })

  test('附件保存失败时回滚 Session 和已落盘附件', () => {
    let saveCount = 0
    const { deps, calls } = createHarness({
      saveAttachment: () => {
        saveCount += 1
        if (saveCount === 2) throw new Error('磁盘已满')
        const attachment: FileAttachment = {
          id: 'first', filename: 'a.txt', mediaType: 'text/plain', localPath: 'session-1/a.txt', size: 1,
        }
        return { attachment }
      },
    })

    expect(() => submitQuickTask({
      prompt: '处理附件',
      attachments: [
        { filename: 'a.txt', mediaType: 'text/plain', data: 'YQ==', size: 1 },
        { filename: 'b.txt', mediaType: 'text/plain', data: 'Yg==', size: 1 },
      ],
    }, deps)).toThrow('磁盘已满')
    expect(calls.deletedAttachments).toEqual(['session-1'])
    expect(calls.deleted).toEqual(['session-1'])
    expect(calls.opened).toHaveLength(0)
  })

  test('打开主窗口失败时停止监听并完整回滚', () => {
    const { deps, calls } = createHarness({ openSession: () => { throw new Error('窗口已销毁') } })
    expect(() => submitQuickTask({ prompt: '执行任务' }, deps)).toThrow('窗口已销毁')
    expect(calls.watched).toEqual(['session-1'])
    expect(calls.unwatched).toEqual(['session-1'])
    expect(calls.deletedAttachments).toEqual(['session-1'])
    expect(calls.deleted).toEqual(['session-1'])
  })
})
