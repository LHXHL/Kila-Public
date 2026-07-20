/**
 * Unified session service
 *
 * 单一 Session 只走 Agent runtime。
 */

import type { WebContents } from 'electron'
import { AGENT_IPC_CHANNELS, SESSION_IPC_CHANNELS, buildSessionTurnReplayPlan } from '@kila/shared'
import type {
  AgentSendInput,
  AgentEvent,
  AgentEventUsage,
  SessionBranchComparison,
  SessionBranchFromMessageInput,
  SessionEditTurnInput,
  SessionMessage,
  SessionMeta,
  SessionMetaUpdates,
  SessionProject,
  SessionRegenerateTurnInput,
  SessionRewindInput,
  SessionSendInput,
  SessionTitleUpdatedPayload,
  SessionUpdatedPayload,
} from '@kila/shared'
import { createSession, getSessionMeta, getSessionMessages, saveSessionMessages, updateSessionMeta } from './session-manager'
import { ensureSessionProjectReady, lockSessionProject } from './session-project-manager'
import { getChannelById } from './channel-manager'
import { getTokenUsageStats, recordTokenUsageFromCompleteEvent } from './token-usage-service'
import { memoryLifecycleManager } from './memory/lifecycle-manager'
import { emitSessionRuntimeRunStart, emitSessionRuntimeStream } from './session-runtime-observers'
import { getSettings } from './settings-service'
import { cloneSessionMessageAttachments } from './session-attachment-clone'
import { clearPiSessionState } from './pi-session-state'
import { switchesActiveRuntimeSelection } from './agent-runtime-selection'


import { createLogger } from './logger'

const log = createLogger('SessionService')

type AgentRuntimeModule = typeof import('./agent-service')
type SessionTitleRuntimeModule = typeof import('./session-title-service')

let agentRuntimeModulePromise: Promise<AgentRuntimeModule> | undefined
let sessionTitleRuntimeModulePromise: Promise<SessionTitleRuntimeModule> | undefined

function loadAgentRuntime(): Promise<AgentRuntimeModule> {
  agentRuntimeModulePromise ??= import('./agent-service')
  return agentRuntimeModulePromise
}

function loadSessionTitleRuntime(): Promise<SessionTitleRuntimeModule> {
  sessionTitleRuntimeModulePromise ??= import('./session-title-service')
  return sessionTitleRuntimeModulePromise
}

interface RuntimeHandlerArgs {
  session: SessionMeta
  input: SessionSendInput
  webContents?: WebContents
}

interface SessionTokenUsageArgs {
  sessionId: string
  session: SessionMeta
  input: SessionSendInput
  messages: SessionMessage[]
  existingMessageIds: ReadonlySet<string>
  webContents?: WebContents
}

export interface HeadlessSessionSink {
  send: (channel: string, payload: unknown) => void
  isDestroyed: () => boolean
}

export interface SessionServiceDeps {
  getSessionMeta: (id: string) => SessionMeta | undefined
  getSessionMessages: (id: string) => SessionMessage[]
  saveSessionMessages: (id: string, messages: SessionMessage[]) => void
  updateSessionMeta: (id: string, updates: SessionMetaUpdates) => SessionMeta
  runAgentRuntime: (args: RuntimeHandlerArgs) => Promise<void>
  stopAgentRuntime: (sessionId: string) => void
  stopAgentRuntimeAndWait?: (sessionId: string, timeoutMs?: number) => Promise<void>
  resetAgentRuntime?: (sessionId: string) => Promise<void>
  isAgentRuntimeActive?: (sessionId: string) => Promise<boolean> | boolean
  steerAgentRuntime?: (args: RuntimeHandlerArgs) => Promise<void>
  queueFollowUpRuntime?: (args: RuntimeHandlerArgs) => Promise<void>
  waitForAgentRuntimeIdle?: (sessionId: string) => Promise<void>
  generateTitle: (args: {
    session: SessionMeta
    input: SessionSendInput
  }) => Promise<string | null>
  recordTokenUsage?: (args: SessionTokenUsageArgs) => Promise<void>
  emitTitleUpdated: (payload: SessionTitleUpdatedPayload) => void
  emitSessionUpdated: (payload: SessionUpdatedPayload) => void
  ensureSessionProjectReady?: (project: SessionProject) => void
}

