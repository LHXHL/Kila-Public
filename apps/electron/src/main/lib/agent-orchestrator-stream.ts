/**
 * AgentOrchestrator stream helpers
 *
 * 聚焦事件流消费、重试循环、消息持久化与错误处理。
 */

import { randomUUID } from 'node:crypto'
import {
  compactAgentEventsForPersistence,
  type AgentEvent,
  type AgentMessage,
  type AgentProviderAdapter,
  type AgentRunOutcome,
  type MemoryRunTrace,
  type AgentSendInput,
  type RetryAttempt,
  type TypedError,
} from '@kila/shared'
import type { PiAgentQueryOptions } from './agent-query-types'
import { friendlyErrorMessage, isPromptTooLongError } from './agent-error-utils'
import type { AgentEventBus } from './agent-event-bus'
import { appendAgentMessage, getAgentMessages, touchAgentSession } from './agent-message-store'
import { getSessionMessages, saveSessionMessages } from './session-manager'
import { createLogger } from './logger'
import { memoryLifecycleManager, shouldPersistRunMemory } from './memory/lifecycle-manager'
import { patchLatestAssistantMemoryTrace } from './memory/write-trace'
import { recordCompactionTokenUsage } from './token-usage-service'
import { writeAgentRunReceipt } from './agent-run-receipt-store'

const log = createLogger('Agent流')

const AUTO_RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  'rate_limited',
  'provider_error',
  'service_error',
  'service_unavailable',
  'network_error',
])

const MAX_AUTO_RETRIES = 3

export interface AgentStreamCallbacks {
  onError: (error: string) => void
  onComplete: (messages?: AgentMessage[], outcome?: AgentRunOutcome) => void
}

export interface RunAgentStreamInput {
  input: AgentSendInput
  adapter: AgentProviderAdapter
  eventBus: AgentEventBus
  queryOptions: PiAgentQueryOptions
  /** 本轮用户消息 id（orchestrator 落盘时显式捕获），作为续跑迭代间 persisted 确认的安全边界。 */
  turnUserMessageId: string
  resolvedModel: string
  memoryTrace: MemoryRunTrace
  shouldContinue?: (sessionId: string) => boolean
  isSessionActive?: (sessionId: string) => boolean
  onError: AgentStreamCallbacks['onError']
  onComplete: AgentStreamCallbacks['onComplete']
}

function isAutoRetryableTypedError(error: TypedError): boolean {
  return AUTO_RETRYABLE_ERROR_CODES.has(error.code)
}

function getRetryDelayMs(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt - 1), 8000)
}

type CompactCompleteEvent = Extract<AgentEvent, { type: 'compact_complete' }>

/**
 * 压缩边界 status 消息的正文。
 *
 * 上下文压缩对用户无感：对话流不展示压缩总结、token 统计或技术说明。
 * 该 status 消息仍然落盘（events 承载 compact_complete，是设置页压缩统计
 * 与 token 用量的唯一真相源），但正文置空，渲染层对无正文 status 直接跳过。
 */
function formatCompactionStatus(_event: CompactCompleteEvent): string {
  return ''
}

/**
 * 压缩后自动续跑的接力 prompt。
 *
 * Pi 的 threshold 压缩发生在 agent loop 结束之后且 willRetry 恒为 false：若本轮回复
 * 是被 maxTokens 截断的（stopReason=length），Pi 不会自动继续，任务就停在半截。
 * Kila 在压缩完成后以这条 prompt 接力一次，让模型基于压缩摘要继续未完成的部分。
 */
const COMPACTION_AUTO_CONTINUE_PROMPT =
  '上一条回复因上下文限制被截断，上下文已完成压缩。请基于压缩摘要中的进度，直接继续完成尚未完成的任务，不要重复已输出的内容。'

