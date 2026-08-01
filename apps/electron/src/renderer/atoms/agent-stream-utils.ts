/**
 * Agent 流式状态纯函数与类型
 *
 * 从 agent-stream-atoms.ts 提取的所有类型定义和纯函数。
 * Atom 定义保留在 agent-stream-atoms.ts 中。
 */

import { normalizeAgentToolName, type AgentEvent, type AgentEventUsage, type RetryAttempt } from '@kila/shared'

/** processEvents 最大保留条数（超出时裁剪旧事件） */
const MAX_PROCESS_EVENTS = 500

/** 追加 processEvent，超出上限时裁剪旧事件 */
function appendProcessEvent(events: AgentEvent[], event: AgentEvent): AgentEvent[] {
  const last = events[events.length - 1]
  if (last) {
    if (last.type === 'text_delta' && event.type === 'text_delta') {
      const next = events.slice()
      next[next.length - 1] = {
        ...last,
        text: last.text + event.text,
      }
      return next
    }

    if (
      last.type === 'thinking_delta'
      && event.type === 'thinking_delta'
      && last.contentIndex === event.contentIndex
      && last.turnId === event.turnId
      && last.parentToolUseId === event.parentToolUseId
    ) {
      const next = events.slice()
      next[next.length - 1] = {
        ...last,
        text: last.text + event.text,
      }
      return next
    }

    if (
      last.type === 'tool_update'
      && event.type === 'tool_update'
      && last.toolUseId === event.toolUseId
      && last.turnId === event.turnId
      && last.parentToolUseId === event.parentToolUseId
    ) {
      const next = events.slice()
      next[next.length - 1] = {
        ...last,
        toolName: event.toolName ?? last.toolName,
        partialText: last.partialText + event.partialText,
      }
      return next
    }
  }

  const next = [...events, event]
  return next.length > MAX_PROCESS_EVENTS ? next.slice(-MAX_PROCESS_EVENTS) : next
}


function upsertRetryAttempt(history: RetryAttempt[], attempt: RetryAttempt): RetryAttempt[] {
  const existingIndex = history.findIndex((item) => item.attempt === attempt.attempt)
  if (existingIndex < 0) return [...history, attempt]

  const next = history.slice()
  next[existingIndex] = attempt
  return next
}

/** 活动状态 */
export type ActivityStatus = 'pending' | 'running' | 'completed' | 'error' | 'backgrounded'

/** 工具活动状态 */
export interface ToolActivity {
  toolUseId: string
  toolName: string
  input: Record<string, unknown>
  intent?: string
  displayName?: string
  partialResult?: string
  result?: string
  isError?: boolean
  done: boolean
  parentToolUseId?: string
  elapsedSeconds?: number
  taskId?: string
  shellId?: string
  isBackground?: boolean
  /** MCP 工具返回的图片附件 */
  imageAttachments?: Array<{ localPath: string; filename: string; mediaType: string }>
}

/** 活动分组（Task 子代理） */
export interface ActivityGroup {
  parent: ToolActivity
  children: ToolActivity[]
}

/** Agent 会话的流式状态 */
export interface AgentStreamState {
  running: boolean
  content: string
  toolActivities: ToolActivity[]
  /** toolUseId → 数组索引的 O(1) 查找表 */
  toolActivityIndex?: Map<string, number>
  /** 过程事件时间线（thinking/tool/background 等实时事件） */
  processEvents: AgentEvent[]
  model?: string
  /** 当前输入 token 数（上下文使用量） */
  inputTokens?: number
  /** 模型上下文窗口大小 */
  contextWindow?: number
  /** 是否正在压缩上下文 */
  isCompacting?: boolean
  /** 摘要生成的重试进度；压缩期间没有它，界面会静默十几秒 */
  summarizationRetry?: { attempt: number; delaySeconds?: number }
  /** 流式开始时间戳（用于思考计时持久化） */
  startedAt?: number
  /** 重试状态（扩展版） */
  retrying?: {
    currentAttempt: number
    maxAttempts: number
    history: RetryAttempt[]
    failed: boolean
  }
  /** 会话累计用量（每次 complete 事件累加） */
  cumulativeUsage?: AgentEventUsage
  /** 当前运行的记忆召回摘要。 */
  memoryTrace?: Extract<AgentEvent, { type: 'memory_trace' }>['trace']
}