const AUTO_TITLE_PLACEHOLDERS = new Set(['新会话', '新对话', '新 Agent 会话'])
const SLASH_COMMAND_PREFIX = '/'
const DEFAULT_SESSION_TITLE = '新会话'

function resolveSessionTitle(title: string | undefined): string {
  if (typeof title !== 'string') {
    return DEFAULT_SESSION_TITLE
  }

  const trimmed = title.trim()
  return trimmed || DEFAULT_SESSION_TITLE
}

function findFirstTitleCandidate(messages: SessionMessage[]): SessionMessage | null {
  for (const message of messages) {
    if (message.role !== 'user') continue
    const trimmed = message.content.trim()
    if (!trimmed || trimmed.startsWith(SLASH_COMMAND_PREFIX)) continue
    return message
  }

  return null
}

function sendUnifiedSessionError(
  webContents: WebContents,
  sessionId: string,
  error: string,
): void {
  webContents.send(SESSION_IPC_CHANNELS.STREAM_ERROR, {
    sessionId,
    error,
  })
}

export function createSessionRuntimeBridge(webContents: WebContents): WebContents {
  return {
    send: (channel: string, payload: unknown) => {
      if (webContents.isDestroyed()) return

      webContents.send(channel, payload)
      emitSessionRuntimeStream(channel, payload)

      switch (channel) {
        case AGENT_IPC_CHANNELS.STREAM_EVENT: {
          const event = payload as { sessionId: string; event: unknown }
          webContents.send(SESSION_IPC_CHANNELS.STREAM_EVENT, {
            type: 'agent_event',
            sessionId: event.sessionId,
            event: event.event,
          })
          return
        }
        case AGENT_IPC_CHANNELS.STREAM_COMPLETE: {
          const event = payload as { sessionId: string; outcome?: 'success' | 'stopped' | 'error' }
          webContents.send(SESSION_IPC_CHANNELS.STREAM_COMPLETE, {
            sessionId: event.sessionId,
            outcome: event.outcome,
          })
          webContents.send(SESSION_IPC_CHANNELS.UPDATED, {
            sessionId: event.sessionId,
            reason: 'updated',
          })
          return
        }
        case AGENT_IPC_CHANNELS.STREAM_ERROR: {
          const event = payload as { sessionId: string; error: string }
          sendUnifiedSessionError(webContents, event.sessionId, event.error)
          webContents.send(SESSION_IPC_CHANNELS.UPDATED, {
            sessionId: event.sessionId,
            reason: 'updated',
          })
          return
        }
        case AGENT_IPC_CHANNELS.TITLE_UPDATED: {
          const event = payload as { sessionId: string; title: string }
          webContents.send(SESSION_IPC_CHANNELS.TITLE_UPDATED, {
            sessionId: event.sessionId,
            title: event.title,
          })
          webContents.send(SESSION_IPC_CHANNELS.UPDATED, {
            sessionId: event.sessionId,
            reason: 'updated',
          })
          return
        }
      }
    },
    isDestroyed: () => webContents.isDestroyed(),
  } as WebContents
}

