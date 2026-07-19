/**
 * 自定义 System Prompt 服务
 *
 * 管理 ~/.kila/custom-system-prompts.json 中的用户自建提示词预设。
 * 激活某个 prompt 后，会在 buildSystemPromptAppend 中替代默认的「输出与执行约束」。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  CustomSystemPrompt,
  CustomSystemPromptCreateInput,
  CustomSystemPromptUpdateInput,
  SystemPromptState,
} from '@kila/shared'
import { getConfigDir } from './config-paths'
import { createLogger } from './logger'

const log = createLogger('SystemPrompt')

function getCustomPromptsPath(): string {
  return join(getConfigDir(), 'custom-system-prompts.json')
}

function readState(): SystemPromptState {
  const filePath = getCustomPromptsPath()
  if (!existsSync(filePath)) {
    return { prompts: [], activePromptId: null }
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as SystemPromptState
    return {
      prompts: Array.isArray(parsed.prompts) ? parsed.prompts : [],
      activePromptId: parsed.activePromptId ?? null,
    }
  } catch (error) {
    log.error('[SystemPrompt] 读取失败，回退空状态:', error)
    return { prompts: [], activePromptId: null }
  }
}

function writeState(state: SystemPromptState): void {
  const filePath = getCustomPromptsPath()
  writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8')
}

/** 获取全部 prompt 与激活状态 */
export function getSystemPromptState(): SystemPromptState {
  return readState()
}

/** 获取当前激活的自定义 prompt（无激活则返回 null） */
export function getActiveSystemPrompt(): CustomSystemPrompt | null {
  const state = readState()
  if (!state.activePromptId) return null
  return state.prompts.find(p => p.id === state.activePromptId) ?? null
}

/** 按 ID 查找自定义 prompt */
export function getSystemPromptById(id: string): CustomSystemPrompt | null {
  const state = readState()
  return state.prompts.find(p => p.id === id) ?? null
}

/** 新建自定义 prompt */
export function addSystemPrompt(input: CustomSystemPromptCreateInput): CustomSystemPrompt {
  const state = readState()
  const now = Date.now()
  const prompt: CustomSystemPrompt = {
    id: now.toString(36) + Math.random().toString(36).slice(2, 6),
    name: input.name.trim() || '未命名',
    content: input.content,
    createdAt: now,
    updatedAt: now,
  }
  state.prompts.push(prompt)
  writeState(state)
  log.info(`[SystemPrompt] 新增: ${prompt.name} (${prompt.id})`)
  return prompt
}

/** 更新已有 prompt */
export function updateSystemPrompt(input: CustomSystemPromptUpdateInput): CustomSystemPrompt {
  const state = readState()
  const index = state.prompts.findIndex(p => p.id === input.id)
  if (index === -1) {
    throw new Error(`System prompt not found: ${input.id}`)
  }
  const existing = state.prompts[index]!
  const updated: CustomSystemPrompt = {
    ...existing,
    ...(input.name !== undefined ? { name: input.name.trim() || '未命名' } : {}),
    ...(input.content !== undefined ? { content: input.content } : {}),
    updatedAt: Date.now(),
  }
  state.prompts[index] = updated
  writeState(state)
  log.info(`[SystemPrompt] 更新: ${updated.name} (${updated.id})`)
  return updated
}

/** 删除 prompt（如果是当前激活的，同时清除激活） */
export function deleteSystemPrompt(id: string): void {
  const state = readState()
  state.prompts = state.prompts.filter(p => p.id !== id)
  if (state.activePromptId === id) {
    state.activePromptId = null
  }
  writeState(state)
  log.info(`[SystemPrompt] 删除: ${id}`)
}

/** 设为激活 */
export function setActiveSystemPrompt(id: string): SystemPromptState {
  const state = readState()
  const found = state.prompts.find(p => p.id === id)
  if (!found) {
    throw new Error(`System prompt not found: ${id}`)
  }
  state.activePromptId = id
  writeState(state)
  log.info(`[SystemPrompt] 激活: ${found.name} (${id})`)
  return state
}

/** 取消激活，回到默认模式 */
export function clearActiveSystemPrompt(): SystemPromptState {
  const state = readState()
  state.activePromptId = null
  writeState(state)
  log.info('[SystemPrompt] 已清除激活，回到默认模式')
  return state
}
