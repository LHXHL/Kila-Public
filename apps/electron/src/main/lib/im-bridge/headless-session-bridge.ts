import { SESSION_IPC_CHANNELS } from '@kila/shared'
import type { AgentEvent, BridgeChannelType, PermissionRequest, SessionMessage, SessionMeta, SessionSendInput, SessionStreamEvent } from '@kila/shared'
import { runHeadlessSession } from '../headless-session-runner'
import type { HeadlessSessionSink } from '../session-service'

interface HeadlessSessionServiceLike {
  /** 无头链路第二参数传的是事件 sink（不是 WebContents），方法签名保持双变以兼容真实 SessionService */
  sendMessage(input: SessionSendInput, sink?: HeadlessSessionSink): Promise<void>
}

export interface HeadlessStreamEventContext {
  sessionId: string
  channelType: BridgeChannelType
  endpointKey: string
}

interface HeadlessSessionBridgeDeps {
  createSessionService: () => HeadlessSessionServiceLike
  getSessionMeta: (sessionId: string) => SessionMeta | undefined
  getSessionMessages: (sessionId: string) => SessionMessage[]
  onPermissionRequest?: (context: HeadlessStreamEventContext, request: PermissionRequest) => Promise<void> | void
  /** 流式 Agent 事件回调，用于驱动流式卡片等场景 */
  onAgentEvent?: (context: HeadlessStreamEventContext, event: AgentEvent) => void
  onStreamEvent?: (context: HeadlessStreamEventContext, channel: string, payload: unknown) => void
}

export interface HeadlessSendInput {
  sessionId: string
  channelType: BridgeChannelType
  endpointKey: string
  userMessage: string
  attachments?: SessionSendInput['attachments']
  overrides?: Omit<SessionSendInput, 'sessionId' | 'userMessage' | 'attachments'>
}

export interface HeadlessSendResult {
  session: SessionMeta
  ok: true
  finalReply: string
}

export interface HeadlessSendErrorResult {
  session: SessionMeta
  ok: false
  error: string
}

export class HeadlessSessionBridge {
  constructor(private readonly deps: HeadlessSessionBridgeDeps) {}

  async sendMessage(input: HeadlessSendInput): Promise<HeadlessSendResult | HeadlessSendErrorResult> {
    const session = this.deps.getSessionMeta(input.sessionId)
    if (!session) {
      throw new Error(`Session 不存在: ${input.sessionId}`)
    }

    const result = await runHeadlessSession({
      sessionId: input.sessionId,
      sendInput: {
        sessionId: input.sessionId,
        userMessage: input.userMessage,
        attachments: input.attachments,
        messageSource: 'im-bridge',
        messageSourceLabel: input.channelType.toUpperCase(),
        ...input.overrides,
      },
    }, {
      createSessionService: () => this.deps.createSessionService(),
      getSessionMeta: this.deps.getSessionMeta,
      getSessionMessages: this.deps.getSessionMessages,
      onStreamEvent: (channel, payload) => {
        const context = {
          sessionId: input.sessionId,
          channelType: input.channelType,
          endpointKey: input.endpointKey,
        }
        this.deps.onStreamEvent?.(context, channel, payload)

        if (channel !== SESSION_IPC_CHANNELS.STREAM_EVENT) return

        const event = payload as SessionStreamEvent
        if (event.type !== 'agent_event') return
        if (event.sessionId !== input.sessionId) return

        const agentEvent = event.event as AgentEvent

        // 权限请求走原有逻辑
        if (agentEvent.type === 'permission_request') {
          void this.deps.onPermissionRequest?.(context, agentEvent.request)
          return
        }

        // 其他 Agent 事件转发给 onAgentEvent 回调
        this.deps.onAgentEvent?.(context, agentEvent)
      },
    })

    if (!result.ok) {
      return { session, ok: false, error: result.error }
    }

    return { session, ok: true, finalReply: result.finalReply }
  }
}
