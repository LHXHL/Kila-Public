/**
 * Agent 流式状态 Atoms
 *
 * Jotai atom 定义。所有类型和纯函数已移至 agent-stream-utils.ts。
 */

import { atom } from 'jotai'
import { currentSessionIdAtom } from './session-atoms'

// 从 utils 重新导出所有类型和纯函数，保持向后兼容
export type { ActivityStatus, ToolActivity, ActivityGroup, AgentStreamState, ThinkingProcessEntry, ToolProcessEntry, ProcessTimelineEntry, AssistantTextTimelineEntry, ProcessGroupTimelineEntry, AssistantTurnTimelineEntry } from './agent-stream-utils'
export { getActivityStatus, buildProcessTimelineEntries, buildAssistantTurnTimelineEntries, groupActivities, isActivityGroup, applyAgentEvent } from './agent-stream-utils'

import type { AgentStreamState, ToolActivity } from './agent-stream-utils'

export const agentStreamingStatesAtom = atom<Map<string, AgentStreamState>>(new Map())

export const agentStreamingAtom = atom<boolean>((get) => {
  const currentId = get(currentSessionIdAtom)
  if (!currentId) return false
  return get(agentStreamingStatesAtom).get(currentId)?.running ?? false
})

export const agentStreamingContentAtom = atom<string>((get) => {
  const currentId = get(currentSessionIdAtom)
  if (!currentId) return ''
  return get(agentStreamingStatesAtom).get(currentId)?.content ?? ''
})

export const agentToolActivitiesAtom = atom<ToolActivity[]>((get) => {
  const currentId = get(currentSessionIdAtom)
  if (!currentId) return []
  return get(agentStreamingStatesAtom).get(currentId)?.toolActivities ?? []
})

export const agentStreamingModelAtom = atom<string | undefined>((get) => {
  const currentId = get(currentSessionIdAtom)
  if (!currentId) return undefined
  return get(agentStreamingStatesAtom).get(currentId)?.model
})

export const agentRetryingAtom = atom<AgentStreamState['retrying'] | undefined>((get) => {
  const currentId = get(currentSessionIdAtom)
  if (!currentId) return undefined
  return get(agentStreamingStatesAtom).get(currentId)?.retrying
})

export const agentStartedAtAtom = atom<number | undefined>((get) => {
  const currentId = get(currentSessionIdAtom)
  if (!currentId) return undefined
  return get(agentStreamingStatesAtom).get(currentId)?.startedAt
})

// 运行中会话 id 集合的引用稳定化缓存。
// agentStreamingStatesAtom 在每个 token chunk 都会变更（content 累积），若每次都返回新 Set，
// 订阅方（如 LeftSidebar 整个会话列表）会在流式期间高频重渲染，即使运行中的 id 集合并未变化。
// 仅当成员集合真正变化时才替换引用。
let cachedRunningSessionIds = new Set<string>()

export const agentRunningSessionIdsAtom = atom<Set<string>>((get) => {
  const states = get(agentStreamingStatesAtom)
  const next = new Set<string>()
  for (const [id, state] of states) {
    if (state.running) next.add(id)
  }

  if (next.size === cachedRunningSessionIds.size) {
    let identical = true
    for (const id of next) {
      if (!cachedRunningSessionIds.has(id)) {
        identical = false
        break
      }
    }
    if (identical) return cachedRunningSessionIds
  }

  cachedRunningSessionIds = next
  return next
})
