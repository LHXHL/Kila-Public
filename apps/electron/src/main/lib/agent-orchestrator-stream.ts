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
import type { PiAgentQueryOptions } from './adapters/pi-agent-adapter'
import { friendlyErrorMessage, isPromptTooLongError } from './adapters/pi-agent-adapter'
import type { AgentEventBus } from './agent-event-bus'
import { appendAgentMessage, getAgentMessages, touchAgentSession } from './agent-message-store'
import { getSessionMessages, saveSessionMessages } from './session-manager'
import { createLogger } from './logger'
import { memoryLifecycleManager, shouldPersistRunMemory } from './memory/lifecycle-manager'
import { patchLatestAssistantMemoryTrace } from './memory/write-trace'
import { recordCompactionTokenUsage } from './token-usage-service'

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
type CompactNoopEvent = Extract<AgentEvent, { type: 'compact_noop' }>

/** 压缩摘要那次模型调用的 token 合计，仅用于状态卡展示。 */
function sumCompactionUsageTokens(event: CompactCompleteEvent): number {
  const usage = event.usage
  if (!usage) return 0
  return (usage.inputTokens || 0)
    + (usage.outputTokens || 0)
    + (usage.cacheReadTokens || 0)
    + (usage.cacheCreationTokens || 0)
}

function formatCompactionStatus(event: CompactCompleteEvent): string {
  const lines = [
    '上下文已压缩。Kila 已保留原始 JSONL 历史，并将 Pi runtime 的压缩结果作为后续模型上下文边界。',
  ]

  const meta: string[] = []
  if (event.reason) meta.push(`reason=${event.reason}`)
  if (typeof event.tokensBefore === 'number') meta.push(`tokensBefore=${event.tokensBefore}`)
  if (typeof event.estimatedTokensAfter === 'number') meta.push(`tokensAfter=${event.estimatedTokensAfter}`)
  const summaryTokens = sumCompactionUsageTokens(event)
  if (summaryTokens > 0) meta.push(`summaryTokens=${summaryTokens}`)
  if (event.firstKeptEntryId) meta.push(`firstKeptEntryId=${event.firstKeptEntryId}`)
  if (typeof event.willRetry === 'boolean') meta.push(`willRetry=${event.willRetry}`)
  if (meta.length > 0) lines.push(meta.join(' · '))

  if (event.summaryText) {
    lines.push(`summary: ${event.summaryText.slice(0, 1200)}`)
  }

  return lines.join('\n')
}

function formatCompactionNoopStatus(event: CompactNoopEvent): string {
  return `未执行上下文压缩：${event.message}`
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

const COMPACTION_AUTO_CONTINUE_STATUS =
  '检测到回复在上下文压缩前被截断，已自动继续完成剩余任务。'

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

  let activeModel = resolvedModel
  let attemptBuffer = createAttemptBuffer(activeModel)
  // Pi 内部自动重试的当前 attempt 编号，用于识别“新 attempt”并只在切换时重置一次持久化缓冲。
  let lastPersistedRetryAttempt: number | undefined
  // 本轮最终 complete 事件的 stopReason；'length' 表示回复被 maxTokens 截断。
  let lastStopReason: string | undefined
  // 压缩后自动续跑只允许一次，防止「截断 → 压缩 → 续跑」退化成无限循环。
  let autoContinueUsed = false
  let activeQueryOptions = queryOptions
  // 本轮尚未落盘的压缩事件。一轮内可能压缩多次，逐条落盘避免漏计。
  const pendingCompactionEvents: CompactCompleteEvent[] = []
  let lastCompactionNoopEvent: CompactNoopEvent | null = null
  let terminalError: string | null = null

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
        onComplete(completeWithPostRun(), 'stopped')
        return
      }
    }

    let shouldRetry = false

    try {
      for await (const event of adapter.query(activeQueryOptions)) {
        if (!canContinue(sessionId)) break

        const timelineEvent = stampTimelineEvent(event)

        if (timelineEvent.type === 'typed_error') {
          const isRetryableError = isAutoRetryableTypedError(timelineEvent.error)

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
          onComplete(completeWithPostRun(), 'error')
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
          lastCompactionNoopEvent = null
          recordCompactionUsage(timelineEvent)
        }
        if (timelineEvent.type === 'compact_noop') {
          lastCompactionNoopEvent = timelineEvent
        }
        // 压缩失败是非终态事件：不写 terminalError，不动 onComplete 收敛。
        // Pi 的 willRetry 为真时会自动重试摘要或继续 agent 主循环，会话保持运行态直到 agent_settled。
        // 这里只清掉可能悬挂的 noop 标记，避免上一轮的良性提示压住本轮进度。
        if (timelineEvent.type === 'compact_failed') {
          lastCompactionNoopEvent = null
        }

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
        onComplete(completeWithPostRun(), 'stopped')
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
        onComplete(completeWithPostRun(), 'error')
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
        autoContinueUsed = true
        lastStopReason = undefined
        lastCompactionNoopEvent = null
        terminalError = null
        lastPersistedRetryAttempt = undefined
        activeQueryOptions = {
          ...queryOptions,
          prompt: COMPACTION_AUTO_CONTINUE_PROMPT,
          rawPrompt: COMPACTION_AUTO_CONTINUE_PROMPT,
          promptImages: undefined,
        }
        log.info('[Agent流] 压缩前回复被截断，自动续跑一次:', sessionId)
        // 重置 attempt 让下一次迭代回到 attempt=1 重新执行（不触发外层重试的延迟与事件）。
        attempt = 0
        continue
      }

      const compactionCount = persistTurnArtifacts()
      if (compactionCount > 0) {
        if (shouldPersistRunMemory(input.incognito)) {
          await memoryLifecycleManager.onAfterCompaction({
            sessionId,
            projectPath: input.projectPath,
            messages: getAgentMessages(sessionId),
          })
        }
      } else if (lastCompactionNoopEvent) {
        appendAgentMessage(sessionId, {
          id: randomUUID(),
          role: 'status',
          content: formatCompactionNoopStatus(lastCompactionNoopEvent),
          createdAt: Date.now(),
          model: activeModel,
          events: [lastCompactionNoopEvent],
          messageSource: sourceMeta.messageSource,
          messageSourceLabel: sourceMeta.messageSourceLabel,
          relatedTaskId: sourceMeta.relatedTaskId,
        })
      }
      if (autoContinueUsed) {
        appendAgentMessage(sessionId, {
          id: randomUUID(),
          role: 'status',
          content: COMPACTION_AUTO_CONTINUE_STATUS,
          createdAt: Date.now(),
          model: activeModel,
          messageSource: sourceMeta.messageSource,
          messageSourceLabel: sourceMeta.messageSourceLabel,
          relatedTaskId: sourceMeta.relatedTaskId,
        })
      }
      touchAgentSession(sessionId)
      onComplete(completeWithPostRun())
      return
    } catch (error) {
      if (!canContinue(sessionId)) {
        persistTurnArtifacts()
        touchAgentSession(sessionId)
        onComplete(completeWithPostRun(), 'stopped')
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
      onComplete(completeWithPostRun(), 'error')
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
    onComplete(completeWithPostRun(), 'error')
  }
}
