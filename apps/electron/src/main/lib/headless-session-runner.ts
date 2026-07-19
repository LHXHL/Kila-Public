import { AGENT_IPC_CHANNELS, SESSION_IPC_CHANNELS } from '@kila/shared'
import type { AgentRunOutcome, SessionMessage, SessionMeta, SessionSendInput } from '@kila/shared'
import { getSessionMessages, getSessionMeta } from './session-manager'

type ExtendedSessionSendInput = SessionSendInput & {
  extraTools?: unknown[]
}

interface HeadlessSessionSinkLike {
  send: (channel: string, payload: unknown) => void
  isDestroyed: () => boolean
}

interface HeadlessSessionServiceLike {
  sendMessage: (input: ExtendedSessionSendInput, sink?: HeadlessSessionSinkLike) => Promise<void>
}

interface HeadlessSessionRunnerDeps {
  createSessionService?: () => HeadlessSessionServiceLike
  getSessionMeta?: (sessionId: string) => SessionMeta | undefined
  getSessionMessages?: (sessionId: string) => SessionMessage[]
  onStreamEvent?: (channel: string, payload: unknown) => void
}

export type HeadlessSessionRunResult =
  | {
      ok: true
      session: SessionMeta
      finalReply: string
      newMessages: SessionMessage[]
    }
  | {
      ok: false
      session: SessionMeta
      error: string
      newMessages: SessionMessage[]
    }

function findFinalAssistantReply(messages: SessionMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'assistant' && message.content.trim()) {
      return message.content
    }
  }

  return ''
}

function findErrorFromStatusMessages(messages: SessionMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'status' && message.errorCode && message.content) {
      return message.content
    }
  }

  return null
}

function getNewAssistantMessages(messages: SessionMessage[]): SessionMessage[] {
  return messages.filter((message) => message.role === 'assistant')
}

function findErrorFromAssistantEvents(messages: SessionMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    const errorEvent = message?.events?.find((event) => event.type === 'error')
    if (errorEvent) {
      return errorEvent.message
    }
  }

  return null
}

function hasAssistantToolUse(messages: SessionMessage[]): boolean {
  return messages.some((message) => message.events?.some((event) => event.type === 'tool_start') ?? false)
}

export async function runHeadlessSession(
  input: {
    sessionId: string
    sendInput: ExtendedSessionSendInput
  },
  deps?: HeadlessSessionRunnerDeps,
): Promise<HeadlessSessionRunResult> {
  const getSessionMetaFn = deps?.getSessionMeta ?? getSessionMeta
  const getSessionMessagesFn = deps?.getSessionMessages ?? getSessionMessages
  const session = getSessionMetaFn(input.sessionId)

  if (!session) {
    throw new Error(`Session 不存在: ${input.sessionId}`)
  }

  const service: HeadlessSessionServiceLike = deps?.createSessionService?.() ?? (
    await import('./session-service').then((module) => module.createHeadlessSessionService() as unknown as HeadlessSessionServiceLike)
  )
  const beforeMessageIds = new Set(
    getSessionMessagesFn(input.sessionId).map((message) => message.id),
  )
  let streamError: string | null = null
  let streamOutcome: AgentRunOutcome | null = null

  const sink: HeadlessSessionSinkLike = {
    send: (channel, payload) => {
      deps?.onStreamEvent?.(channel, payload)
      if (channel === SESSION_IPC_CHANNELS.STREAM_ERROR || channel === AGENT_IPC_CHANNELS.STREAM_ERROR) {
        const event = payload as { sessionId: string; error: string }
        if (event.sessionId === input.sessionId) streamError = event.error
        return
      }
      if (channel === SESSION_IPC_CHANNELS.STREAM_COMPLETE || channel === AGENT_IPC_CHANNELS.STREAM_COMPLETE) {
        const event = payload as { sessionId: string; outcome?: AgentRunOutcome }
        if (event.sessionId === input.sessionId) streamOutcome = event.outcome ?? 'success'
      }
    },
    isDestroyed: () => false,
  }

  await service.sendMessage(input.sendInput, sink)

  const afterMessages = getSessionMessagesFn(input.sessionId)
  // Session transcript 可能在运行期间被重写（例如 compaction/status 合并），不能依赖数组下标。
  // 通过稳定 message id 识别本次运行新增消息，避免 slice(beforeCount) 错配。
  const newMessages = afterMessages.filter((message) => !beforeMessageIds.has(message.id))
  const latestSession = getSessionMetaFn(input.sessionId) ?? session
  const statusError = findErrorFromStatusMessages(newMessages)
  const newAssistantMessages = getNewAssistantMessages(newMessages)
  const assistantEventError = findErrorFromAssistantEvents(newAssistantMessages)

  if (streamOutcome === 'stopped') {
    return {
      ok: false,
      session: latestSession,
      error: '任务已停止',
      newMessages,
    }
  }

  if (streamOutcome === 'error' || streamError) {
    return {
      ok: false,
      session: latestSession,
      error: streamError ?? statusError ?? assistantEventError ?? '任务执行失败',
      newMessages,
    }
  }

  // Headless 调用只能返回本轮新增回复；回退到整个 transcript 会把旧回复误当作本轮结果。
  const finalReply = findFinalAssistantReply(newMessages)

  if (!finalReply) {
    if (statusError) {
      return {
        ok: false,
        session: latestSession,
        error: statusError,
        newMessages,
      }
    }

    if (assistantEventError) {
      return {
        ok: false,
        session: latestSession,
        error: assistantEventError,
        newMessages,
      }
    }

    if (!hasAssistantToolUse(newAssistantMessages)) {
      return {
        ok: false,
        session: latestSession,
        error: 'LLM 返回了空回复（模型可能不可用或请求被拒绝）',
        newMessages,
      }
    }
  }

  return {
    ok: true,
    session: latestSession,
    finalReply,
    newMessages,
  }
}
