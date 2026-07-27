/**
 * 自定义 System Prompt Atoms
 *
 * 管理用户自建的系统提示词预设列表和当前激活状态。
 */

import { atom } from 'jotai'
import type { SystemPromptState } from '@kila/shared'

/** 原始状态（prompts 列表 + activePromptId）— 组件直接读写本 atom */
export const systemPromptStateAtom = atom<SystemPromptState>({
  prompts: [],
  activePromptId: null,
})