export interface ThinkingProcessEntry {
  kind: 'thinking'
  id: string
  contentIndex: number
  text: string
  summaryText: string
  fullText: string
  done: boolean
  startedAt?: number
  elapsedSeconds?: number
}

export interface ToolProcessEntry {
  kind: 'tool'
  id: string
  activity: ToolActivity
}

export type ProcessTimelineEntry = ThinkingProcessEntry | ToolProcessEntry

export interface AssistantTextTimelineEntry {
  kind: 'assistantText'
  id: string
  text: string
}

export interface ProcessGroupTimelineEntry {
  kind: 'process'
  id: string
  entries: ProcessTimelineEntry[]
}

export type AssistantTurnTimelineEntry = AssistantTextTimelineEntry | ProcessGroupTimelineEntry

/** 从 ToolActivity 派生状态 */
export function getActivityStatus(activity: ToolActivity): ActivityStatus {
  if (activity.isBackground) return 'backgrounded'
  if (!activity.done) return 'running'
  if (activity.isError) return 'error'
  return 'completed'
}

function normalizeThinkingText(text: string): string {
  return text.replace(/\r\n/g, '\n').trim()
}

function trimThinkingBoundary(text: string): string {
  return text.replace(/^\s+/, '').trimEnd()
}

function buildThinkingSummary(text: string): string {
  const normalized = normalizeThinkingText(text)
  if (!normalized) return ''

  const firstLine = normalized.split('\n').map((line) => line.trim()).find(Boolean) ?? normalized
  const sentenceMatch = firstLine.match(/^(.{1,72}?[。！？!?])/)
  const summary = sentenceMatch?.[1] ?? firstLine
  return summary.length > 72 ? `${summary.slice(0, 72)}…` : summary
}

function roundElapsedSeconds(startedAt?: number, endedAt?: number): number | undefined {
  if (startedAt === undefined || endedAt === undefined) return undefined
  return Math.max(0, Number(((endedAt - startedAt) / 1000).toFixed(1)))
}

function extractThinkingTail(fullText: string, consumedPrefix: string, currentText = ''): string {
  const normalizedFull = normalizeThinkingText(fullText)
  if (!normalizedFull) return ''

  const normalizedCurrent = normalizeThinkingText(currentText)
  if (normalizedCurrent && normalizedFull.endsWith(normalizedCurrent)) {
    return normalizedCurrent
  }

  const normalizedConsumed = normalizeThinkingText(consumedPrefix)
  if (normalizedConsumed && normalizedFull.startsWith(normalizedConsumed)) {
    return trimThinkingBoundary(normalizedFull.slice(normalizedConsumed.length))
  }

  return normalizedFull
}

function ensureToolEntry(
  entries: ProcessTimelineEntry[],
  toolMap: Map<string, ToolProcessEntry>,
  seed: Pick<ToolActivity, 'toolUseId' | 'toolName'> & Partial<ToolActivity>,
): ToolProcessEntry {
  const existing = toolMap.get(seed.toolUseId)
  if (existing) return existing

  const entry: ToolProcessEntry = {
    kind: 'tool',
    id: `tool-${seed.toolUseId}`,
    activity: {
      toolUseId: seed.toolUseId,
      toolName: seed.toolName,
      input: seed.input ?? {},
      intent: seed.intent,
      displayName: seed.displayName,
      result: seed.result,
      partialResult: seed.partialResult,
      isError: seed.isError,
      done: seed.done ?? false,
      parentToolUseId: seed.parentToolUseId,
      elapsedSeconds: seed.elapsedSeconds,
      taskId: seed.taskId,
      shellId: seed.shellId,
      isBackground: seed.isBackground,
      imageAttachments: seed.imageAttachments,
    },
  }
  toolMap.set(seed.toolUseId, entry)
  entries.push(entry)
  return entry
}

/**
 * 从事件流构建过程时间线（思考 + 工具）。
 */
