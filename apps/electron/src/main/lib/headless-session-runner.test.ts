import { describe, expect, test } from 'bun:test'
import {
  AGENT_IPC_CHANNELS,
  SESSION_IPC_CHANNELS,
  type AgentRunOutcome,
  type SessionMessage,
  type SessionMeta,
} from '@kila/shared'
import { runHeadlessSession } from './headless-session-runner'

function createSession(updatedAt = 1): SessionMeta {
  return {
    id: 'session-1',
    title: 'Headless 测试',
    project: {
      path: '/tmp/kila-headless-test',
      name: 'kila-headless-test',
      source: 'temp',
      profileId: 'profile-1',
    },
    createdAt: 1,
    updatedAt,
  }
}

function message(
  id: string,
  role: SessionMessage['role'],
  content: string,
  extra: Partial<SessionMessage> = {},
): SessionMessage {
  return { id, role, content, createdAt: Number(id.replace(/\D/g, '')) || 1, ...extra }
}

async function runScenario(input: {
  before?: SessionMessage[]
  after?: SessionMessage[]
  outcome?: AgentRunOutcome
  streamError?: string
  latestSession?: SessionMeta
}) {
  let messages = [...(input.before ?? [])]
  const initialSession = createSession()
  const latestSession = input.latestSession ?? initialSession

  return runHeadlessSession({
    sessionId: initialSession.id,
    sendInput: {
      sessionId: initialSession.id,
      userMessage: '执行任务',
      channelId: 'channel-1',
      modelId: 'model-1',
    },
  }, {
    getSessionMeta: () => messages.length === (input.before?.length ?? 0) ? initialSession : latestSession,
    getSessionMessages: () => messages,
    createSessionService: () => ({
      sendMessage: async (_sendInput, sink) => {
        messages = [...messages, ...(input.after ?? [])]
        if (input.streamError) {
          sink?.send(SESSION_IPC_CHANNELS.STREAM_ERROR, {
            sessionId: initialSession.id,
            error: input.streamError,
          })
        }
        sink?.send(AGENT_IPC_CHANNELS.STREAM_COMPLETE, {
          sessionId: initialSession.id,
          outcome: input.outcome ?? 'success',
        })
      },
    }),
  })
}

describe('runHeadlessSession', () => {
  test('Given transcript 被重排且存在旧回复, When 本轮成功, Then 按 message id 识别新增消息并返回最新 SessionMeta', async () => {
    const oldReply = message('m1', 'assistant', '旧回复')
    const currentReply = message('m2', 'assistant', '本轮回复')
    const latestSession = createSession(2)
    const result = await runScenario({
      before: [oldReply],
      after: [currentReply, oldReply],
      latestSession,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.finalReply).toBe('本轮回复')
    expect(result.newMessages.map((item) => item.id)).toEqual(['m2'])
    expect(result.session.updatedAt).toBe(2)
  })

  test('Given 本轮没有正文但历史有旧回复, When Headless 完成, Then 不回退旧回复并报告空回复', async () => {
    const result = await runScenario({
      before: [message('m1', 'assistant', '历史回复')],
      after: [],
    })

    expect(result).toMatchObject({
      ok: false,
      error: 'LLM 返回了空回复（模型可能不可用或请求被拒绝）',
    })
  })

  test('Given 本轮只有工具调用, When Headless 成功结束, Then 允许成功但 finalReply 为空', async () => {
    const result = await runScenario({
      after: [message('m2', 'assistant', '', {
        events: [{ type: 'tool_start', toolName: 'read', toolUseId: 'tool-1', input: {} }],
      })],
    })

    expect(result).toMatchObject({ ok: true, finalReply: '' })
  })

  test('Given Session complete outcome 为 stopped, When 已产生部分正文, Then 不把停止误报为成功', async () => {
    const result = await runScenario({
      after: [message('m2', 'assistant', '部分输出')],
      outcome: 'stopped',
    })

    expect(result).toMatchObject({ ok: false, error: '任务已停止' })
  })

  test('Given Session complete outcome 为 error, When 错误消息只写入 status, Then 返回可见错误', async () => {
    const result = await runScenario({
      after: [message('m2', 'status', '模型不可用', { errorCode: 'provider_error' })],
      outcome: 'error',
    })

    expect(result).toMatchObject({ ok: false, error: '模型不可用' })
  })

  test('Given stream error 与旧回复同时存在, When Headless 收敛, Then stream error 优先', async () => {
    const result = await runScenario({
      before: [message('m1', 'assistant', '旧回复')],
      after: [message('m2', 'assistant', '部分输出')],
      outcome: 'error',
      streamError: '网络失败',
    })

    expect(result).toMatchObject({ ok: false, error: '网络失败' })
  })
})
