/**
 * AgentOrchestrator — Agent 编排层
 *
 * 从 agent-service.ts 提取的核心业务逻辑，负责：
 * - 并发守卫（同一会话不允许并行请求）
 * - 渠道查找 + API Key 解密
 * - Pi Agent 查询参数组装
 * - 用户/助手消息持久化
 * - 事件流遍历 + 文本累积 + 事件持久化
 * - 错误处理 + 部分内容保存
 *
 * 通过 EventBus 分发 AgentEvent，通过 SessionCallbacks 发送控制信号，
 * 完全解耦 Electron IPC，可独立测试（mock Adapter + EventBus）。
 */

import { randomUUID } from 'node:crypto'
import type { AgentSendInput, AgentMessage, AgentGenerateTitleInput, AgentProviderAdapter, AgentRunOutcome } from '@kila/shared'
import type { AgentEventBus } from './agent-event-bus'
import { appendAgentMessage } from './agent-message-store'
import {
  buildAgentRunContext,
  isShellRuntimeAvailable,
  resolveAgentChannelContext,
} from './agent-orchestrator-context'
import { runAgentStream } from './agent-orchestrator-stream'
import { permissionService } from './agent-permission-service'
import { askUserService } from './agent-ask-user-service'
import { hasRuntimeSelectionChanged } from './agent-runtime-selection'


// ===== 类型定义 =====

/**
 * 会话控制信号回调
 *
 * 解耦 Electron webContents，使 Orchestrator 可独立测试。
 * agent-service.ts 负责将这些回调绑定到 webContents.send()。
 */

import { createLogger } from './logger'
const log = createLogger('Agent 编排')

export interface SessionCallbacks {
  /** 发送流式错误 */
  onError: (error: string) => void
  /** 发送流式完成（携带已持久化的消息列表） */
  onComplete: (messages?: AgentMessage[], outcome?: AgentRunOutcome) => void
  /** 发送标题更新 */
  onTitleUpdated: (title: string) => void
}
type SessionTitleRuntimeModule = typeof import('./session-title-service')

interface SessionRunState {
  abortRequested: boolean
  channelId: string
  modelId?: string
  settled: Promise<void>
  resolveSettled: () => void
}

let sessionTitleRuntimeModulePromise: Promise<SessionTitleRuntimeModule> | undefined

function loadSessionTitleRuntime(): Promise<SessionTitleRuntimeModule> {
  sessionTitleRuntimeModulePromise ??= import('./session-title-service')
  return sessionTitleRuntimeModulePromise
}

function createSessionRunState(selection: Pick<AgentSendInput, 'channelId' | 'modelId'>): SessionRunState {
  let resolveSettled!: () => void
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve
  })

  return {
    abortRequested: false,
    channelId: selection.channelId,
    modelId: selection.modelId,
    settled,
    resolveSettled,
  }
}

function assertRuntimeSelectionUnchanged(
  active: SessionRunState,
  input: Pick<AgentSendInput, 'channelId' | 'modelId'>,
): void {
  if (hasRuntimeSelectionChanged(active, input)) {
    throw new Error('当前任务仍在使用原渠道和模型，请等待任务结束或停止后再切换')
  }
}

function createRuntimeUserMessage(
  input: Pick<AgentSendInput, 'userMessage' | 'attachments' | 'messageSource' | 'messageSourceLabel' | 'relatedTaskId'>,
): AgentMessage {
  // 持久化时剥离 inlineData，避免 base64 数据膨胀 JSONL
  const persistedAttachments = input.attachments?.map(({ inlineData: _, ...rest }) => rest)
  return {
    id: randomUUID(),
    role: 'user',
    content: input.userMessage,
    createdAt: Date.now(),
    attachments: persistedAttachments,
    messageSource: input.messageSource,
    messageSourceLabel: input.messageSourceLabel,
    relatedTaskId: input.relatedTaskId,
  }
}

// ===== AgentOrchestrator =====

export class AgentOrchestrator {
  private adapter: AgentProviderAdapter
  private eventBus: AgentEventBus
  private sessionRuns = new Map<string, SessionRunState>()

  constructor(adapter: AgentProviderAdapter, eventBus: AgentEventBus) {
    this.adapter = adapter
    this.eventBus = eventBus
  }

  /**
   * 生成 Agent 会话标题
   *
   * 使用 Provider 适配器系统，支持所有渠道。任何错误返回 null。
   */
  async generateTitle(input: AgentGenerateTitleInput): Promise<string | null> {
    const titleRuntime = await loadSessionTitleRuntime()
    return titleRuntime.generateSessionTitle(input)
  }