async function defaultRunAgentRuntime({ session, input, webContents }: RuntimeHandlerArgs): Promise<void> {
  const channelId = input.channelId ?? session.channelId
  const modelId = input.modelId ?? session.modelId
  const extendedInput = input as SessionSendInput & { extraTools?: unknown[] }

  if (!webContents || webContents.isDestroyed()) {
    throw new Error('Agent runtime 缺少可用的 webContents')
  }

  if (!channelId) {
    webContents.send(AGENT_IPC_CHANNELS.STREAM_ERROR, {
      sessionId: session.id,
      error: '请先选择 Agent 模型渠道',
    })
    sendUnifiedSessionError(webContents, session.id, '请先选择 Agent 模型渠道')
    return
  }

  const payload: AgentSendInput = {
    sessionId: session.id,
    userMessage: input.userMessage,
    incognito: input.incognito,
    attachments: input.attachments,
    channelId,
    modelId,
    projectPath: session.project.path,
    projectProfileId: session.project.profileId,
    additionalDirectories: input.additionalDirectories ?? session.attachedDirectories,
    customMcpServers: input.customMcpServers,
    thinkingLevel: input.thinkingLevel ?? session.thinkingLevel,
    permissionModeOverride: input.permissionModeOverride,
    mentionedSkills: input.mentionedSkills,
    mentionedMcpServers: input.mentionedMcpServers,
    messageSource: input.messageSource,
    messageSourceLabel: input.messageSourceLabel,
    relatedTaskId: input.relatedTaskId,
    autoGenerateTitle: false,
    historyTurns: input.historyTurns ?? session.historyTurns,
    enabledToolIds: input.enabledToolIds ?? session.enabledToolIds,
    systemMessage: input.systemMessage,
    systemPromptId: session.systemPromptId,
    ...(extendedInput.extraTools ? { extraTools: extendedInput.extraTools } as unknown as AgentSendInput : {}),
  }

  const agentRuntime = await loadAgentRuntime()
  await emitSessionRuntimeRunStart(session, input)
  const bridgedWebContents = createSessionRuntimeBridge(webContents)
  await agentRuntime.runAgent(payload, bridgedWebContents)
}

async function defaultGenerateTitle(args: {
  session: SessionMeta
  input: SessionSendInput
}): Promise<string | null> {
  const titleRuntime = await loadSessionTitleRuntime()
  return titleRuntime.generateSessionTitleForSession({
    userMessage: args.input.userMessage,
    sessionChannelId: args.input.channelId ?? args.session.channelId,
    sessionModelId: args.input.modelId ?? args.session.modelId,
  })
}

export function findLatestCompleteUsage(
  messages: SessionMessage[],
  existingMessageIds: ReadonlySet<string> = new Set(),
): { message: SessionMessage; usage: AgentEventUsage } | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (
      message?.role !== 'assistant'
      || existingMessageIds.has(message.id)
      || !message.events?.length
    ) continue

    for (let eventIndex = message.events.length - 1; eventIndex >= 0; eventIndex -= 1) {
      const event = message.events[eventIndex]
      if (event?.type === 'complete' && typeof event.usage?.inputTokens === 'number') {
        return {
          message,
          usage: event.usage,
        }
      }
    }
  }

  return null
}

async function defaultRecordTokenUsage(args: SessionTokenUsageArgs): Promise<void> {
  const latest = findLatestCompleteUsage(args.messages, args.existingMessageIds)
  if (!latest) return

  const resolvedChannelId = args.session.channelId ?? args.input.channelId
  const resolvedModelId = latest.message.model ?? args.session.modelId ?? args.input.modelId
  const channel = resolvedChannelId ? getChannelById(resolvedChannelId) : undefined

  recordTokenUsageFromCompleteEvent({
    sessionId: args.sessionId,
    channelId: resolvedChannelId,
    channelBaseUrl: channel?.baseUrl,
    provider: channel?.provider,
    modelId: resolvedModelId,
    recordedAt: latest.message.createdAt,
    usage: latest.usage,
  })
  emitBudgetWarningIfNeeded(args.sessionId, args.webContents)
}

function emitBudgetWarningIfNeeded(sessionId: string, webContents?: WebContents): void {
  if (!webContents || webContents.isDestroyed()) return

  const settings = getSettings()
  const budgetUsd = settings.tokenMonthlyBudgetUsd
  const budgetTokens = settings.tokenMonthlyBudgetTokens
  if (!budgetUsd && !budgetTokens) return

  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const monthDays = Math.max(1, Math.ceil((now.getTime() - monthStart.getTime()) / (24 * 60 * 60 * 1000)) + 1)
  const stats = getTokenUsageStats(monthDays, now)
  const exceededUsd = Boolean(budgetUsd && stats.totals.costUsd >= budgetUsd)
  const exceededTokens = Boolean(budgetTokens && stats.totals.totalTokens >= budgetTokens)
  if (!exceededUsd && !exceededTokens) return

  const event: AgentEvent = {
    type: 'budget_warning',
    exceededUsd,
    exceededTokens,
    costUsd: stats.totals.costUsd,
    budgetUsd,
    totalTokens: stats.totals.totalTokens,
    budgetTokens,
  }

  webContents.send(SESSION_IPC_CHANNELS.STREAM_EVENT, {
    type: 'agent_event',
    sessionId,
    event,
  })
}

