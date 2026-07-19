import { describe, expect, test } from 'bun:test'
import type { SessionCreateInput, SessionMessage, SessionMeta, SessionMetaUpdates } from '@kila/shared'
import { branchSessionFromMessage, compareSessionBranch, type BranchSessionDeps } from './session-service'

function message(id: string, role: SessionMessage['role']): SessionMessage {
  return { id, role, content: id, createdAt: Number(id.replace(/\D/g, '')) || 1 }
}

function meta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 'source',
    title: '源会话',
    project: { path: '/tmp/kila-branch-project', name: 'project', source: 'user', profileId: 'profile-1', lockedAt: 10 },
    attachedDirectories: ['/tmp/shared-a'],
    channelId: 'channel-1',
    modelId: 'model-1',
    thinkingLevel: 'high',
    historyTurns: 20,
    enabledToolIds: ['read', 'write'],
    systemPromptId: 'prompt-1',
    messageSource: 'scheduled-task',
    messageSourceLabel: '日报',
    relatedTaskId: 'task-1',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

function createDeps(source: SessionMeta, sourceMessages: SessionMessage[]): {
  deps: BranchSessionDeps
  createdInputs: SessionCreateInput[]
  saved: Map<string, SessionMessage[]>
  metas: Map<string, SessionMeta>
  resetIds: string[]
} {
  const metas = new Map<string, SessionMeta>([[source.id, source]])
  const saved = new Map<string, SessionMessage[]>([[source.id, sourceMessages]])
  const createdInputs: SessionCreateInput[] = []
  const resetIds: string[] = []
  const deps: BranchSessionDeps = {
    resetPiSessionState: (id) => resetIds.push(id),
    getSessionMeta: (id) => metas.get(id),
    getSessionMessages: (id) => saved.get(id) ?? [],
    createSession: (input) => {
      createdInputs.push(input ?? {})
      const next = meta({
        id: 'branch',
        title: input?.title ?? '新会话',
        parentSessionId: input?.parentSessionId,
        branchPointMessageId: input?.branchPointMessageId,
        branchedAt: input?.branchedAt,
        createdAt: 3,
        updatedAt: 3,
      })
      metas.set(next.id, next)
      return next
    },
    saveSessionMessages: (id, messages) => saved.set(id, messages),
    cloneSessionMessageAttachments: (targetId, messages) => messages.map((entry) => ({ ...entry, content: `${entry.content}:${targetId}` })),
    updateSessionMeta: (id, updates: SessionMetaUpdates) => {
      const current = metas.get(id)
      if (!current) throw new Error('missing')
      const next = { ...current, ...updates, updatedAt: 4 }
      metas.set(id, next)
      return next
    },
  }
  return { deps, createdInputs, saved, metas, resetIds }
}

describe('session branch', () => {
  test('Given 中间消息分叉，When 创建分支，Then 截断消息并继承项目、模型、Prompt、能力与来源关系', () => {
    const source = meta()
    const context = createDeps(source, [message('u1', 'user'), message('a1', 'assistant'), message('u2', 'user'), message('a2', 'assistant')])

    const branch = branchSessionFromMessage({ sessionId: source.id, messageId: 'a1' }, context.deps)

    expect(context.saved.get(branch.id)?.map((entry) => entry.id)).toEqual(['u1', 'a1'])
    expect(context.saved.get(branch.id)?.map((entry) => entry.content)).toEqual(['u1:branch', 'a1:branch'])
    expect(context.createdInputs[0]).toMatchObject({
      projectPath: source.project.path,
      channelId: source.channelId,
      modelId: source.modelId,
      thinkingLevel: source.thinkingLevel,
      historyTurns: source.historyTurns,
      enabledToolIds: source.enabledToolIds,
      systemPromptId: source.systemPromptId,
      parentSessionId: source.id,
      branchPointMessageId: 'a1',
    })
    expect(branch).toMatchObject({
      parentSessionId: source.id,
      branchPointMessageId: 'a1',
      attachedDirectories: source.attachedDirectories,
      messageSource: source.messageSource,
      relatedTaskId: source.relatedTaskId,
    })
    expect(context.resetIds).toEqual(['branch'])
  })

  test('Given 父分支继续产生消息，When 比较，Then 返回共享点与双方独有消息数量', () => {
    const source = meta()
    const context = createDeps(source, [message('u1', 'user'), message('a1', 'assistant'), message('u2', 'user')])
    const branch = branchSessionFromMessage({ sessionId: source.id, messageId: 'a1' }, context.deps)
    context.saved.set(branch.id, [message('u1', 'user'), message('a1', 'assistant'), message('ub', 'user'), message('ab', 'assistant')])

    expect(compareSessionBranch(branch.id, context.deps)).toEqual({
      parentSessionId: source.id,
      branchSessionId: branch.id,
      branchPointMessageId: 'a1',
      sharedMessageCount: 2,
      parentOnlyMessageCount: 1,
      branchOnlyMessageCount: 2,
      parentLatestMessageId: 'u2',
      branchLatestMessageId: 'ab',
    })
  })

  test('Given 无效锚点或根会话，When 分叉或比较，Then 明确拒绝', () => {
    const source = meta()
    const context = createDeps(source, [message('u1', 'user')])
    expect(() => branchSessionFromMessage({ sessionId: source.id, messageId: 'missing' }, context.deps)).toThrow('找不到要分叉的消息')
    expect(() => compareSessionBranch(source.id, context.deps)).toThrow('不是分叉会话')
  })
})
