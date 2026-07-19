/**
 * Token 用量 Atoms
 *
 * 从流式状态中派生当前会话的累计用量，供 SessionHeader badge 消费。
 * 独立存储用量快照，不受 AgentView 清理流式状态影响。
 */

import { atom } from 'jotai'
import type { AgentEventUsage } from '@kila/shared'
import { currentSessionIdAtom } from './session-atoms'
import { agentStreamingStatesAtom } from './agent-stream-atoms'

/** 会话累计用量快照（独立于流式状态，不受清理影响） */
export const sessionUsageSnapshotsAtom = atom<Map<string, {
  cumulativeUsage?: AgentEventUsage
  inputTokens?: number
  contextWindow?: number
}>>(new Map())

/** 监听流式状态变化，自动保存用量快照 */
export const syncUsageSnapshotAtom = atom(null, (get, set) => {
  const states = get(agentStreamingStatesAtom)
  const current = new Map(get(sessionUsageSnapshotsAtom))

  for (const [sessionId, state] of states) {
    if (state.cumulativeUsage || state.inputTokens !== undefined) {
      current.set(sessionId, {
        cumulativeUsage: state.cumulativeUsage,
        inputTokens: state.inputTokens,
        contextWindow: state.contextWindow,
      })
    }
  }

  set(sessionUsageSnapshotsAtom, current)
})

/** 当前会话累计用量（只读派生 atom，优先从流式状态读取） */
export const currentSessionUsageAtom = atom<AgentEventUsage | undefined>((get) => {
  const currentId = get(currentSessionIdAtom)
  if (!currentId) return undefined

  // 优先从流式状态读取（实时更新）
  const streamState = get(agentStreamingStatesAtom).get(currentId)
  if (streamState) {
    if (streamState.cumulativeUsage) return streamState.cumulativeUsage
    // 流式进行中但尚未收到 complete — 用 inputTokens 构造临时 usage
    if (streamState.inputTokens !== undefined && streamState.inputTokens > 0) {
      return {
        inputTokens: streamState.inputTokens,
        contextWindow: streamState.contextWindow,
      }
    }
  }

  // 流式状态被清理后，从快照读取
  const snapshot = get(sessionUsageSnapshotsAtom).get(currentId)
  return snapshot?.cumulativeUsage
})

/** 当前会话上下文窗口使用百分比（0-100） */
export const contextUsagePercentAtom = atom<number | undefined>((get) => {
  const currentId = get(currentSessionIdAtom)
  if (!currentId) return undefined

  const streamState = get(agentStreamingStatesAtom).get(currentId)
  if (streamState) {
    const inputTokens = streamState.inputTokens
    const contextWindow = streamState.contextWindow
    if (inputTokens !== undefined && contextWindow !== undefined && contextWindow !== 0) {
      return Math.min(100, Math.round((inputTokens / contextWindow) * 100))
    }
  }

  // 从快照读取
  const snapshot = get(sessionUsageSnapshotsAtom).get(currentId)
  if (snapshot?.inputTokens !== undefined && snapshot?.contextWindow !== undefined && snapshot.contextWindow !== 0) {
    return Math.min(100, Math.round((snapshot.inputTokens / snapshot.contextWindow) * 100))
  }

  return undefined
})

/** 格式化 token 数量为人类可读字符串 */
export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`
  return String(count)
}

/** 格式化 USD 成本 */
export function formatCostUsd(cost: number): string {
  if (cost === 0) return '$0'
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
}
