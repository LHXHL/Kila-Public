import { randomUUID } from 'node:crypto'
import { AGENT_IPC_CHANNELS, SESSION_IPC_CHANNELS } from '@kila/shared'
import type { AgentEvent, BridgeBinding, SessionMeta } from '@kila/shared'
import { appendSessionMessage } from '../../session-manager'
import { broadcastSessionChannel } from '../../cli-bridge/broadcaster'
import { imBridgeConfigManager } from '../config-manager'
import { FeishuMultiAdapter } from '../adapters'
import { createInitialState, finalizeIfRunning, markError, reduce as reduceRunState } from './card-run-state'
import type { RunState } from './card-run-state'

export function buildSessionMirrorGroupName(session: Pick<SessionMeta, 'id' | 'title'>): string {
  const rawTitle = session.title?.trim()
  const title = rawTitle && rawTitle !== '新会话' ? rawTitle : `新会话 ${session.id.slice(0, 8)}`
  const name = `Kila - ${title}`
  return name.length > 60 ? `${name.slice(0, 57)}...` : name
}

function extractAgentEvent(payload: unknown): { sessionId: string; event: AgentEvent } | null {
  const candidate = payload as { type?: unknown; sessionId?: unknown; event?: unknown }
  if (candidate.type && candidate.type !== 'agent_event') return null
  const event = candidate.event && typeof candidate.event === 'object'
    ? candidate.event
    : payload && typeof payload === 'object' && 'event' in (payload as Record<string, unknown>)
      ? candidate.event
      : undefined
  if (typeof candidate.sessionId !== 'string' || !event || typeof event !== 'object') {
    return null
  }
  return { sessionId: candidate.sessionId, event: event as AgentEvent }
}

export class FeishuSessionMirrorService {
  private readonly sessionToEndpoint = new Map<string, string>()
  private readonly states = new Map<string, RunState>()

  constructor(private readonly adapter: FeishuMultiAdapter) {}

  private findMirrorUserOpenId(botId: string): string | null {
    const bindings = imBridgeConfigManager.listBindings()
    const candidates = bindings.filter((binding) => (
      binding.channelType === 'feishu' &&
      binding.botId === botId &&
      binding.userId &&
      binding.userId !== 'unknown'
    ))
    candidates.sort((a, b) => b.updatedAt - a.updatedAt)
    return candidates[0]?.userId ?? null
  }

  private saveMirrorBinding(input: {
    session: SessionMeta
    botId: string
    chatId: string
    userOpenId: string
  }): void {
    const now = Date.now()
    const endpointKey = `feishu:${input.botId}:${input.chatId}`
    const bindings = imBridgeConfigManager.listBindings()
    const nextBinding: BridgeBinding = {
      channelType: 'feishu',
      endpointKey,
      botId: input.botId,
      chatId: input.chatId,
      userId: input.userOpenId,
      sessionId: input.session.id,
      projectPath: input.session.project.path,
      peerType: 'group',
      displayName: buildSessionMirrorGroupName(input.session),
      createdAt: bindings.find((item) => item.endpointKey === endpointKey)?.createdAt ?? now,
      updatedAt: now,
    }
    imBridgeConfigManager.saveBindings([
      ...bindings.filter((item) => item.endpointKey !== endpointKey),
      nextBinding,
    ])
    this.sessionToEndpoint.set(input.session.id, endpointKey)
  }

  private async ensureMirrorGroup(session: SessionMeta): Promise<BridgeBinding | null> {
    const config = imBridgeConfigManager.getConfig().feishu
    if (config.sessionMirror?.mode !== 'stream' || !config.sessionMirror.botId) return null

    const existing = imBridgeConfigManager.listBindings().find((binding) => (
      binding.channelType === 'feishu' &&
      binding.sessionId === session.id &&
      binding.botId === config.sessionMirror?.botId
    ))
    if (existing) {
      this.sessionToEndpoint.set(session.id, existing.endpointKey)
      return existing
    }

    const bot = config.bots?.find((item) => item.id === config.sessionMirror?.botId)
    if (!bot?.enabled || !bot.appId) return null

    const userOpenId = this.findMirrorUserOpenId(bot.id)
    if (!userOpenId) {
      appendSessionMessage(session.id, {
        id: randomUUID(),
        role: 'status',
        content: `飞书 Session 镜像未启动：请先在飞书中向「${bot.name}」发送一条消息完成绑定。`,
        createdAt: Date.now(),
        messageSource: 'im-bridge',
        messageSourceLabel: 'Feishu',
      })
      broadcastSessionChannel(SESSION_IPC_CHANNELS.UPDATED, { sessionId: session.id, reason: 'updated' })
      return null
    }

    const adapter = this.adapter.getAdapter(bot.id)
    if (!adapter) return null
    const chatId = await adapter.createChatWithUser({
      userOpenId,
      name: buildSessionMirrorGroupName(session),
    })
    this.saveMirrorBinding({
      session,
      botId: bot.id,
      chatId,
      userOpenId,
    })
    return imBridgeConfigManager.listBindings().find((binding) => binding.endpointKey === `feishu:${bot.id}:${chatId}`) ?? null
  }