  /**
   * 发送消息并流式推送事件
   *
   * 核心编排方法，从 agent-service.ts 的 runAgent 提取。
   * 通过 EventBus 分发 AgentEvent，通过 callbacks 发送控制信号。
   */
  async sendMessage(input: AgentSendInput, callbacks: SessionCallbacks): Promise<void> {
    const {
      sessionId,
      userMessage,
      attachments,
      channelId,
      messageSource,
      messageSourceLabel,
      relatedTaskId,
    } = input

    if (this.sessionRuns.has(sessionId)) {
      log.warn(`[Agent 编排] 会话 ${sessionId} 正在处理中，拒绝新请求`)
      callbacks.onError('上一条消息仍在处理中，请稍候再试')
      return
    }

    // Shell 环境检查：不再阻塞发送，仅记录日志。
    // coding tools 会在 buildAgentRunContext 中按需跳过。
    isShellRuntimeAvailable()

    const channelContext = resolveAgentChannelContext(channelId, {
      baseUrlOverride: input.channelBaseUrlOverride,
      apiKeyOverride: input.channelApiKeyOverride,
    })
    if (!channelContext.ok) {
      callbacks.onError(channelContext.error)
      return
    }

    const runState = createSessionRunState(input)
    this.sessionRuns.set(sessionId, runState)

    try {
      appendAgentMessage(sessionId, createRuntimeUserMessage({
        userMessage,
        attachments,
        messageSource,
        messageSourceLabel,
        relatedTaskId,
      }))

      const runContext = await buildAgentRunContext(input, channelContext.value, this.eventBus)
      runState.modelId = runContext.resolvedModel

      await runAgentStream({
        input,
        adapter: this.adapter,
        eventBus: this.eventBus,
        queryOptions: runContext.queryOptions,
        resolvedModel: runContext.resolvedModel,
        memoryTrace: runContext.memoryTrace,
        shouldContinue: (id) => !this.sessionRuns.get(id)?.abortRequested,
        onError: callbacks.onError,
        onComplete: callbacks.onComplete,
      })
    } finally {
      runState.resolveSettled()
      if (this.sessionRuns.get(sessionId) === runState) {
        this.sessionRuns.delete(sessionId)
      }
      permissionService.clearSessionPending(sessionId)
      askUserService.clearSessionPending(sessionId)
    }
  }

  /**
   * 中止指定会话的 Agent 执行
   *
   * 只标记 abortRequested，并等待运行态自行 unwind。
   */
  stop(sessionId: string): void {
    const runState = this.sessionRuns.get(sessionId)
    if (!runState) return

    runState.abortRequested = true
    this.adapter.abort(sessionId)
    log.info(`[Agent 编排] 已中止会话: ${sessionId}`)
  }

  async steerMessage(input: AgentSendInput): Promise<void> {
    const runState = this.sessionRuns.get(input.sessionId)
    if (!runState || runState.abortRequested) {
      throw new Error('当前会话没有可干预的运行中任务')
    }
    assertRuntimeSelectionUnchanged(runState, input)
    if (input.attachments?.length) {
      throw new Error('运行中干预暂不支持附件，请先停止当前任务后再发送附件')
    }
    if (!this.adapter.steer) {
      throw new Error('当前 provider 不支持运行中干预')
    }

    appendAgentMessage(input.sessionId, createRuntimeUserMessage(input))
    await this.adapter.steer(input.sessionId, {
      role: 'user',
      content: input.userMessage,
    })
  }

  async followUpMessage(input: AgentSendInput): Promise<void> {
    const runState = this.sessionRuns.get(input.sessionId)
    if (!runState || runState.abortRequested) {
      throw new Error('当前会话没有可继续排队的运行中任务')
    }
    assertRuntimeSelectionUnchanged(runState, input)
    if (!this.adapter.followUp) {
      throw new Error('当前 provider 不支持 follow-up')
    }

    appendAgentMessage(input.sessionId, createRuntimeUserMessage(input))
    await this.adapter.followUp(input.sessionId, {
      role: 'user',
      content: input.userMessage,
    })
  }

  async resetSession(sessionId: string): Promise<void> {
    await this.stopAndWait(sessionId)
    await this.adapter.resetSession?.(sessionId)
  }

  async waitForIdle(sessionId: string): Promise<void> {
    const runState = this.sessionRuns.get(sessionId)
    if (!runState) return

    if (this.adapter.waitForIdle) {
      await this.adapter.waitForIdle(sessionId)
    }

    // provider idle 只代表底层模型/工具循环结束；仍需等待 Kila 完成事件消费、
    // transcript 持久化与 onComplete 回调，避免 follow-up 后置逻辑读到半成品。
    await runState.settled
  }

  async stopAndWait(sessionId: string, timeoutMs = 5000): Promise<void> {
    const runState = this.sessionRuns.get(sessionId)
    if (!runState) return

    this.stop(sessionId)

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        runState.settled,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`等待会话停止超时: ${sessionId}`))
          }, timeoutMs)
        }),
      ])
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }

  /** 检查指定会话是否正在处理中 */
  isActive(sessionId: string): boolean {
    return this.sessionRuns.has(sessionId)
  }

  /** 中止所有活跃的 Agent 会话（应用退出时调用） */
  stopAll(): void {
    if (this.sessionRuns.size === 0) return
    log.info(`[Agent 编排] 正在中止所有活跃会话 (${this.sessionRuns.size} 个)...`)
    for (const runState of this.sessionRuns.values()) {
      runState.abortRequested = true
      runState.resolveSettled()
    }
    this.adapter.dispose()
    this.sessionRuns.clear()
  }
}