async function runPostRuntimeSideEffects(
  deps: SessionServiceDeps,
  args: {
    sessionId: string
    session: SessionMeta
    input: SessionSendInput
    existingMessageIds: ReadonlySet<string>
    webContents?: WebContents
  },
): Promise<void> {
  const messages = deps.getSessionMessages(args.sessionId)

  if (deps.recordTokenUsage) {
    try {
      await deps.recordTokenUsage({
        ...args,
        messages,
      })
    } catch (error) {
      log.warn('[SessionService] Token usage 统计落盘失败:', error)
    }
  }
}

export class SessionService {
  private deps: SessionServiceDeps
  private titleRequests = new Map<string, Promise<string | null>>()

  constructor(deps: SessionServiceDeps) {
    this.deps = deps
  }

  private async resetRuntimeState(sessionId: string): Promise<void> {
    await this.deps.resetAgentRuntime?.(sessionId)
    clearPiSessionState(sessionId)
  }

  private shouldAutoGenerateTitle(
    session: SessionMeta,
    input: SessionSendInput,
  ): boolean {
    if (input.skipAutoTitle) {
      return false
    }

    const currentTitle = resolveSessionTitle(session.title)
    if (!AUTO_TITLE_PLACEHOLDERS.has(currentTitle)) {
      return false
    }

    const trimmedMessage = input.userMessage.trim()
    if (!trimmedMessage || trimmedMessage.startsWith(SLASH_COMMAND_PREFIX)) {
      return false
    }

    return true
  }

  private requestGeneratedTitle(
    session: SessionMeta,
    input: SessionSendInput,
  ): Promise<string | null> {
    const existing = this.titleRequests.get(session.id)
    if (existing) {
      return existing
    }

    const task = this.deps.generateTitle({ session, input })
      .finally(() => {
        if (this.titleRequests.get(session.id) === task) {
          this.titleRequests.delete(session.id)
        }
      })

    this.titleRequests.set(session.id, task)
    return task
  }

  private applyGeneratedTitle(
    sessionId: string,
    title: string | null,
    mode: 'auto' | 'manual',
  ): string | null {
    if (!title) {
      return null
    }

    const session = this.deps.getSessionMeta(sessionId)
    if (!session) {
      return null
    }

    const currentTitle = resolveSessionTitle(session.title)
    if (mode === 'auto' && !AUTO_TITLE_PLACEHOLDERS.has(currentTitle)) {
      return currentTitle
    }

    if (title === currentTitle) {
      return title
    }

    this.deps.updateSessionMeta(sessionId, { title })
    this.deps.emitTitleUpdated({
      sessionId,
      title,
    })
    this.deps.emitSessionUpdated({
      sessionId,
      reason: 'updated',
    })
    return title
  }

  private queueAutoGenerateTitle(
    session: SessionMeta,
    input: SessionSendInput,
  ): void {
    if (!this.shouldAutoGenerateTitle(session, input)) {
      return
    }

    void this.requestGeneratedTitle(session, input)
      .then((title) => {
        this.applyGeneratedTitle(session.id, title, 'auto')
      })
      .catch((error) => {
        log.warn('[SessionService] 自动标题生成失败:', error)
      })
  }

  async regenerateTitle(sessionId: string): Promise<string | null> {
    const session = this.deps.getSessionMeta(sessionId)
    if (!session) {
      throw new Error(`Session 不存在: ${sessionId}`)
    }

    const candidate = findFirstTitleCandidate(this.deps.getSessionMessages(sessionId))
    if (!candidate) {
      return null
    }

    const title = await this.requestGeneratedTitle(session, {
      sessionId,
      userMessage: candidate.content,
    })
    return this.applyGeneratedTitle(sessionId, title, 'manual')
  }

