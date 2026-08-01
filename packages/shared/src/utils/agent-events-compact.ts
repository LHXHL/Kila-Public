/**
 * Agent 事件持久化压缩
 *
 * 流式 delta（thinking_delta / tool_update）每个 token 都会产生一条事件，
 * 长会话里单条 assistant 消息可能堆数万条 1-3 字符的碎片，导致：
 *   1. JSONL 体积膨胀（单条消息可达数 MB）
 *   2. 渲染层回放 timeline 时 O(n) 遍历全部碎片
 *
 * 本模块在持久化前把连续的同段 delta 合并成少量带完整文本的事件，
 * 渲染层（buildAssistantTurnTimelineEntries）是字符串拼接，
 * 聚合后产出与碎片格式完全等价，向后兼容天然成立。
 *
 * 注意：events 仅用于 UI 回放，Pi runtime 续跑只读 tool_start / tool_result，
 * 故合并 thinking_delta 对上下文与压缩逻辑无影响。
 */

import type { AgentEvent } from '../types'

type CompactSlot = AgentEvent | null

/**
 * 持久化前压缩事件：
 *   - thinking_delta：同段（contentIndex + turnId + parentToolUseId）连续碎片合并为一条
 *   - tool_update：同一 toolUseId 的中间输出合并为一条；已有最终 tool_result 时删除中间项
 *
 * thinking_start / thinking_end / tool_start / tool_result 等边界事件原样保留，
 * 它们承载的 timestamp 是「思考耗时」等 UI 展示的依据。
 */
export function compactAgentEventsForPersistence(
  events: readonly AgentEvent[],
): AgentEvent[] {
  // 快速短路：delta 数量未超阈值时无需压缩
  if (!needsCompaction(events)) return [...events]

  const compacted: CompactSlot[] = []
  const toolUpdateIndexes = new Map<string, number>()

  for (const event of events) {
    if (event.type === 'tool_start') {
      toolUpdateIndexes.delete(event.toolUseId)
      compacted.push(event)
      continue
    }

    if (event.type === 'tool_update') {
      mergeToolUpdate(compacted, toolUpdateIndexes, event)
      continue
    }

    if (event.type === 'tool_result') {
      const updateIndex = toolUpdateIndexes.get(event.toolUseId)
      if (typeof updateIndex === 'number') compacted[updateIndex] = null
      toolUpdateIndexes.delete(event.toolUseId)
      compacted.push(event)
      continue
    }

    if (event.type === 'thinking_delta') {
      mergeThinkingDelta(compacted, event)
      continue
    }

    compacted.push(event)
  }

  return compacted.filter((event): event is AgentEvent => event !== null)
}

/**
 * 判断是否值得跑压缩遍历。
 * - tool_update 只要存在就可能有「同 id 多条需合并」或「被 tool_result 删除中间项」，必须跑全量
 * - thinking_delta 可按「delta 数 vs 段边界数」短路：碎片数没超过段数时已是聚合形态
 */
function needsCompaction(events: readonly AgentEvent[]): boolean {
  let thinkingDeltaCount = 0
  let thinkingBoundaryCount = 0
  let hasToolUpdate = false
  for (const event of events) {
    if (event.type === 'thinking_delta') {
      thinkingDeltaCount += 1
    } else if (event.type === 'thinking_start' || event.type === 'thinking_end') {
      thinkingBoundaryCount += 1
    } else if (event.type === 'tool_update') {
      hasToolUpdate = true
    }
  }
  if (hasToolUpdate) return true
  return thinkingDeltaCount > thinkingBoundaryCount
}

/**
 * 合并连续的同段 thinking_delta。
 * 非同段（contentIndex/turnId/parentToolUseId 变化）或中间夹杂了其他事件时，
 * 视为新一段，保留新事件。合并后保留首条 timestamp 与完整段 key 字段。
 */
function mergeThinkingDelta(
  compacted: CompactSlot[],
  event: Extract<AgentEvent, { type: 'thinking_delta' }>,
): void {
  const last = compacted[compacted.length - 1]
  if (
    last
    && last.type === 'thinking_delta'
    && last.contentIndex === event.contentIndex
    && last.turnId === event.turnId
    && last.parentToolUseId === event.parentToolUseId
  ) {
    compacted[compacted.length - 1] = {
      ...last,
      text: last.text + event.text,
    }
    return
  }
  compacted.push(event)
}

/**
 * 合并同一 toolUseId 的 tool_update 中间输出。
 * 保留首条 timestamp，partialText 做前缀感知拼接（新的是旧的前缀时直接替换）。
 */
function mergeToolUpdate(
  compacted: CompactSlot[],
  toolUpdateIndexes: Map<string, number>,
  event: Extract<AgentEvent, { type: 'tool_update' }>,
): void {
  const existingIndex = toolUpdateIndexes.get(event.toolUseId)
  if (typeof existingIndex !== 'number') {
    toolUpdateIndexes.set(event.toolUseId, compacted.length)
    compacted.push(event)
    return
  }

  const existing = compacted[existingIndex]
  if (!existing || existing.type !== 'tool_update') {
    toolUpdateIndexes.set(event.toolUseId, compacted.length)
    compacted.push(event)
    return
  }

  const partialText = event.partialText.startsWith(existing.partialText)
    ? event.partialText
    : existing.partialText + event.partialText
  compacted[existingIndex] = {
    ...existing,
    ...event,
    partialText,
  }
}