  async start(session: SessionMeta): Promise<void> {
    const binding = await this.ensureMirrorGroup(session)
    if (!binding?.botId) return
    const adapter = this.adapter.getAdapter(binding.botId)
    if (!adapter) return
    const state = createInitialState(session.modelId)
    this.states.set(session.id, state)
    await adapter.openStreamCard(binding.endpointKey, binding.chatId, session.modelId)
  }

  onStream(channel: string, payload: unknown): void {
    if (channel === AGENT_IPC_CHANNELS.STREAM_COMPLETE || channel === SESSION_IPC_CHANNELS.STREAM_COMPLETE) {
      const event = payload as { sessionId?: unknown }
      if (typeof event.sessionId === 'string') {
        void this.close(event.sessionId)
      }
      return
    }

    if (channel === SESSION_IPC_CHANNELS.TITLE_UPDATED) {
      const event = payload as { sessionId?: unknown; title?: unknown }
      if (typeof event.sessionId === 'string' && typeof event.title === 'string') {
        void this.renameMirrorGroup(event.sessionId, event.title)
      }
      return
    }

    if (channel === AGENT_IPC_CHANNELS.STREAM_ERROR || channel === SESSION_IPC_CHANNELS.STREAM_ERROR) {
      const event = payload as { sessionId?: unknown; error?: unknown }
      if (typeof event.sessionId === 'string') {
        if (!this.sessionToEndpoint.has(event.sessionId) && !this.states.has(event.sessionId)) return
        const text = typeof event.error === 'string' ? event.error : '运行失败'
        const state = markError(this.states.get(event.sessionId) ?? createInitialState(), text)
        this.states.set(event.sessionId, state)
        void this.close(event.sessionId)
      }
      return
    }

    if (channel !== AGENT_IPC_CHANNELS.STREAM_EVENT && channel !== SESSION_IPC_CHANNELS.STREAM_EVENT) return
    const event = extractAgentEvent(payload)
    if (!event) return
    if (!this.sessionToEndpoint.has(event.sessionId) && !this.states.has(event.sessionId)) return
    const previous = this.states.get(event.sessionId) ?? createInitialState()
    const next = reduceRunState(previous, event.event)
    this.states.set(event.sessionId, next)
    void this.update(event.sessionId, next)
  }

  private async update(sessionId: string, state: RunState): Promise<void> {
    const endpointKey = this.sessionToEndpoint.get(sessionId)
    if (!endpointKey) return
    const binding = imBridgeConfigManager.listBindings().find((item) => item.endpointKey === endpointKey)
    if (!binding?.botId) return
    const adapter = this.adapter.getAdapter(binding.botId)
    if (!adapter) return
    await this.adapter.updateStreamCard(binding.endpointKey, binding.chatId, state)
  }

  private async close(sessionId: string): Promise<void> {
    // 同一次失败会依次收到 STREAM_ERROR 与 STREAM_COMPLETE(outcome=error)。
    // 第一次 close 在首个 await 前删除 state，后续重复终态必须直接退出，避免同一卡片被关闭两次。
    if (!this.states.has(sessionId)) return
    const endpointKey = this.sessionToEndpoint.get(sessionId)
    if (!endpointKey) return
    const binding = imBridgeConfigManager.listBindings().find((item) => item.endpointKey === endpointKey)
    if (!binding?.botId) return
    const adapter = this.adapter.getAdapter(binding.botId)
    if (!adapter) return
    const state = finalizeIfRunning(this.states.get(sessionId) ?? createInitialState())
    this.states.delete(sessionId)
    await this.adapter.closeStreamCard(binding.endpointKey, binding.chatId, state)
  }

  private async renameMirrorGroup(sessionId: string, title: string): Promise<void> {
    const endpointKey = this.sessionToEndpoint.get(sessionId)
      ?? imBridgeConfigManager.listBindings().find((binding) => (
        binding.channelType === 'feishu' && binding.sessionId === sessionId
      ))?.endpointKey
    if (!endpointKey) return

    const binding = imBridgeConfigManager.listBindings().find((item) => item.endpointKey === endpointKey)
    if (!binding?.botId) return
    const adapter = this.adapter.getAdapter(binding.botId)
    if (!adapter) return

    const nextName = buildSessionMirrorGroupName({ id: sessionId, title })
    if (binding.displayName === nextName) return
    const updated = await adapter.renameChat(binding.chatId, nextName)
    if (!updated) return

    const now = Date.now()
    imBridgeConfigManager.saveBindings(imBridgeConfigManager.listBindings().map((item) => (
      item.endpointKey === endpointKey
        ? { ...item, displayName: nextName, updatedAt: now }
        : item
    )))
    this.sessionToEndpoint.set(sessionId, endpointKey)
  }
}