  async regenerateTurn(sessionId: string, messageId: string, webContents?: WebContents): Promise<void> {
    const session = this.deps.getSessionMeta(sessionId)
    if (!session) {
      throw new Error(`Session 不存在: ${sessionId}`)
    }

    const messages = this.deps.getSessionMessages(sessionId)
    const plan = buildSessionTurnReplayPlan(messages, messageId)
    if (!plan) {
      throw new Error(`找不到可重生的消息 turn: ${messageId}`)
    }

    await this.stopAndWait(sessionId)
    await memoryLifecycleManager.onBeforeReset({
      sessionId,
      projectPath: session.project.path,
      messages,
    })

    this.deps.saveSessionMessages(sessionId, plan.prefixBeforeTurn)
    await this.resetRuntimeState(sessionId)
    this.deps.emitSessionUpdated({
      sessionId,
      reason: 'updated',
    })

    await this.sendMessage({
      sessionId,
      userMessage: plan.replayUserMessage.content,
      attachments: plan.replayUserMessage.attachments,
      channelId: session.channelId,
      modelId: session.modelId,
      thinkingLevel: session.thinkingLevel,
      historyTurns: session.historyTurns,
      enabledToolIds: session.enabledToolIds,
      additionalDirectories: session.attachedDirectories,
      skipAutoTitle: true,
    }, webContents)
  }

  async editTurn(input: SessionEditTurnInput, webContents?: WebContents): Promise<void> {
    const session = this.deps.getSessionMeta(input.sessionId)
    if (!session) {
      throw new Error(`Session 不存在: ${input.sessionId}`)
    }

    const messages = this.deps.getSessionMessages(input.sessionId)
    const plan = buildSessionTurnReplayPlan(messages, input.messageId)
    if (!plan) {
      throw new Error(`找不到可编辑重发的消息 turn: ${input.messageId}`)
    }

    await this.stopAndWait(input.sessionId)
    await memoryLifecycleManager.onBeforeReset({
      sessionId: input.sessionId,
      projectPath: session.project.path,
      messages,
    })

    this.deps.saveSessionMessages(input.sessionId, plan.prefixBeforeTurn)
    await this.resetRuntimeState(input.sessionId)
    this.deps.emitSessionUpdated({
      sessionId: input.sessionId,
      reason: 'updated',
    })

    await this.sendMessage({
      sessionId: input.sessionId,
      userMessage: input.userMessage,
      attachments: input.attachments,
      channelId: session.channelId,
      modelId: session.modelId,
      thinkingLevel: session.thinkingLevel,
      historyTurns: session.historyTurns,
      enabledToolIds: session.enabledToolIds,
      additionalDirectories: session.attachedDirectories,
    }, webContents)
  }

  async rewind(input: SessionRewindInput): Promise<SessionMessage[]> {
    const session = this.deps.getSessionMeta(input.sessionId)
    if (!session) throw new Error(`Session 不存在: ${input.sessionId}`)

    const messages = this.deps.getSessionMessages(input.sessionId)
    const targetIndex = messages.findIndex((message) => message.id === input.messageId)
    if (targetIndex < 0) throw new Error(`找不到要回退到的消息: ${input.messageId}`)
    if (targetIndex === messages.length - 1) return messages

    await this.stopAndWait(input.sessionId)
    await memoryLifecycleManager.onBeforeReset({
      sessionId: input.sessionId,
      projectPath: session.project.path,
      messages,
    })

    const retained = messages.slice(0, targetIndex + 1)
    this.deps.saveSessionMessages(input.sessionId, retained)
    await this.resetRuntimeState(input.sessionId)
    this.deps.emitSessionUpdated({ sessionId: input.sessionId, reason: 'updated' })
    return retained
  }

