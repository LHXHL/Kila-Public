/**
 * Session 分叉与分支比较
 *
 * 从 session-service.ts 拆出，控制单文件体积。分叉/比较逻辑相对独立，
 * 依赖注入的 deps 便于测试。
 */

import type {
  SessionBranchComparison,
  SessionBranchFromMessageInput,
  SessionMeta,
} from '@kila/shared'
import {
  createSession,
  getSessionMeta,
  getSessionMessages,
  saveSessionMessages,
  updateSessionMeta,
} from './session-manager'
import { cloneSessionMessageAttachments } from './session-attachment-clone'
import { clearPiSessionState } from './pi-session-state'

const DEFAULT_SESSION_TITLE = '新会话'

function resolveSessionTitle(title: string | undefined): string {
  if (typeof title !== 'string') return DEFAULT_SESSION_TITLE
  const trimmed = title.trim()
  return trimmed || DEFAULT_SESSION_TITLE
}

export interface BranchSessionDeps {
  resetPiSessionState: (sessionId: string) => void
  getSessionMeta: typeof getSessionMeta
  getSessionMessages: typeof getSessionMessages
  createSession: typeof createSession
  saveSessionMessages: typeof saveSessionMessages
  updateSessionMeta: typeof updateSessionMeta
  cloneSessionMessageAttachments?: typeof cloneSessionMessageAttachments
}

const defaultBranchSessionDeps: BranchSessionDeps = {
  resetPiSessionState: clearPiSessionState,
  getSessionMeta,
  getSessionMessages,
  createSession,
  saveSessionMessages,
  updateSessionMeta,
  cloneSessionMessageAttachments,
}

export function branchSessionFromMessage(
  input: SessionBranchFromMessageInput,
  deps: BranchSessionDeps = defaultBranchSessionDeps,
): SessionMeta {
  const sourceSession = deps.getSessionMeta(input.sessionId)
  if (!sourceSession) throw new Error(`Session 不存在: ${input.sessionId}`)

  const messages = deps.getSessionMessages(input.sessionId)
  const targetIndex = messages.findIndex((message) => message.id === input.messageId)
  if (targetIndex < 0) throw new Error(`找不到要分叉的消息: ${input.messageId}`)

  const branchedAt = Date.now()
  const nextSession = deps.createSession({
    title: `${resolveSessionTitle(sourceSession.title)} · 分叉`,
    projectPath: sourceSession.project.path,
    channelId: sourceSession.channelId,
    modelId: sourceSession.modelId,
    thinkingLevel: sourceSession.thinkingLevel,
    historyTurns: sourceSession.historyTurns,
    enabledToolIds: sourceSession.enabledToolIds,
    systemPromptId: sourceSession.systemPromptId,
    parentSessionId: sourceSession.id,
    branchPointMessageId: input.messageId,
    branchedAt,
  })

  const prefix = messages.slice(0, targetIndex + 1)
  const selfContainedPrefix = deps.cloneSessionMessageAttachments
    ? deps.cloneSessionMessageAttachments(nextSession.id, prefix)
    : prefix
  deps.saveSessionMessages(nextSession.id, selfContainedPrefix)
  deps.resetPiSessionState(nextSession.id)

  return deps.updateSessionMeta(nextSession.id, {
    attachedDirectories: sourceSession.attachedDirectories ? [...sourceSession.attachedDirectories] : undefined,
    messageSource: sourceSession.messageSource,
    messageSourceLabel: sourceSession.messageSourceLabel,
    relatedTaskId: sourceSession.relatedTaskId,
    parentSessionId: sourceSession.id,
    branchPointMessageId: input.messageId,
    branchedAt,
  })
}

export function compareSessionBranch(sessionId: string, deps: Pick<BranchSessionDeps, 'getSessionMeta' | 'getSessionMessages'> = defaultBranchSessionDeps): SessionBranchComparison {
  const branch = deps.getSessionMeta(sessionId)
  if (!branch) throw new Error(`Session 不存在: ${sessionId}`)
  if (!branch.parentSessionId || !branch.branchPointMessageId) throw new Error('当前 Session 不是分叉会话')
  const parent = deps.getSessionMeta(branch.parentSessionId)
  if (!parent) throw new Error(`父 Session 不存在: ${branch.parentSessionId}`)
  const parentMessages = deps.getSessionMessages(parent.id)
  const branchMessages = deps.getSessionMessages(branch.id)
  const parentPointIndex = parentMessages.findIndex((message) => message.id === branch.branchPointMessageId)
  const branchPointIndex = branchMessages.findIndex((message) => message.id === branch.branchPointMessageId)
  const sharedMessageCount = parentPointIndex >= 0 && branchPointIndex >= 0
    ? Math.min(parentPointIndex, branchPointIndex) + 1
    : 0
  return {
    parentSessionId: parent.id,
    branchSessionId: branch.id,
    branchPointMessageId: branch.branchPointMessageId,
    sharedMessageCount,
    parentOnlyMessageCount: Math.max(0, parentMessages.length - sharedMessageCount),
    branchOnlyMessageCount: Math.max(0, branchMessages.length - sharedMessageCount),
    parentLatestMessageId: parentMessages.at(-1)?.id,
    branchLatestMessageId: branchMessages.at(-1)?.id,
  }
}
