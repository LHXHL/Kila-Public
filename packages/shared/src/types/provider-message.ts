/** Provider message types kept for compatibility with @kila/core adapters. */

import type { FileAttachment } from './attachment'

/**
 * 消息角色
 */
export type MessageRole = 'user' | 'assistant' | 'system'

/**
 * Provider chat message shape used by legacy HTTP provider adapters.
 */
export interface ChatMessage {
  /** 消息唯一标识 */
  id: string
  /** 发送者角色 */
  role: MessageRole
  /** 消息内容 */
  content: string
  /** 创建时间戳 */
  createdAt: number
  /** 使用的模型 ID（assistant 消息） */
  model?: string
  /** 推理内容（如果模型支持） */
  reasoning?: string
  /** 是否被用户中止 */
  stopped?: boolean
  /** 文件附件列表 */
  attachments?: FileAttachment[]
  /** 工具活动记录（assistant 消息，工具调用历史） */
  toolActivities?: LegacyAgentToolActivity[]
}

/**
 * Legacy agent tool activity shape used by provider message history.
 */
export interface LegacyAgentToolActivity {
  /** 工具调用 ID */
  toolCallId: string
  /** 工具名称 */
  toolName: string
  /** 活动类型：开始 / 结果 */
  type: 'start' | 'result'
  /** 执行结果（仅 result 时存在） */
  result?: string
  /** 是否出错 */
  isError?: boolean
}