export function buildProcessTimelineEntries(events?: AgentEvent[]): ProcessTimelineEntry[] {
  if (!events || events.length === 0) return []

  const entries: ProcessTimelineEntry[] = []
  const toolMap = new Map<string, ToolProcessEntry>()
  const toolStartedAtMap = new Map<string, number>()
  const thinkingSegmentCounts = new Map<number, number>()
  const finalizedThinkingTextByContentIndex = new Map<number, string>()
  let currentThinking: ThinkingProcessEntry | null = null

  const removeThinkingEntry = (entryId: string): void => {
    const index = entries.findIndex((entry) => entry.kind === 'thinking' && entry.id === entryId)
    if (index >= 0) entries.splice(index, 1)
  }

  const ensureCurrentThinking = (contentIndex: number, timestamp?: number): ThinkingProcessEntry => {
    if (currentThinking && currentThinking.contentIndex === contentIndex) {
      if (timestamp !== undefined && currentThinking.startedAt === undefined) {
        currentThinking.startedAt = timestamp
      }
      return currentThinking
    }

    const segmentNumber = (thinkingSegmentCounts.get(contentIndex) ?? 0) + 1
    thinkingSegmentCounts.set(contentIndex, segmentNumber)

    const entry: ThinkingProcessEntry = {
      kind: 'thinking',
      id: `thinking-${contentIndex}-${segmentNumber}`,
      contentIndex,
      text: '',
      summaryText: '',
      fullText: '',
      done: false,
      startedAt: timestamp,
    }
    entries.push(entry)
    currentThinking = entry
    return entry
  }

  const finalizeCurrentThinking = (endedAt?: number): void => {
    if (!currentThinking) return

    const fullText = normalizeThinkingText(currentThinking.fullText || currentThinking.text)
    if (!fullText) {
      removeThinkingEntry(currentThinking.id)
      currentThinking = null
      return
    }

    currentThinking.fullText = fullText
    currentThinking.text = fullText
    currentThinking.summaryText = buildThinkingSummary(fullText)
    currentThinking.done = true
    const elapsedSeconds = roundElapsedSeconds(currentThinking.startedAt, endedAt)
    if (elapsedSeconds !== undefined) {
      currentThinking.elapsedSeconds = elapsedSeconds
    }

    const previous = finalizedThinkingTextByContentIndex.get(currentThinking.contentIndex) ?? ''
    finalizedThinkingTextByContentIndex.set(currentThinking.contentIndex, previous + fullText)
    currentThinking = null
  }

  for (const event of events) {
    switch (event.type) {
      case 'thinking_start': {
        ensureCurrentThinking(event.contentIndex, event.timestamp)
        break
      }
      case 'thinking_delta': {
        const entry = ensureCurrentThinking(event.contentIndex, event.timestamp)
        entry.fullText += event.text
        entry.text = entry.fullText
        entry.summaryText = buildThinkingSummary(entry.fullText)
        break
      }
      case 'thinking_end': {
        const finalizedPrefix = finalizedThinkingTextByContentIndex.get(event.contentIndex) ?? ''
        const activeThinking = currentThinking as ThinkingProcessEntry | null
        if (activeThinking !== null && activeThinking.contentIndex === event.contentIndex) {
          const finalText = extractThinkingTail(event.text, finalizedPrefix, activeThinking.fullText)
          if (finalText) {
            activeThinking.fullText = finalText
            activeThinking.text = finalText
            activeThinking.summaryText = buildThinkingSummary(finalText)
          }
          finalizeCurrentThinking(event.timestamp)
          break
        }

        const finalText = extractThinkingTail(event.text, finalizedPrefix)
        if (!finalText) break

        const entry = ensureCurrentThinking(event.contentIndex, event.timestamp)
        entry.fullText = finalText
        entry.text = finalText
        entry.summaryText = buildThinkingSummary(finalText)
        if (entry.startedAt === undefined) {
          entry.startedAt = event.timestamp
        }
        finalizeCurrentThinking(event.timestamp)
        break
      }
      case 'tool_start': {
        finalizeCurrentThinking(event.timestamp)
        const entry = ensureToolEntry(entries, toolMap, {
          toolUseId: event.toolUseId,
          toolName: normalizeAgentToolName(event.toolName),
          input: event.input,
          intent: event.intent,
          displayName: event.displayName,
          done: false,
          parentToolUseId: event.parentToolUseId,
        })
        if (event.timestamp !== undefined) {
          toolStartedAtMap.set(event.toolUseId, event.timestamp)
        }
        entry.activity = {
          ...entry.activity,
          input: event.input,
          intent: event.intent ?? entry.activity.intent,
          displayName: event.displayName ?? entry.activity.displayName,
          parentToolUseId: event.parentToolUseId ?? entry.activity.parentToolUseId,
          done: false,
        }
        break
      }
      case 'tool_result': {
        const entry = ensureToolEntry(entries, toolMap, {
          toolUseId: event.toolUseId,
          toolName: event.toolName ? normalizeAgentToolName(event.toolName) : 'Tool',
          input: event.input ?? {},
          done: true,
        })
        const elapsedSeconds = roundElapsedSeconds(toolStartedAtMap.get(event.toolUseId), event.timestamp)
        entry.activity = {
          ...entry.activity,
          toolName: event.toolName ? normalizeAgentToolName(event.toolName) : entry.activity.toolName,
          input: event.input ?? entry.activity.input,
          result: event.result,
          partialResult: undefined,
          isError: event.isError,
          done: true,
          elapsedSeconds,
          imageAttachments: event.imageAttachments,
        }
        break
      }
      case 'tool_update': {
        const entry = ensureToolEntry(entries, toolMap, {
          toolUseId: event.toolUseId,
          toolName: event.toolName ? normalizeAgentToolName(event.toolName) : 'Tool',
          done: false,
        })
        entry.activity = {
          ...entry.activity,
          toolName: event.toolName ? normalizeAgentToolName(event.toolName) : entry.activity.toolName,
          partialResult: `${entry.activity.partialResult ?? ''}${event.partialText}`,
          done: false,
        }
        break
      }
      case 'task_backgrounded': {
        const entry = toolMap.get(event.toolUseId)
        if (entry) {
          entry.activity = {
            ...entry.activity,
            isBackground: true,
            taskId: event.taskId,
            intent: event.intent ?? entry.activity.intent,
            done: true,
          }
        }
        break
      }
      case 'shell_backgrounded': {
        const entry = toolMap.get(event.toolUseId)
        if (entry) {
          entry.activity = {
            ...entry.activity,
            isBackground: true,
            shellId: event.shellId,
            intent: event.command ?? event.intent ?? entry.activity.intent,
            done: true,
          }
        }
        break
      }
    }
  }

  const activeThinking = currentThinking as ThinkingProcessEntry | null
  if (activeThinking !== null) {
    const fullText = normalizeThinkingText(activeThinking.fullText || activeThinking.text)
    if (!fullText) {
      removeThinkingEntry(activeThinking.id)
    } else {
      activeThinking.fullText = fullText
      activeThinking.text = fullText
      activeThinking.summaryText = buildThinkingSummary(fullText)
    }
  }

  return entries
}

