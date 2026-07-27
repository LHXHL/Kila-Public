/**
 * Agent 流式状态 Atoms
 *
 * Jotai atom 定义。所有类型和纯函数已移至 agent-stream-utils.ts。
 */

import { atom, type Atom } from 'jotai'
import { splitLayoutAtom, type SplitLayoutState } from './tab-atoms'

// 从 utils 重新导出所有类型和纯函数，保持向后兼容
export type { ActivityStatus, ToolActivity, ActivityGroup, AgentStreamState, ThinkingProcessEntry, ToolProcessEntry, ProcessTimelineEntry, AssistantTextTimelineEntry, ProcessGroupTimelineEntry, AssistantTurnTimelineEntry } from './agent-stream-utils'
export { getActivityStatus, buildProcessTimelineEntries, buildAssistantTurnTimelineEntries, groupActivities, isActivityGroup, applyAgentEvent } from './agent-stream-utils'

import type { AgentStreamState } from './agent-stream-utils'

export const agentStreamingStatesAtom = atom<Map<string, AgentStreamState>>(new Map())

// ============================================================================
// 单会话流式状态派生 atom family
// ============================================================================

const agentSessionStreamStateAtomCache = new Map<string, Atom<AgentStreamState | undefined>>()

/**
 * 单会话流式状态派生 atom（引用稳定）
 *
 * 直接订阅 `agentStreamingStatesAtom` 会在任意会话的任意 token 到达时重渲染，
 * 因为流式监听器每个事件都会整表替换 Map。本 family 只取本会话的值：
 * Map 中该 sessionId 对应的值引用未变时，Jotai 不会通知订阅方，
 * 因此后台会话流式期间不再拖动前台会话的组件树重渲染。
 */
export function agentSessionStreamStateAtomFamily(sessionId: string): Atom<AgentStreamState | undefined> {
  const existing = agentSessionStreamStateAtomCache.get(sessionId)
  if (existing) return existing

  const created = atom<AgentStreamState | undefined>((get) => get(agentStreamingStatesAtom).get(sessionId))
  agentSessionStreamStateAtomCache.set(sessionId, created)
  return created
}

/** Session 删除后释放派生 atom 缓存，避免长期运行时保留已删除会话。 */
export function releaseAgentSessionStreamStateAtom(sessionId: string): void {
  agentSessionStreamStateAtomCache.delete(sessionId)
}

// ============================================================================
// 流式终态回收
// ============================================================================

/**
 * 会话当前是否挂载在某个可见 Pane 上
 *
 * Tab id 直接复用 sessionId（见 `openTab`），且只有被某个面板选中的 tab 才会渲染
 * `TabContent`。因此“在任一面板的 activeTabId 中出现”等价于“AgentView 已挂载”。
 */
export function isSessionVisibleInPanes(layout: SplitLayoutState, sessionId: string): boolean {
  return layout.panels.some((panel) => panel.activeTabId === sessionId)
}

/**
 * 收敛某会话的流式终态（complete / error 共用）
 *
 * - 会话在可见 Pane 中：只置 `running=false`，保留正文与工具结果，
 *   由挂载中的 AgentView 在消息重载完成后清除，避免出现空窗闪烁。
 * - 会话不在任何可见 Pane 中（IM Bridge / 定时任务 / 已关闭的会话）：
 *   没有任何 UI 需要这份过渡状态，直接删除 Map 条目并释放派生 atom 缓存。
 *   否则完整正文 + processEvents + 全部工具结果会一直滞留在内存里。
 */
export const settleAgentStreamStateAtom = atom(null, (get, set, sessionId: string) => {
  const states = get(agentStreamingStatesAtom)
  if (!states.has(sessionId)) return

  if (isSessionVisibleInPanes(get(splitLayoutAtom), sessionId)) {
    const current = states.get(sessionId)!
    if (!current.running) return
    const map = new Map(states)
    map.set(sessionId, { ...current, running: false })
    set(agentStreamingStatesAtom, map)
    return
  }

  const map = new Map(states)
  map.delete(sessionId)
  set(agentStreamingStatesAtom, map)
  releaseAgentSessionStreamStateAtom(sessionId)
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