  async sendMessage(input: SessionSendInput, webContents?: WebContents): Promise<void> {
    const session = this.deps.getSessionMeta(input.sessionId)
    if (!session) {
      throw new Error(`Session 不存在: ${input.sessionId}`)
    }

    this.deps.ensureSessionProjectReady?.(session.project)

    const finalUpdates: SessionMetaUpdates = {}
    const assignIfChanged = <K extends keyof SessionMetaUpdates>(key: K, value: SessionMetaUpdates[K]): void => {
      if (typeof value === 'undefined') return
      if (session[key] === value) return
      finalUpdates[key] = value
    }

    const inputSessionUpdatedAt = Number.isFinite(input.sessionUpdatedAt)
      ? input.sessionUpdatedAt
      : undefined
    const hasStaleModelSelectionInput =
      typeof inputSessionUpdatedAt === 'number' &&
      inputSessionUpdatedAt < session.updatedAt &&
      (
        (typeof input.channelId !== 'undefined' && input.channelId !== session.channelId) ||
        (typeof input.modelId !== 'undefined' && input.modelId !== session.modelId)
      )

    const nextChannelId = hasStaleModelSelectionInput ? undefined : input.channelId
    const nextModelId = hasStaleModelSelectionInput ? undefined : input.modelId
    const nextThinkingLevel = input.thinkingLevel
    const nextHistoryTurns = input.historyTurns

    const runtimeActive = this.deps.isAgentRuntimeActive
      ? await this.deps.isAgentRuntimeActive(session.id)
      : false
    const switchesActiveRuntime = runtimeActive && switchesActiveRuntimeSelection(
      { channelId: session.channelId ?? '', modelId: session.modelId },
      { channelId: nextChannelId, modelId: nextModelId },
    )
    if (switchesActiveRuntime) {
      // 必须在持久化 SessionMeta 前拒绝，避免消息未送达但默认渠道/模型已被改写。
      throw new Error('当前任务仍在使用原渠道和模型，请等待任务结束或停止后再切换')
    }

    assignIfChanged('channelId', nextChannelId)
    assignIfChanged('modelId', nextModelId)
    assignIfChanged('thinkingLevel', nextThinkingLevel)
    assignIfChanged('historyTurns', nextHistoryTurns)
    assignIfChanged('enabledToolIds', input.enabledToolIds)
    assignIfChanged('attachedDirectories', input.additionalDirectories)
    assignIfChanged('messageSource', input.messageSource)
    assignIfChanged('messageSourceLabel', input.messageSourceLabel)
    assignIfChanged('relatedTaskId', input.relatedTaskId)

    if (!session.project.lockedAt) {
      finalUpdates.project = lockSessionProject(session.project)
    }

    let resolvedSession = session
    if (Object.keys(finalUpdates).length > 0) {
      resolvedSession = this.deps.updateSessionMeta(session.id, finalUpdates)
      this.deps.emitSessionUpdated({
        sessionId: session.id,
        reason: 'updated',
      })
    }

    const runtimeInput: SessionSendInput = {
      ...input,
      channelId: nextChannelId ?? resolvedSession.channelId,
      modelId: nextModelId ?? resolvedSession.modelId,
      thinkingLevel: input.thinkingLevel ?? resolvedSession.thinkingLevel,
      historyTurns: input.historyTurns ?? resolvedSession.historyTurns,
      enabledToolIds: input.enabledToolIds ?? resolvedSession.enabledToolIds,
      additionalDirectories: input.additionalDirectories ?? resolvedSession.attachedDirectories,
    }

    if (runtimeActive) {
      if (!this.deps.steerAgentRuntime) {
        throw new Error('当前 provider 不支持运行中干预')
      }

      await this.deps.steerAgentRuntime({
        session: resolvedSession,
        input: runtimeInput,
        webContents,
      })
      return
    }

    this.queueAutoGenerateTitle(resolvedSession, runtimeInput)

    const existingMessageIds = new Set(
      this.deps.getSessionMessages(resolvedSession.id).map((message) => message.id)
    )
    await this.deps.runAgentRuntime({
      session: resolvedSession,
      input: runtimeInput,
      webContents,
    })
    await runPostRuntimeSideEffects(this.deps, {
      sessionId: resolvedSession.id,
      session: resolvedSession,
      input: runtimeInput,
      existingMessageIds,
      webContents,
    })
  }

