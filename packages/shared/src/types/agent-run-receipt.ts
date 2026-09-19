/** 产品消息与 Pi sidecar 之间的安全提交凭据。 */

export interface AgentRunReceipt {
  runId: string
  sessionId: string
  outcome: 'success' | 'stopped' | 'error'
  lastMessageId: string
  fullyPersisted: boolean
  /** 只有 Runtime 已发送 run.settled 后，产品 receipt 才能成为 Pi 安全边界。 */
  runtimeSettled: boolean
  completedAt: number
}

export interface PiRunJournalV1 {
  version: 1
  sessionId: string
  runId?: string
  state: 'clean' | 'preparing' | 'submitted' | 'settled-awaiting-persist' | 'dirty'
  safeProductMessageId?: string
  safePiEntryId?: string
  appBootId: string
  bootId: string
  generation: number
  updatedAt: number
}