// HTML 注释可让控制标记不出现在 Markdown 渲染结果中。
const GOAL_COMPLETE_MARKER = '<!-- KILA_GOAL_COMPLETE -->'
const GOAL_BLOCKED_MARKER = '<!-- KILA_GOAL_BLOCKED -->'
const GOAL_CONTROL_MARKER_PATTERN = /<!-- KILA_GOAL_(?:COMPLETE|BLOCKED) -->/g
const MAX_GOAL_LOOP_ITERATIONS = 8

function stripGoalControlMarkers(text: string): string {
  return text.replaceAll(GOAL_CONTROL_MARKER_PATTERN, '')
}

function persistAssistantMessage(
  sessionId: string,
  accumulatedText: string,
  accumulatedEvents: AgentEvent[],
  resolvedModel: string,
  sourceMeta?: Pick<AgentSendInput, 'messageSource' | 'messageSourceLabel' | 'relatedTaskId'>,
): void {
  if (!accumulatedText && accumulatedEvents.length === 0) return

  const assistantMsg: AgentMessage = {
    id: randomUUID(),
    role: 'assistant',
    content: accumulatedText,
    createdAt: Date.now(),
    model: resolvedModel,
    events: compactAgentEventsForPersistence(accumulatedEvents),
    messageSource: sourceMeta?.messageSource,
    messageSourceLabel: sourceMeta?.messageSourceLabel,
    relatedTaskId: sourceMeta?.relatedTaskId,
  }
  appendAgentMessage(sessionId, assistantMsg)
}

interface AttemptBuffer {
  text: string
  events: AgentEvent[]
  modelEvent: AgentEvent
}

/**
 * Pi 内部自动重试时需要保留、不随失败 attempt 一起丢弃的事件类型。
 * 保留重试历史标记与记忆事件，丢弃上一 attempt 的思考/文本/工具等内容事件——
 * 与实时 UI 的 retrying reset（agent-stream-utils.ts）语义一致：失败重试历史保留，内容只展示一次。
 */
const RETRY_HISTORY_EVENT_TYPES: ReadonlySet<AgentEvent['type']> = new Set([
  'retrying',
  'retry_attempt',
  'retry_failed',
  'retry_cleared',
  'memory_trace',
])

/**
 * 不写入 assistant 消息 events 的事件类型（只实时推送，或由专门的消息承载）。
 *
 * - `model_resolved`：由 attemptBuffer.modelEvent 单独承载
 * - `compact_complete`：压缩边界的唯一真相源是独立的 `role: 'status'` 消息。
 *   两处同时落盘会让设置页的压缩次数、tokensBefore 累计和摘要长度统计全部翻倍。
 * - `compact_failed`：压缩未成功，无 usage / tokensBefore 可记，只用于实时清掉 UI 压缩态。
 */
const UNBUFFERED_EVENT_TYPES: ReadonlySet<AgentEvent['type']> = new Set([
  'model_resolved',
  'compact_complete',
  'compact_failed',
  'runtime_queued',
])

function createAttemptBuffer(model: string): AttemptBuffer {
  return {
    text: '',
    events: [],
    modelEvent: { type: 'model_resolved', model },
  }
}

function persistAttemptBuffer(
  sessionId: string,
  attemptBuffer: AttemptBuffer,
  resolvedModel: string,
  sourceMeta?: Pick<AgentSendInput, 'messageSource' | 'messageSourceLabel' | 'relatedTaskId'>,
): void {
  if (!attemptBuffer.text && attemptBuffer.events.length === 0) {
    return
  }

  persistAssistantMessage(
    sessionId,
    attemptBuffer.text,
    [attemptBuffer.modelEvent, ...attemptBuffer.events],
    resolvedModel,
    sourceMeta,
  )
}

export function stampTimelineEvent(event: AgentEvent): AgentEvent {
  switch (event.type) {
    case 'thinking_start':
    case 'thinking_delta':
    case 'thinking_end':
    case 'tool_start':
    case 'tool_update':
    case 'tool_result':
    case 'turn_start':
    case 'turn_end':
      return {
        ...event,
        timestamp: event.timestamp ?? Date.now(),
      }
    default:
      return event
  }
}