function isProcessTimelineEvent(event: AgentEvent): boolean {
  switch (event.type) {
    case 'thinking_start':
    case 'thinking_delta':
    case 'thinking_end':
    case 'tool_start':
    case 'tool_update':
    case 'tool_result':
    case 'task_backgrounded':
    case 'shell_backgrounded':
    case 'turn_start':
    case 'turn_end':
      return true
    default:
      return false
  }
}

type ThinkingBoundaryEvent = Extract<
  AgentEvent,
  { type: 'thinking_start' | 'thinking_delta' | 'thinking_end' }
>

function getThinkingSegmentKey(event: ThinkingBoundaryEvent): string {
  return [
    event.turnId ?? '',
    event.parentToolUseId ?? '',
    event.contentIndex,
  ].join('\u0000')
}

/**
 * Pi 某些 Provider 会在正文 text_delta 之后才发送 thinking_end。
 * UI 语义上 thinking_end 属于前面的思考段；若保留原始位置，会在正文后创建第二个思考框。
 */
function normalizeThinkingEndPlacement(events: AgentEvent[]): AgentEvent[] {
  const activeThinkingAnchors = new Map<string, number>()
  const activeThinkingAnchorsByContentIndex = new Map<number, number>()
  const movedEventIndices = new Set<number>()
  const thinkingEndsByAnchor = new Map<number, ThinkingBoundaryEvent[]>()

  events.forEach((event, index) => {
    switch (event.type) {
      case 'turn_start':
        activeThinkingAnchors.clear()
        activeThinkingAnchorsByContentIndex.clear()
        break
      case 'thinking_start':
      case 'thinking_delta':
        activeThinkingAnchors.set(getThinkingSegmentKey(event), index)
        activeThinkingAnchorsByContentIndex.set(event.contentIndex, index)
        break
      case 'thinking_end': {
        const key = getThinkingSegmentKey(event)
        const anchorIndex = activeThinkingAnchors.get(key)
          ?? activeThinkingAnchorsByContentIndex.get(event.contentIndex)
        activeThinkingAnchors.delete(key)
        activeThinkingAnchorsByContentIndex.delete(event.contentIndex)
        if (anchorIndex === undefined || anchorIndex === index - 1) break

        const anchoredEvents = thinkingEndsByAnchor.get(anchorIndex) ?? []
        anchoredEvents.push(event)
        thinkingEndsByAnchor.set(anchorIndex, anchoredEvents)
        movedEventIndices.add(index)
        break
      }
    }
  })

  if (movedEventIndices.size === 0) return events

  const normalizedEvents: AgentEvent[] = []
  events.forEach((event, index) => {
    if (!movedEventIndices.has(index)) {
      normalizedEvents.push(event)
    }
    normalizedEvents.push(...(thinkingEndsByAnchor.get(index) ?? []))
  })
  return normalizedEvents
}

