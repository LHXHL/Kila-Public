/**
 * Agent Tool Atoms - Agent 工具状态管理
 *
 * 管理 Agent 模式下可用工具的列表和开关状态：
 * - agentToolsAtom: 从主进程加载的所有工具信息（唯一状态源，来自 agent-tools.json）
 * - activeToolIdsAtom: 当前实际启用的工具 ID（enabled AND available）
 */

import { atom } from 'jotai'
import type { AgentToolInfo } from '@kila/shared'

/** 从主进程加载的所有工具列表（唯一状态源） */
export const agentToolsAtom = atom<AgentToolInfo[]>([])

/**
 * 派生：当前实际启用的工具 ID 列表
 *
 * 条件：后端配置开关打开 AND 工具已配置可用
 */
export const activeToolIdsAtom = atom<string[]>((get) => {
  const allTools = get(agentToolsAtom)
  return allTools
    .filter((t) => t.enabled && t.available)
    .map((t) => t.meta.id)
})

/** 派生：是否有任何工具启用 */
export const hasActiveToolsAtom = atom<boolean>((get) => {
  return get(activeToolIdsAtom).length > 0
})
