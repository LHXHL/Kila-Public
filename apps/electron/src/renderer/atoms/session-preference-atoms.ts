/**
 * Session-scoped renderer preference atoms
 *
 * 该模块只承载
 * 单一 Session/Agent 壳层使用的会话偏好状态。
 */

import { atom } from 'jotai'
import type { ThinkingLevel } from '@kila/shared'
import { agentChannelIdAtom, agentModelIdAtom } from './agent-ui-atoms'

export interface SelectedModel {
  channelId: string
  modelId: string
}

export type ContextLengthValue = 0 | 5 | 10 | 15 | 20 | 'infinite'

export const CONTEXT_LENGTH_OPTIONS: ContextLengthValue[] = [0, 5, 10, 15, 20, 'infinite']

/** 全局默认模型（派生自 IPC-backed agentChannelIdAtom / agentModelIdAtom） */
export const selectedModelAtom = atom<SelectedModel | null, [SelectedModel | null], void>(
  (get) => {
    const channelId = get(agentChannelIdAtom)
    const modelId = get(agentModelIdAtom)
    if (channelId && modelId) return { channelId, modelId }
    return null
  },
  (_get, set, model: SelectedModel | null) => {
    set(agentChannelIdAtom, model?.channelId ?? null)
    set(agentModelIdAtom, model?.modelId ?? null)
  },
)

/** per-session 模型选择 */
export const sessionModelPreferencesAtom = atom<Map<string, SelectedModel | null>>(new Map())

/** per-session 历史轮数 */
export const sessionContextLengthPreferencesAtom = atom<Map<string, ContextLengthValue>>(new Map())

/** per-session 思考等级 */
export const sessionThinkingLevelPreferencesAtom = atom<Map<string, ThinkingLevel>>(new Map())

/** per-session 双栏显示偏好 */
export const sessionParallelModePreferencesAtom = atom<Map<string, boolean>>(new Map())