/**
 * Builds the visible assistant turn in event order.
 *
 * `buildProcessTimelineEntries` intentionally renders only process cards. This
 * helper keeps assistant text in the same event stream so prose that appears
 * before or between tool calls stays in the correct visual position.
 */
export function buildAssistantTurnTimelineEntries(
  events?: AgentEvent[],
  fallbackText = '',
): AssistantTurnTimelineEntry[] {
  if ((!events || events.length === 0) && !fallbackText.trim()) return []

  const entries: AssistantTurnTimelineEntry[] = []
  const sourceEvents = normalizeThinkingEndPlacement(events ?? [])
  const hasTextDelta = sourceEvents.some((event) => event.type === 'text_delta')
  let pendingText = ''
  let pendingProcessEvents: AgentEvent[] = []
  let textBlockCount = 0
  let processBlockCount = 0
  let emittedTextBlock = false

  const flushText = (): void => {
    if (!pendingText.trim()) {
      pendingText = ''
      return
    }

    textBlockCount += 1
    emittedTextBlock = true
    entries.push({
      kind: 'assistantText',
      id: `assistant-text-${textBlockCount}`,
      text: pendingText,
    })
    pendingText = ''
  }

  const flushProcess = (): void => {
    if (pendingProcessEvents.length === 0) return

    const processEntries = buildProcessTimelineEntries(pendingProcessEvents)
    pendingProcessEvents = []
    if (processEntries.length === 0) return

    processBlockCount += 1
    entries.push({
      kind: 'process',
      id: `process-${processBlockCount}`,
      entries: processEntries,
    })
  }

  for (const event of sourceEvents) {
    if (event.type === 'text_delta') {
      flushProcess()
      pendingText += event.text
      continue
    }

    if (event.type === 'text_complete') {
      if (hasTextDelta || !event.text.trim()) continue

      flushProcess()
      pendingText = event.text
      if (event.isIntermediate) {
        flushText()
      }
      continue
    }

    if (isProcessTimelineEvent(event)) {
      flushText()
      pendingProcessEvents.push(event)
    }
  }

  flushProcess()
  flushText()

  if (!emittedTextBlock && fallbackText.trim()) {
    entries.push({
      kind: 'assistantText',
      id: 'assistant-text-fallback',
      text: fallbackText,
    })
  }

  return entries
}