  stop(sessionId: string): void {
    if (!this.deps.getSessionMeta(sessionId)) return
    this.deps.stopAgentRuntime(sessionId)
  }

  async stopAndWait(sessionId: string, timeoutMs = 5000): Promise<void> {
    if (!this.deps.getSessionMeta(sessionId)) return

    if (this.deps.stopAgentRuntimeAndWait) {
      await this.deps.stopAgentRuntimeAndWait(sessionId, timeoutMs)
      return
    }

    this.deps.stopAgentRuntime(sessionId)
  }

  async queueFollowUp(sessionId: string, input: SessionSendInput, webContents?: WebContents): Promise<void> {
    const session = this.deps.getSessionMeta(sessionId)
    if (!session) {
      throw new Error(`Session 不存在: ${sessionId}`)
    }
    if (!this.deps.queueFollowUpRuntime) {
      throw new Error('当前 provider 不支持 follow-up')
    }

    const existingMessageIds = new Set(
      this.deps.getSessionMessages(sessionId).map((message) => message.id)
    )
    await this.deps.queueFollowUpRuntime({
      session,
      input,
      webContents,
    })

    if (this.deps.waitForAgentRuntimeIdle) {
      await this.deps.waitForAgentRuntimeIdle(sessionId)
      await runPostRuntimeSideEffects(this.deps, {
        sessionId,
        session,
        input,
        existingMessageIds,
        webContents,
      })
    }
  }

  async waitForIdle(sessionId: string): Promise<void> {
    if (!this.deps.getSessionMeta(sessionId)) return
    if (!this.deps.waitForAgentRuntimeIdle) {
      throw new Error('当前 provider 不支持 waitForIdle')
    }

    await this.deps.waitForAgentRuntimeIdle(sessionId)
  }
}

export function createDefaultSessionService(webContents?: WebContents): SessionService {
  return new SessionService({
    getSessionMeta,
    getSessionMessages,
    saveSessionMessages,
    updateSessionMeta,
    runAgentRuntime: defaultRunAgentRuntime,
    stopAgentRuntime: (sessionId) => {
      void loadAgentRuntime().then((agentRuntime) => {
        agentRuntime.stopAgent(sessionId)
      })
    },
    stopAgentRuntimeAndWait: async (sessionId, timeoutMs = 5000) => {
      const agentRuntime = await loadAgentRuntime()
      await agentRuntime.stopAgentAndWait(sessionId, timeoutMs)
    },
    resetAgentRuntime: async (sessionId) => {
      const agentRuntime = await loadAgentRuntime()
      await agentRuntime.resetAgentSession(sessionId)
    },
    isAgentRuntimeActive: async (sessionId) => {
      const agentRuntime = await loadAgentRuntime()
      return agentRuntime.isAgentSessionActive(sessionId)
    },
    steerAgentRuntime: async ({ session, input }) => {
      const agentRuntime = await loadAgentRuntime()
      await agentRuntime.steerAgent({
        sessionId: session.id,
        userMessage: input.userMessage,
        incognito: input.incognito,
        attachments: input.attachments,
        channelId: input.channelId ?? session.channelId ?? '',
        modelId: input.modelId ?? session.modelId,
        projectPath: session.project.path,
        projectProfileId: session.project.profileId,
        additionalDirectories: input.additionalDirectories ?? session.attachedDirectories,
        customMcpServers: input.customMcpServers,
        thinkingLevel: input.thinkingLevel ?? session.thinkingLevel,
        permissionModeOverride: input.permissionModeOverride,
        mentionedSkills: input.mentionedSkills,
        mentionedMcpServers: input.mentionedMcpServers,
        messageSource: input.messageSource,
        messageSourceLabel: input.messageSourceLabel,
        relatedTaskId: input.relatedTaskId,
        autoGenerateTitle: false,
        historyTurns: input.historyTurns ?? session.historyTurns,
        enabledToolIds: input.enabledToolIds ?? session.enabledToolIds,
        systemMessage: input.systemMessage,
        systemPromptId: session.systemPromptId,
      })
    },
    queueFollowUpRuntime: async ({ session, input }) => {
      const agentRuntime = await loadAgentRuntime()
      await agentRuntime.followUpAgent({
        sessionId: session.id,
        userMessage: input.userMessage,
        incognito: input.incognito,
        attachments: input.attachments,
        channelId: input.channelId ?? session.channelId ?? '',
        modelId: input.modelId ?? session.modelId,
        projectPath: session.project.path,
        projectProfileId: session.project.profileId,
        additionalDirectories: input.additionalDirectories ?? session.attachedDirectories,
        customMcpServers: input.customMcpServers,
        thinkingLevel: input.thinkingLevel ?? session.thinkingLevel,
        permissionModeOverride: input.permissionModeOverride,
        mentionedSkills: input.mentionedSkills,
        mentionedMcpServers: input.mentionedMcpServers,
        messageSource: input.messageSource,
        messageSourceLabel: input.messageSourceLabel,
        relatedTaskId: input.relatedTaskId,
        autoGenerateTitle: false,
        historyTurns: input.historyTurns ?? session.historyTurns,
        enabledToolIds: input.enabledToolIds ?? session.enabledToolIds,
        systemMessage: input.systemMessage,
        systemPromptId: session.systemPromptId,
      })
    },
    waitForAgentRuntimeIdle: async (sessionId) => {
      const agentRuntime = await loadAgentRuntime()
      await agentRuntime.waitForAgentIdle(sessionId)
    },
    generateTitle: defaultGenerateTitle,
    recordTokenUsage: defaultRecordTokenUsage,
    emitTitleUpdated: (payload) => {
      if (!webContents || webContents.isDestroyed()) return
      webContents.send(SESSION_IPC_CHANNELS.TITLE_UPDATED, payload)
    },
    ensureSessionProjectReady: (project) => {
      ensureSessionProjectReady(project)
    },
    emitSessionUpdated: (payload) => {
      if (!webContents || webContents.isDestroyed()) return
      webContents.send(SESSION_IPC_CHANNELS.UPDATED, payload)
    },
  })
}