export async function runAgentStream({
  input,
  adapter,
  eventBus,
  queryOptions,
  turnUserMessageId,
  resolvedModel,
  memoryTrace,
  shouldContinue,
  isSessionActive,
  onError,
  onComplete,
}: RunAgentStreamInput): Promise<void> {
  const {
    sessionId,
    messageSource,
    messageSourceLabel,
    relatedTaskId,
  } = input
  const initialMessageCount = getAgentMessages(sessionId).length
  // 防御校验：显式传入的边界 id 必须确实对应本轮刚落盘的 user 消息（位置与角色双确认），
  // 不变量被破坏时 fail-fast，绝不带着错误的安全边界进入续跑确认。
  const turnStartMessage = getAgentMessages(sessionId).at(initialMessageCount - 1)
  if (turnStartMessage?.id !== turnUserMessageId || turnStartMessage?.role !== 'user') {
    throw new Error(`runtime_protocol_desync: turn 用户消息校验失败: ${turnUserMessageId}`)
  }
  // runId 语义：一次 adapter.query() = 一个 runtime run（一次 bundle + journal 闭环）。
  // goal loop / 压缩续跑 / 外层重试的每次再 query 都必须轮转 runId，
  // 否则撞 transfer bundle 唯一性与 Utility 的 completedRun 守卫。
  // runId 显式注入 activeQueryOptions，保证 stream 与 adapter 消费的是同一个 run 身份。
  let runId = queryOptions.runId ?? randomUUID()

  let activeModel = resolvedModel
  let attemptBuffer = createAttemptBuffer(activeModel)
  // Pi 内部自动重试的当前 attempt 编号，用于识别“新 attempt”并只在切换时重置一次持久化缓冲。
  let lastPersistedRetryAttempt: number | undefined
  // 本轮最终 complete 事件的 stopReason；'length' 表示回复被 maxTokens 截断。
  let lastStopReason: string | undefined
  // 压缩后自动续跑只允许一次，防止「截断 → 压缩 → 续跑」退化成无限循环。
  let autoContinueUsed = false
  let activeQueryOptions: PiAgentQueryOptions = { ...queryOptions, runId }
  let goalLoopIterations = 0
  // 本轮尚未落盘的压缩事件。一轮内可能压缩多次，逐条落盘避免漏计。
  const pendingCompactionEvents: CompactCompleteEvent[] = []
  let terminalError: string | null = null
  let runtimeSettled = true

  const sourceMeta = { messageSource, messageSourceLabel, relatedTaskId }
  const memoryTraceEvent: AgentEvent = { type: 'memory_trace', trace: memoryTrace }
  attemptBuffer.events.push(memoryTraceEvent)
  eventBus.emit(sessionId, attemptBuffer.modelEvent)
  eventBus.emit(sessionId, memoryTraceEvent)

  const persistMemoryWriteTrace = (trace: MemoryRunTrace): void => {
    const patched = patchLatestAssistantMemoryTrace(getSessionMessages(sessionId), trace)
    if (patched.patched) {
      saveSessionMessages(sessionId, patched.messages)
    }
  }

  /** 压缩摘要是一次额外的模型调用，按 compaction 来源单独计入 Token 用量。 */
  const recordCompactionUsage = (event: CompactCompleteEvent): void => {
    if (!event.usage) return
    try {
      recordCompactionTokenUsage({
        sessionId,
        channelId: input.channelId,
        channelBaseUrl: input.channelBaseUrlOverride,
        modelId: activeModel,
        usage: event.usage,
      })
    } catch (error) {
      log.warn('[Agent流] 压缩摘要 Token 用量落盘失败:', error)
    }
  }

  /**
   * 把本轮累计的压缩事件各落盘为一条 status 消息，并清空待落盘队列。
   *
   * 该 status 消息是压缩边界的唯一真相源：assistant 消息里不再重复保存 compact_complete。
   */
  const flushCompactionStatusMessages = (): number => {
    if (pendingCompactionEvents.length === 0) return 0

    const events = pendingCompactionEvents.splice(0)
    for (const event of events) {
      appendAgentMessage(sessionId, {
        id: randomUUID(),
        role: 'status',
        content: formatCompactionStatus(event),
        createdAt: Date.now(),
        model: activeModel,
        events: [event],
        messageSource: sourceMeta.messageSource,
        messageSourceLabel: sourceMeta.messageSourceLabel,
        relatedTaskId: sourceMeta.relatedTaskId,
      })
    }
    return events.length
  }

  /**
   * 收敛所有终态路径的持久化：先落 assistant 内容，再落压缩边界。
   *
   * 中止和失败路径同样要落盘压缩记录——压缩已经真实发生并消耗了 token。
   */
  const persistTurnArtifacts = (): number => {
    if (input.goalLoop) {
      attemptBuffer.text = stripGoalControlMarkers(attemptBuffer.text).trimEnd()
      attemptBuffer.events = attemptBuffer.events.map((event) => (
        event.type === 'text_delta'
          ? { ...event, text: stripGoalControlMarkers(event.text) }
          : event
      ))
    }
    persistAttemptBuffer(sessionId, attemptBuffer, activeModel, sourceMeta)
    return flushCompactionStatusMessages()
  }

  const completeWithPostRun = (): AgentMessage[] => {
    const messages = getAgentMessages(sessionId)
    if (!shouldPersistRunMemory(input.incognito)) return messages

    // memory_write 已在工具调用阶段完成持久化；这里仅做兼容队列恢复、线程同步和快照刷新，
    // 不再展示容易被误解为“仍在写入”的中间状态。
    void memoryLifecycleManager.onAgentEnd({
      sessionId,
      projectPath: input.projectPath,
      messages,
    }).then((result) => {
      const completedTrace: MemoryRunTrace = {
        ...memoryTrace,
        writeStatus: result.status,
        writtenMemoryCount: result.writtenCount,
        writeError: result.error,
      }
      persistMemoryWriteTrace(completedTrace)
      eventBus.emit(sessionId, { type: 'memory_trace', trace: completedTrace })
    })
    return getAgentMessages(sessionId)
  }

  const completePersistedRun = async (
    outcome: AgentRunOutcome,
    options?: { confirmRuntime?: boolean },
  ): Promise<void> => {
    const messages = completeWithPostRun()
    // 用户消息在进入 stream 前已经落盘；若本轮在 prompt 提交前就被中止，
    // 不能把它误当成新的 Pi 安全提交点，否则 sidecar 重建会把未提交 run 当历史导入。
    const lastMessage = messages.slice(initialMessageCount).at(-1)
    if (lastMessage) {
      writeAgentRunReceipt(sessionId, {
        runId,
        sessionId,
        outcome,
        lastMessageId: lastMessage.id,
        fullyPersisted: true,
        runtimeSettled,
        completedAt: Date.now(),
      })
      if (options?.confirmRuntime !== false) {
        try {
          // 终态收敛始终宽松：rejected / 未 settle 的 run 在 adapter 内合法 no-op
          await adapter.markRunPersisted?.(sessionId, runId, lastMessage.id)
        } catch (error: unknown) {
          // JSONL 已经完成持久化，但 Runtime 未确认 clean 边界；receipt 的 runtimeSettled
          // 声明随之失真，补写修正，让下次启动按 dirty sidecar 规则处理。
          runtimeSettled = false
          writeAgentRunReceipt(sessionId, {
            runId,
            sessionId,
            outcome,
            lastMessageId: lastMessage.id,
            fullyPersisted: true,
            runtimeSettled: false,
            completedAt: Date.now(),
          })
          log.warn('[Agent流] Runtime 持久化确认失败:', error)
        }
      }
    }
    onComplete(messages, outcome)
  }

  /**
   * 中间 run 的持久化确认：goal loop / 压缩续跑 / 外层重试在再次 query 之前，
   * 必须让 Runtime 完成上一个 run 的 settled→persisted→ack 闭环，
   * 否则下一次 run.start 会撞 bundle runId 唯一性与 completedRun 守卫。
   * strict 模式要求上一 run 确实 settle（防御“表面结束实际未 settle”的协议破坏）；
   * 宽松模式允许 rejected / 未 settle 的 run 合法缺席（adapter 内 no-op）。
   */
  const confirmRuntimeRun = async (options: { strict: boolean }): Promise<boolean> => {
    try {
      await adapter.markRunPersisted?.(sessionId, runId, turnUserMessageId, {
        requireSettledRun: options.strict,
      })
      return true
    } catch (error: unknown) {
      log.error('[Agent流] 中间 run 持久化确认失败，终止本轮续跑:', error)
      runtimeSettled = false
      return false
    }
  }

  /** 确认失败时收敛本轮为 error；跳过终态处的二次 markRunPersisted（该 run 已确认失败）。 */
  const convergeIntermediateConfirmFailure = async (): Promise<void> => {
    persistTurnArtifacts()
    appendAgentMessage(sessionId, {
      id: randomUUID(),
      role: 'status',
      content: 'Agent Runtime 确认失败，本轮续跑已终止，请重试',
      createdAt: Date.now(),
      errorCode: 'runtime_unresponsive',
      errorTitle: 'Agent Runtime 无响应',
      errorCanRetry: true,
    })
    onError('Agent Runtime 无响应：中间 run 持久化确认失败，本轮续跑已终止')
    await completePersistedRun('error', { confirmRuntime: false })
  }

  let lastRetryableError: string | undefined
  // Pi AgentSession 已拥有 provider retry / context overflow recovery；外层再次 query
  // 会把同一条用户 prompt 重复提交并造成重复回复、重复工具调用。
  const maxOuterRetries = adapter.ownsRetry ? 0 : MAX_AUTO_RETRIES
  const canContinue = (id: string): boolean => {
    if (typeof shouldContinue === 'function') {
      return shouldContinue(id)
    }
    if (typeof isSessionActive === 'function') {
      return isSessionActive(id)
    }
    return true
  }

  for (let attempt = 1; attempt <= maxOuterRetries + 1; attempt += 1) {
    if (attempt > 1) {
      const delayMs = getRetryDelayMs(attempt - 1)
      const delaySeconds = delayMs / 1000
      const attemptData: RetryAttempt = {
        attempt: attempt - 1,
        timestamp: Date.now(),
        reason: lastRetryableError ?? '未知错误',
        errorMessage: lastRetryableError ?? '',
        delaySeconds,
      }

      eventBus.emit(sessionId, {
        type: 'retrying',
        attempt: attempt - 1,
        maxAttempts: maxOuterRetries,
        delaySeconds,
        reason: lastRetryableError ?? '未知错误',
      })
      eventBus.emit(sessionId, { type: 'retry_attempt', attemptData })

      await new Promise((resolve) => setTimeout(resolve, delayMs))

      if (!canContinue(sessionId)) {
        persistTurnArtifacts()
        touchAgentSession(sessionId)
        await completePersistedRun('stopped')
        return
      }

      // 上一个失败 attempt 若已 settle（如 fatal 迟到于 settled），其 run 仍占着 completedRun；
      // 重试同样必须先确认再换 runId。宽松模式：rejected / 未 settle 的 attempt 合法缺席。
      if (!(await confirmRuntimeRun({ strict: false }))) {
        await convergeIntermediateConfirmFailure()
        return
      }
      runId = randomUUID()
      activeQueryOptions = { ...activeQueryOptions, runId }
    }

    // runtimeSettled 只描述当前（最终）run 的 settle 状态，每次迭代开始重置，
    // 避免早期迭代的 runtime 错误污染最终成功 turn 的 receipt。
    runtimeSettled = true
    let shouldRetry = false

    try {
      for await (const event of adapter.query(activeQueryOptions)) {
        if (!canContinue(sessionId)) break

        const timelineEvent = stampTimelineEvent(event)

        if (timelineEvent.type === 'typed_error') {
          const isRetryableError = isAutoRetryableTypedError(timelineEvent.error)
          if (timelineEvent.error.code.startsWith('runtime_')) runtimeSettled = false

          if (isRetryableError && attempt <= maxOuterRetries) {
            lastRetryableError = timelineEvent.error.title
              ? `${timelineEvent.error.title}: ${timelineEvent.error.message}`
              : timelineEvent.error.message
            shouldRetry = true
            break
          }

          persistTurnArtifacts()
          appendAgentMessage(sessionId, {
            id: randomUUID(),
            role: 'status',
            content: timelineEvent.error.title
              ? `${timelineEvent.error.title}: ${timelineEvent.error.message}`
              : timelineEvent.error.message,
            createdAt: Date.now(),
            errorCode: timelineEvent.error.code,
            errorTitle: timelineEvent.error.title,
            errorDetails: timelineEvent.error.details,
            errorOriginal: timelineEvent.error.originalError,
            errorCanRetry: timelineEvent.error.canRetry,
            errorActions: timelineEvent.error.actions,
          })

          if (attempt > 1 && lastRetryableError) {
            eventBus.emit(sessionId, {
              type: 'retry_failed',
              finalAttempt: {
                attempt: attempt - 1,
                timestamp: Date.now(),
                reason: lastRetryableError,
                errorMessage: timelineEvent.error.message,
                delaySeconds: 0,
              },
            })
          }

          eventBus.emit(sessionId, timelineEvent)
          const typedErrorMessage = timelineEvent.error.title
            ? `${timelineEvent.error.title}: ${timelineEvent.error.message}`
            : timelineEvent.error.message
          onError(typedErrorMessage)
          await completePersistedRun('error')
          return
        }

        if (timelineEvent.type === 'error') {
          terminalError = timelineEvent.message
        }

        // Pi 独占重试：收到新 attempt 的 retrying 时，丢弃上一 attempt 已缓冲的内容，
        // 只保留重试历史/记忆标记。否则外层循环（maxOuterRetries=0）永不重置缓冲，
        // 失败 attempt 的思考/文本会与成功 attempt 一起持久化，重载会话时出现重复思考块。
        if (timelineEvent.type === 'retrying' && timelineEvent.attempt !== lastPersistedRetryAttempt) {
          lastPersistedRetryAttempt = timelineEvent.attempt
          terminalError = null
          attemptBuffer.text = ''
          attemptBuffer.events = attemptBuffer.events.filter((bufferedEvent) =>
            RETRY_HISTORY_EVENT_TYPES.has(bufferedEvent.type),
          )
        }

        if (timelineEvent.type === 'text_delta') {
          attemptBuffer.text += timelineEvent.text
        }

        if (timelineEvent.type === 'model_resolved') {
          activeModel = timelineEvent.model
          attemptBuffer.modelEvent = timelineEvent
        }

        if (timelineEvent.type === 'complete') {
          // 记录最终 stopReason：'length' 表示回复被 maxTokens 截断，是压缩后自动续跑的触发信号。
          lastStopReason = timelineEvent.stopReason
        }

        if (timelineEvent.type === 'compact_complete') {
          pendingCompactionEvents.push(timelineEvent)
          recordCompactionUsage(timelineEvent)
        }
        // compact_failed 是非终态事件：不写 terminalError，不动 onComplete 收敛。
        // Pi 的 willRetry 为真时会自动重试摘要或继续 agent 主循环，会话保持运行态
        // 直到 agent_settled；此处无需额外处理，事件经 eventBus 实时推送清理 UI 压缩态。

        if (!UNBUFFERED_EVENT_TYPES.has(timelineEvent.type)) {
          attemptBuffer.events.push(timelineEvent)
        }
        eventBus.emit(sessionId, timelineEvent)
      }

      if (shouldRetry) {
        terminalError = null
        attemptBuffer = createAttemptBuffer(activeModel)
        attemptBuffer.events.push(memoryTraceEvent)
        continue
      }

      if (!canContinue(sessionId)) {
        persistTurnArtifacts()
        touchAgentSession(sessionId)
        await completePersistedRun('stopped')
        return
      }

      if (attempt > 1) {
        eventBus.emit(sessionId, { type: 'retry_cleared' })
      }

      if (terminalError) {
        persistTurnArtifacts()
        appendAgentMessage(sessionId, {
          id: randomUUID(),
          role: 'status',
          content: terminalError,
          createdAt: Date.now(),
          errorCode: 'unknown_error',
          errorTitle: '执行错误',
          errorOriginal: terminalError,
        })
        touchAgentSession(sessionId)
        onError(terminalError)
        await completePersistedRun('error')
        return
      }

      // 压缩后自动续跑：本轮发生过压缩且最终回复被 maxTokens 截断（Pi 的 threshold 压缩
      // willRetry 恒为 false，不会自动继续），Kila 以接力 prompt 在同一产品轮内续跑一次。
      // attemptBuffer 不落盘，两段输出最终合并为同一条 assistant 消息，避免 UI 闪烁与重复。
      if (
        pendingCompactionEvents.length > 0
        && lastStopReason === 'length'
        && !autoContinueUsed
        && canContinue(sessionId)
      ) {
        // 严格确认：能走到续跑说明上一迭代“看起来正常结束”，run 却未 settle 即协议不变量被破坏
        if (!(await confirmRuntimeRun({ strict: true }))) {
          await convergeIntermediateConfirmFailure()
          return
        }
        autoContinueUsed = true
        lastStopReason = undefined
        terminalError = null
        lastPersistedRetryAttempt = undefined
        runId = randomUUID()
        activeQueryOptions = {
          ...queryOptions,
          runId,
          prompt: COMPACTION_AUTO_CONTINUE_PROMPT,
          rawPrompt: COMPACTION_AUTO_CONTINUE_PROMPT,
          promptImages: undefined,
        }
        log.info('[Agent流] 压缩前回复被截断，自动续跑一次:', sessionId)
        // 重置 attempt 让下一次迭代回到 attempt=1 重新执行（不触发外层重试的延迟与事件）。
        attempt = 0
        continue
      }

      const goalCompleted = attemptBuffer.text.includes(GOAL_COMPLETE_MARKER)
      const goalBlocked = attemptBuffer.text.includes(GOAL_BLOCKED_MARKER)

      // /goal 使用同一 Pi runtime 继续提交自检 prompt，直到模型明确标记完成或阻塞。
      // 设置上限，避免模型无法判断完成条件时无限调用模型。
      if (
        input.goalLoop
        && !goalCompleted
        && !goalBlocked
        && goalLoopIterations < MAX_GOAL_LOOP_ITERATIONS
        && canContinue(sessionId)
      ) {
        // 严格确认：同上，未 settle 的上一迭代不允许静默续跑
        if (!(await confirmRuntimeRun({ strict: true }))) {
          await convergeIntermediateConfirmFailure()
          return
        }
        goalLoopIterations += 1
        lastStopReason = undefined
        terminalError = null
        lastPersistedRetryAttempt = undefined
        runId = randomUUID()
        activeQueryOptions = {
          ...queryOptions,
          runId,
          prompt: '请继续执行当前目标。先检查刚才的实际结果与验收标准，补齐所有尚未完成或未验证的工作；如果已经全部完成，请在回复末尾单独输出 HTML 注释 <!-- KILA_GOAL_COMPLETE -->。如果缺少关键信息、需要用户授权或遇到不可恢复错误，请说明阻塞原因，并在回复末尾单独输出 HTML 注释 <!-- KILA_GOAL_BLOCKED -->。',
          rawPrompt: '请继续执行当前目标并完成自检。',
          promptImages: undefined,
        }
        attempt = 0
        continue
      }

      let finalOutcome: AgentRunOutcome = 'success'
      let goalStopStatus: string | undefined
      if (input.goalLoop && goalBlocked) {
        finalOutcome = 'stopped'
        log.info('[Agent流] /goal 因阻塞停止:', sessionId)
      } else if (input.goalLoop && !goalCompleted) {
        finalOutcome = 'stopped'
        goalStopStatus = `已达到 ${MAX_GOAL_LOOP_ITERATIONS} 次自动续跑上限，目标尚未确认完成。`
        log.warn(`[Agent流] /goal 达到最大自动续跑次数 (${MAX_GOAL_LOOP_ITERATIONS}): ${sessionId}`)
      }

      const compactionCount = persistTurnArtifacts()
      if (goalStopStatus) {
        appendAgentMessage(sessionId, {
          id: randomUUID(),
          role: 'status',
          content: goalStopStatus,
          createdAt: Date.now(),
        })
      }
      if (compactionCount > 0) {
        if (shouldPersistRunMemory(input.incognito)) {
          await memoryLifecycleManager.onAfterCompaction({
            sessionId,
            projectPath: input.projectPath,
            messages: getAgentMessages(sessionId),
          })
        }
      }
      touchAgentSession(sessionId)
      await completePersistedRun(finalOutcome)
      return
    } catch (error) {
      // query 抛异常时 run 的 settle 状态不可知，receipt 必须保守声明
      runtimeSettled = false
      if (!canContinue(sessionId)) {
        persistTurnArtifacts()
        touchAgentSession(sessionId)
        await completePersistedRun('stopped')
        return
      }

      const errorMessage = error instanceof Error ? error.message : String(error)
      const userFacingError = isPromptTooLongError(errorMessage)
        ? '上下文过长：当前对话的上下文已超出模型限制，请压缩上下文或开启新会话'
        : friendlyErrorMessage(errorMessage)

      persistTurnArtifacts()

      appendAgentMessage(sessionId, {
        id: randomUUID(),
        role: 'status',
        content: userFacingError,
        createdAt: Date.now(),
        errorCode: isPromptTooLongError(errorMessage) ? 'prompt_too_long' : 'unknown_error',
        errorTitle: isPromptTooLongError(errorMessage) ? '上下文过长' : '执行错误',
        errorOriginal: error instanceof Error ? error.stack : String(error),
      })

      if (attempt > 1 && lastRetryableError) {
        eventBus.emit(sessionId, {
          type: 'retry_failed',
          finalAttempt: {
            attempt: attempt - 1,
            timestamp: Date.now(),
            reason: lastRetryableError,
            errorMessage: userFacingError,
            delaySeconds: 0,
          },
        })
      }

      onError(userFacingError)
      await completePersistedRun('error')
      return
    }
  }

  if (lastRetryableError) {
    eventBus.emit(sessionId, {
      type: 'retry_failed',
      finalAttempt: {
        attempt: maxOuterRetries,
        timestamp: Date.now(),
        reason: lastRetryableError,
        errorMessage: `重试 ${maxOuterRetries} 次后仍然失败`,
        delaySeconds: 0,
      },
    })

    appendAgentMessage(sessionId, {
      id: randomUUID(),
      role: 'status',
      content: `重试 ${maxOuterRetries} 次后仍然失败: ${lastRetryableError}`,
      createdAt: Date.now(),
      errorCode: 'unknown_error',
      errorTitle: '重试失败',
    })

    onError(`重试 ${maxOuterRetries} 次后仍然失败: ${lastRetryableError}`)
    await completePersistedRun('error')
  }
}