function mergeTodoWrites(activities: ToolActivity[]): ToolActivity[] {
  const todoWrites: ToolActivity[] = []
  const others: ToolActivity[] = []

  for (const activity of activities) {
    if (normalizeAgentToolName(activity.toolName) === 'TodoWrite') {
      todoWrites.push(activity)
    } else {
      others.push(activity)
    }
  }

  if (todoWrites.length === 0) return activities

  const latest = todoWrites[todoWrites.length - 1]!
  const allDone = todoWrites.every((item) => item.done)

  const merged: ToolActivity = {
    ...latest,
    done: allDone,
    isError: allDone && todoWrites.some((item) => item.isError),
  }

  return [...others, merged]
}

export function groupActivities(activities: ToolActivity[]): Array<ActivityGroup | ToolActivity> {
  const filtered = activities.filter((activity) => {
    if (activity.done && Object.keys(activity.input).length === 0 && !activity.result) return false
    return true
  })
  const processed = mergeTodoWrites(filtered)

  const parentIds = new Set<string>()
  for (const activity of processed) {
    if (normalizeAgentToolName(activity.toolName) === 'Task') parentIds.add(activity.toolUseId)
  }

  const childrenMap = new Map<string, ToolActivity[]>()
  const topLevel: Array<ActivityGroup | ToolActivity> = []

  for (const activity of processed) {
    if (activity.parentToolUseId && parentIds.has(activity.parentToolUseId)) {
      const children = childrenMap.get(activity.parentToolUseId) ?? []
      children.push(activity)
      childrenMap.set(activity.parentToolUseId, children)
    } else {
      topLevel.push(activity)
    }
  }

  return topLevel.map((item) => {
    if ('toolUseId' in item && parentIds.has(item.toolUseId)) {
      const children = childrenMap.get(item.toolUseId) ?? []
      return { parent: item, children: mergeTodoWrites(children) } satisfies ActivityGroup
    }
    return item
  })
}

export function isActivityGroup(item: ActivityGroup | ToolActivity): item is ActivityGroup {
  return 'parent' in item && 'children' in item
}

// ===== toolActivityIndex O(1) 查找辅助 =====

function updateToolActivity(
  activities: ToolActivity[],
  index: Map<string, number> | undefined,
  toolUseId: string,
  updater: (activity: ToolActivity) => ToolActivity,
): { activities: ToolActivity[]; index: Map<string, number>; found: boolean } {
  const idx = index?.get(toolUseId)
  if (idx !== undefined) {
    const updated = activities.slice()
    updated[idx] = updater(updated[idx]!)
    return { activities: updated, index: index!, found: true }
  }
  return { activities, index: index ?? new Map(), found: false }
}

function appendToolActivity(
  activities: ToolActivity[],
  index: Map<string, number> | undefined,
  activity: ToolActivity,
): { activities: ToolActivity[]; index: Map<string, number> } {
  const next = [...activities, activity]
  const nextIndex = new Map(index ?? [])
  nextIndex.set(activity.toolUseId, next.length - 1)
  return { activities: next, index: nextIndex }
}

/**
 * 处理 AgentEvent 并更新流式状态（纯函数）
 */
