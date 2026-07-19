/**
 * 自定义 System Prompt IPC 处理器
 */

import type {
  SystemPromptState,
  CustomSystemPrompt,
  CustomSystemPromptCreateInput,
  CustomSystemPromptUpdateInput,
} from '@kila/shared'
import { handle } from './shared'
import {
  getSystemPromptState,
  addSystemPrompt,
  updateSystemPrompt,
  deleteSystemPrompt,
  setActiveSystemPrompt,
  clearActiveSystemPrompt,
} from '../lib/system-prompt-service'

export function registerSystemPromptHandlers(): void {
  handle(
    'system-prompt:get-state',
    async (): Promise<SystemPromptState> => {
      return getSystemPromptState()
    },
  )

  handle(
    'system-prompt:add',
    async (_, input: CustomSystemPromptCreateInput): Promise<CustomSystemPrompt> => {
      return addSystemPrompt(input)
    },
  )

  handle(
    'system-prompt:update',
    async (_, input: CustomSystemPromptUpdateInput): Promise<CustomSystemPrompt> => {
      return updateSystemPrompt(input)
    },
  )

  handle(
    'system-prompt:delete',
    async (_, id: string): Promise<void> => {
      return deleteSystemPrompt(id)
    },
  )

  handle(
    'system-prompt:set-active',
    async (_, id: string): Promise<SystemPromptState> => {
      return setActiveSystemPrompt(id)
    },
  )

  handle(
    'system-prompt:clear-active',
    async (): Promise<SystemPromptState> => {
      return clearActiveSystemPrompt()
    },
  )
}
