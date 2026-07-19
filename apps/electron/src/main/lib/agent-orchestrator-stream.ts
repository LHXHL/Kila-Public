/**
 * AgentOrchestrator stream helpers
 *
 * 聚焦事件流消费、重试循环、消息持久化与错误处理。
 */

import { randomUUID } from 'node:crypto'
import type {
  AgentEvent,
  AgentMessage,
  AgentProviderAdapter,
  AgentRunOutcome,
  MemoryRunTrace,
  AgentSendInput,
  RetryAttempt,
  TypedError,
} from '@kila/shared'
import type { PiAgentQueryOptions } from './adapters/pi-agent-adapter'
import { friendlyErrorMessage, isPromptTooLongError } from './adapters/pi-agent-adapter'
import { AgentEventBus } from './agent-event-bus'
import { appendAgentMessage, getAgentMessages, touchAgentSession } from './agent-message-store'
import { getSessionMessages, saveSessionMessages } from './session-manager'
import { memoryLifecycleManager, shouldPersistRunMemory } from './memory/lifecycle-manager'
import { patchLatestAssistantMemoryTrace } from './memory/write-trace'

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

function formatCompactionStatus(event: CompactCompleteEvent): string {
  const lines = [
    '上下文已压缩。Kila 已保留原始 JSONL 历史，并将 Pi runtime 的压缩结果作为后续模型上下文边界。',
  ]

  const meta: string[] = []
  if (event.reason) meta.push(`reason=${event.reason}`)
  if (typeof event.tokensBefore === 'number') meta.push(`tokensBefore=${event.tokensBefore}`)
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
 * 流式进度只用于实时展示，持久化时每个工具最多保留一份未完成输出。
 * 已有最终 tool_result 时删除中间 tool_update，避免长命令输出按更新次数膨胀。
 */
export function compactAgentEventsForPersistence(events: readonly AgentEvent[]): AgentEvent[] {
  const compacted: Array<AgentEvent | null> = []
  const toolUpdateIndexes = new Map<string, number>()

  for (const event of events) {
    if (event.type === 'tool_start') {
      toolUpdateIndexes.delete(event.toolUseId)
      compacted.push(event)
      continue
    }

    if (event.type === 'tool_update') {
      const existingIndex = toolUpdateIndexes.get(event.toolUseId)
      if (typeof existingIndex !== 'number') {
        toolUpdateIndexes.set(event.toolUseId, compacted.length)
        compacted.push(event)
        continue
      }

      const existing = compacted[existingIndex]
      if (existing?.type !== 'tool_update') {
        toolUpdateIndexes.set(event.toolUseId, compacted.length)
        compacted.push(event)
        continue
      }
      const partialText = event.partialText.startsWith(existing.partialText)
        ? event.partialText
        : existing.partialText + event.partialText
      compacted[existingIndex] = {
        ...existing,
        ...event,
        partialText,
      }
      continue
    }

    if (event.type === 'tool_result') {
      const updateIndex = toolUpdateIndexes.get(event.toolUseId)
      if (typeof updateIndex === 'number') compacted[updateIndex] = null
      toolUpdateIndexes.delete(event.toolUseId)
    }
    compacted.push(event)
  }

  return compacted.filter((event): event is AgentEvent => event !== null)
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
  let lastCompactionEvent: CompactCompleteEvent | null = null
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
        persistAttemptBuffer(sessionId, attemptBuffer, activeModel, sourceMeta)
        touchAgentSession(sessionId)
        onComplete(completeWithPostRun(), 'stopped')
        return
      }
    }

    let shouldRetry = false

    try {
      for await (const event of adapter.query(queryOptions)) {
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

          persistAttemptBuffer(sessionId, attemptBuffer, activeModel, sourceMeta)
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

        if (timelineEvent.type === 'text_delta') {
          attemptBuffer.text += timelineEvent.text
        }

        if (timelineEvent.type === 'model_resolved') {
          activeModel = timelineEvent.model
          attemptBuffer.modelEvent = timelineEvent
        }

        if (timelineEvent.type === 'compact_complete') {
          lastCompactionEvent = timelineEvent
          lastCompactionNoopEvent = null
        }
        if (timelineEvent.type === 'compact_noop') {
          lastCompactionNoopEvent = timelineEvent
        }

        if (timelineEvent.type !== 'model_resolved') {
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
        persistAttemptBuffer(sessionId, attemptBuffer, activeModel, sourceMeta)
        touchAgentSession(sessionId)
        onComplete(completeWithPostRun(), 'stopped')
        return
      }

      if (attempt > 1) {
        eventBus.emit(sessionId, { type: 'retry_cleared' })
      }

      if (terminalError) {
        persistAttemptBuffer(sessionId, attemptBuffer, activeModel, sourceMeta)
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

      persistAttemptBuffer(sessionId, attemptBuffer, activeModel, sourceMeta)
      if (lastCompactionEvent) {
        appendAgentMessage(sessionId, {
          id: randomUUID(),
          role: 'status',
          content: formatCompactionStatus(lastCompactionEvent),
          createdAt: Date.now(),
          model: activeModel,
          events: [lastCompactionEvent],
          messageSource: sourceMeta.messageSource,
          messageSourceLabel: sourceMeta.messageSourceLabel,
          relatedTaskId: sourceMeta.relatedTaskId,
        })
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
      touchAgentSession(sessionId)
      onComplete(completeWithPostRun())
      return
    } catch (error) {
      if (!canContinue(sessionId)) {
        persistAttemptBuffer(sessionId, attemptBuffer, activeModel, sourceMeta)
        touchAgentSession(sessionId)
        onComplete(completeWithPostRun(), 'stopped')
        return
      }

      const errorMessage = error instanceof Error ? error.message : String(error)
      const userFacingError = isPromptTooLongError(errorMessage)
        ? '上下文过长：当前对话的上下文已超出模型限制，请压缩上下文或开启新会话'
        : friendlyErrorMessage(errorMessage)

      persistAttemptBuffer(sessionId, attemptBuffer, activeModel, sourceMeta)

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