export function applyAgentEvent(prev: AgentStreamState, event: AgentEvent): AgentStreamState {
  switch (event.type) {
    case 'memory_trace':
      return { ...prev, memoryTrace: event.trace }

    case 'context_snapshot':
      return {
        ...prev,
        inputTokens: prev.inputTokens ?? event.snapshot.estimatedInputTokens,
        contextWindow: prev.contextWindow ?? event.snapshot.contextWindow,
        model: prev.model ?? event.snapshot.modelId,
      }

    case 'thinking_start':
    case 'thinking_delta':
    case 'thinking_end':
    case 'turn_start':
    case 'turn_end':
      return {
        ...prev,
        processEvents: appendProcessEvent(prev.processEvents, event),
      }

    case 'text_delta':
      return {
        ...prev,
        content: prev.content + event.text,
        processEvents: appendProcessEvent(prev.processEvents, event),
      }

    case 'text_complete':
      return {
        ...prev,
        // toolUse 中间轮次只结束当前文本段，不应覆盖后续最终正文；
        // 某些 Provider 的空 message_end 只表示边界，不应清空已有正文。
        content: event.isIntermediate || !event.text ? prev.content : event.text,
        processEvents: appendProcessEvent(prev.processEvents, event),
      }

    case 'tool_start': {
      const result = updateToolActivity(prev.toolActivities, prev.toolActivityIndex, event.toolUseId, (a) => ({
        ...a,
        input: event.input,
        intent: event.intent || a.intent,
        displayName: event.displayName || a.displayName,
      }))
      if (result.found) {
        return {
          ...prev,
          toolActivities: result.activities,
          toolActivityIndex: result.index,
          processEvents: appendProcessEvent(prev.processEvents, event),
          retrying: undefined,
        }
      }
      const appended = appendToolActivity(prev.toolActivities, prev.toolActivityIndex, {
        toolUseId: event.toolUseId,
        toolName: normalizeAgentToolName(event.toolName),
        input: event.input,
        intent: event.intent,
        displayName: event.displayName,
        done: false,
        parentToolUseId: event.parentToolUseId,
      })
      return {
        ...prev,
        toolActivities: appended.activities,
        toolActivityIndex: appended.index,
        processEvents: appendProcessEvent(prev.processEvents, event),
        retrying: undefined,
      }
    }

    case 'tool_result': {
      const result = updateToolActivity(prev.toolActivities, prev.toolActivityIndex, event.toolUseId, (a) => ({
        ...a,
        result: event.result,
        partialResult: undefined,
        isError: event.isError,
        done: true,
        imageAttachments: event.imageAttachments,
      }))
      if (result.found) {
        return {
          ...prev,
          toolActivities: result.activities,
          toolActivityIndex: result.index,
          processEvents: appendProcessEvent(prev.processEvents, event),
        }
      }
      const appended = appendToolActivity(prev.toolActivities, prev.toolActivityIndex, {
        toolUseId: event.toolUseId,
        toolName: event.toolName ? normalizeAgentToolName(event.toolName) : 'Tool',
        input: event.input ?? {},
        result: event.result,
        partialResult: undefined,
        isError: event.isError,
        done: true,
        imageAttachments: event.imageAttachments,
      })
      return {
        ...prev,
        toolActivities: appended.activities,
        toolActivityIndex: appended.index,
        processEvents: appendProcessEvent(prev.processEvents, event),
      }
    }

    case 'tool_update': {
      const result = updateToolActivity(prev.toolActivities, prev.toolActivityIndex, event.toolUseId, (a) => ({
        ...a,
        toolName: event.toolName ? normalizeAgentToolName(event.toolName) : a.toolName,
        partialResult: `${a.partialResult ?? ''}${event.partialText}`,
        done: false,
      }))
      if (result.found) {
        return {
          ...prev,
          toolActivities: result.activities,
          toolActivityIndex: result.index,
          processEvents: appendProcessEvent(prev.processEvents, event),
        }
      }

      const appended = appendToolActivity(prev.toolActivities, prev.toolActivityIndex, {
        toolUseId: event.toolUseId,
        toolName: event.toolName ? normalizeAgentToolName(event.toolName) : 'Tool',
        input: {},
        partialResult: event.partialText,
        done: false,
      })
      return {
        ...prev,
        toolActivities: appended.activities,
        toolActivityIndex: appended.index,
        processEvents: appendProcessEvent(prev.processEvents, event),
      }
    }

    case 'task_backgrounded': {
      const result = updateToolActivity(prev.toolActivities, prev.toolActivityIndex, event.toolUseId, (a) => ({
        ...a,
        isBackground: true,
        taskId: event.taskId,
        intent: event.intent ?? a.intent,
        done: true,
      }))
      return {
        ...prev,
        toolActivities: result.activities,
        toolActivityIndex: result.index,
        processEvents: appendProcessEvent(prev.processEvents, event),
      }
    }

    case 'shell_backgrounded': {
      const result = updateToolActivity(prev.toolActivities, prev.toolActivityIndex, event.toolUseId, (a) => ({
        ...a,
        isBackground: true,
        shellId: event.shellId,
        intent: event.command ?? event.intent ?? a.intent,
        done: true,
      }))
      return {
        ...prev,
        toolActivities: result.activities,
        toolActivityIndex: result.index,
        processEvents: appendProcessEvent(prev.processEvents, event),
      }
    }

    case 'complete': {
      const prevUsage = prev.cumulativeUsage
      const nextCumulativeUsage = event.usage
        ? {
            inputTokens: (prevUsage?.inputTokens ?? 0) + (event.usage.inputTokens ?? 0),
            outputTokens: (prevUsage?.outputTokens ?? 0) + (event.usage.outputTokens ?? 0),
            cacheReadTokens: (prevUsage?.cacheReadTokens ?? 0) + (event.usage.cacheReadTokens ?? 0),
            cacheCreationTokens: (prevUsage?.cacheCreationTokens ?? 0) + (event.usage.cacheCreationTokens ?? 0),
            costUsd: (prevUsage?.costUsd ?? 0) + (event.usage.costUsd ?? 0),
            contextInputTokens: event.usage.contextInputTokens ?? prevUsage?.contextInputTokens,
            contextWindow: event.usage.contextWindow ?? prevUsage?.contextWindow,
          }
        : prevUsage

      return {
        ...prev,
        retrying: undefined,
        isCompacting: false,
        summarizationRetry: undefined,
        cumulativeUsage: nextCumulativeUsage,
      }
    }

    // 终态收敛：typed_error / error 语义一致，压缩与摘要重试提示都必须清干净
    case 'typed_error':
    case 'error':
      return {
        ...prev,
        running: false,
        isCompacting: false,
        summarizationRetry: undefined,
        retrying: prev.retrying?.failed ? prev.retrying : undefined,
      }

    case 'usage_update':
      return { ...prev, inputTokens: event.usage.inputTokens, ...(event.usage.contextWindow && { contextWindow: event.usage.contextWindow }) }

    case 'compacting':
      return { ...prev, isCompacting: true }

    case 'compact_complete':
    case 'compact_noop':
    case 'compact_failed':
      return { ...prev, isCompacting: false, summarizationRetry: undefined }

    // Pi 摘要重试：scheduled/start 保持压缩态并给出可见进度，finished 只收掉进度条
    case 'summarization_retry':
      return {
        ...prev,
        isCompacting: event.phase !== 'finished' || Boolean(prev.isCompacting),
        summarizationRetry: event.phase === 'finished' ? undefined : { attempt: event.attempt, delaySeconds: event.delaySeconds },
      }

    case 'model_resolved':
      return { ...prev, model: event.model }

    case 'retrying': {
      const isNewAttempt = prev.retrying?.currentAttempt !== event.attempt
      return {
        ...prev,
        ...(isNewAttempt && {
          content: '',
          processEvents: [],
          toolActivities: [],
          toolActivityIndex: undefined,
          memoryTrace: undefined,
          running: true,
        }),
        retrying: {
          currentAttempt: event.attempt,
          maxAttempts: event.maxAttempts,
          history: prev.retrying?.history ?? [],
          failed: false,
        },
      }
    }

    case 'retry_attempt': {
      const currentHistory = prev.retrying?.history ?? []
      return {
        ...prev,
        retrying: {
          currentAttempt: event.attemptData.attempt,
          maxAttempts: prev.retrying?.maxAttempts ?? 3,
          history: upsertRetryAttempt(currentHistory, event.attemptData),
          failed: false,
        },
      }
    }

    case 'retry_cleared':
      return { ...prev, retrying: undefined }

    case 'retry_failed': {
      const finalHistory = prev.retrying?.history ?? []
      return {
        ...prev,
        running: false,
        retrying: {
          currentAttempt: event.finalAttempt.attempt,
          maxAttempts: prev.retrying?.maxAttempts ?? 3,
          history: upsertRetryAttempt(finalHistory, event.finalAttempt),
          failed: true,
        },
      }
    }

    case 'shell_killed':
    case 'tool_use_summary':
    case 'permission_request':
    case 'permission_resolved':
    case 'ask_user_request':
    case 'ask_user_resolved':
    case 'prompt_suggestion':
      return prev

    default:
      return prev
  }
}
