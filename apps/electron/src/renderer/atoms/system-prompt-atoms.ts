/**
 * 自定义 System Prompt Atoms
 *
 * 管理用户自建的系统提示词预设列表和当前激活状态。
 */

import { atom } from 'jotai'
import type { CustomSystemPrompt, SystemPromptState } from '@kila/shared'

/** 原始状态（prompts 列表 + activePromptId） */
export const systemPromptStateAtom = atom<SystemPromptState>({
  prompts: [],
  activePromptId: null,
})

/** 所有自定义 prompt 列表 */
export const customSystemPromptsAtom = atom<CustomSystemPrompt[]>(
  (get) => get(systemPromptStateAtom).prompts,
)

/** 当前激活的 prompt ID */
export const activeSystemPromptIdAtom = atom<string | null>(
  (get) => get(systemPromptStateAtom).activePromptId,
)

/** 当前激活的 prompt 对象（可能为 null） */
export const activeSystemPromptAtom = atom<CustomSystemPrompt | null>((get) => {
  const state = get(systemPromptStateAtom)
  if (!state.activePromptId) return null
  return state.prompts.find((p) => p.id === state.activePromptId) ?? null
})

/** 是否处于自定义 Prompt 模式 */
export const isCustomPromptModeAtom = atom<boolean>(
  (get) => get(activeSystemPromptIdAtom) !== null,
)
