/**
 * 自定义系统提示词类型定义
 *
 * 用户可创建多个 system prompt 预设，激活其中一个后，
 * 替代默认的「输出与执行约束」注入到 Agent static system prompt。
 * SOUL.md 和 USER.md 始终保留注入。
 */

/** 单条自定义 System Prompt */
export interface CustomSystemPrompt {
  id: string
  name: string
  content: string
  createdAt: number
  updatedAt: number
}

/** System Prompt 持久化状态 */
export interface SystemPromptState {
  prompts: CustomSystemPrompt[]
  activePromptId: string | null
}

/** 创建自定义 Prompt 输入 */
export interface CustomSystemPromptCreateInput {
  name: string
  content: string
}

/** 更新自定义 Prompt 输入 */
export interface CustomSystemPromptUpdateInput {
  id: string
  name?: string
  content?: string
}

/** IPC 通道常量 */
export const SYSTEM_PROMPT_IPC_CHANNELS = {
  GET_STATE: 'system-prompt:get-state',
  ADD: 'system-prompt:add',
  UPDATE: 'system-prompt:update',
  DELETE: 'system-prompt:delete',
  SET_ACTIVE: 'system-prompt:set-active',
  CLEAR_ACTIVE: 'system-prompt:clear-active',
} as const