export function createHeadlessSessionService(): SessionService {
  return createDefaultSessionService()
}

export async function sendSessionMessage(input: SessionSendInput, webContents: WebContents): Promise<void> {
  const service = createDefaultSessionService(webContents)
  await service.sendMessage(input, webContents)
}

export async function sendHeadlessSessionMessage(
  input: SessionSendInput,
  sink: HeadlessSessionSink,
): Promise<void> {
  const service = createHeadlessSessionService()
  await service.sendMessage(input, sink as WebContents)
}

export function stopSession(sessionId: string): void {
  const service = createDefaultSessionService()
  service.stop(sessionId)
}

export async function stopSessionAndWait(sessionId: string, timeoutMs = 5000): Promise<void> {
  const service = createDefaultSessionService()
  await service.stopAndWait(sessionId, timeoutMs)
}

export async function queueFollowUpForSession(
  sessionId: string,
  input: SessionSendInput,
  webContents?: WebContents,
): Promise<void> {
  const service = createDefaultSessionService(webContents)
  await service.queueFollowUp(sessionId, input, webContents)
}

export async function waitForSessionIdle(sessionId: string): Promise<void> {
  const service = createDefaultSessionService()
  await service.waitForIdle(sessionId)
}

export async function regenerateSessionTurn(
  input: SessionRegenerateTurnInput,
  webContents: WebContents,
): Promise<void> {
  const service = createDefaultSessionService(webContents)
  await service.regenerateTurn(input.sessionId, input.messageId, webContents)
}

export async function editSessionTurn(
  input: SessionEditTurnInput,
  webContents: WebContents,
): Promise<void> {
  const service = createDefaultSessionService(webContents)
  await service.editTurn(input, webContents)
}

export async function rewindSession(input: SessionRewindInput): Promise<SessionMessage[]> {
  const service = createDefaultSessionService()
  return service.rewind(input)
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

export async function generateSessionTitleForSession(
  sessionId: string,
  webContents?: WebContents,
): Promise<string | null> {
  const service = createDefaultSessionService(webContents)
  return service.regenerateTitle(sessionId)
}
