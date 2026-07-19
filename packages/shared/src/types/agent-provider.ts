/**
 * Agent Provider 适配器接口
 *
 * 定义 Kila 自己的 Agent 接口层，让底层 SDK 可替换。
 * 当前实现：PiAgentAdapter（基于 @earendil-works/pi-agent-core）
 * 保持接口稳定，便于后续继续替换底层运行时。
 */

import type { AgentEvent } from './agent'

/**
 * Agent 查询输入（Provider 无关）
 *
 * 包含所有 Provider 都需要的通用字段。
 * SDK 特定配置通过 Adapter 的扩展输入类型传入。
 */
export interface AgentQueryInput {
  /** 会话 ID */
  sessionId: string
  /** 用户 prompt（已包含上下文注入） */
  prompt: string
  /** 模型 ID */
  model?: string
  /** Agent 工作目录 */
  cwd?: string
  /** 中止信号 */
  abortSignal?: AbortSignal
}

export interface AgentControlMessage {
  role: 'user'
  content: string
}

/**
 * Agent Provider 适配器接口
 *
 * 职责：接收查询输入，返回 AgentEvent 异步迭代流。
 * 内部负责 SDK 消息到 AgentEvent 的翻译，外部无需了解 SDK 细节。
 */
export interface AgentProviderAdapter {
  /** Adapter 是否完整拥有 provider/runtime 重试；为 true 时编排层不得重复提交 prompt。 */
  readonly ownsRetry?: boolean
  /** 发起查询，返回 AgentEvent 异步迭代流 */
  query(input: AgentQueryInput): AsyncIterable<AgentEvent>
  /** 中止指定会话的执行 */
  abort(sessionId: string): void
  /** 丢弃指定会话的内存 runtime；用于 rewind/regenerate/delete 后重建运行时真相。 */
  resetSession?(sessionId: string): Promise<void> | void
  /** 释放资源 */
  dispose(): void
  /** 运行中注入额外用户指令 */
  steer?(sessionId: string, message: AgentControlMessage): Promise<void> | void
  /** 当前运行结束后继续排队追加用户指令 */
  followUp?(sessionId: string, message: AgentControlMessage): Promise<void> | void
  /** 等待 provider session 彻底 idle */
  waitForIdle?(sessionId: string): Promise<void>
}
