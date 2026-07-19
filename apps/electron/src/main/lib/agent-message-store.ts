/**
 * Agent message store
 *
 * Runtime-facing unified session message façade.
 * 所有 Agent runtime 消息读写都必须走这里，而不是 legacy compat manager。
 */

import type { AgentMessage } from '@kila/shared'
import {
  legacyAgentMessageToSessionMessage,
  sessionMessageToLegacyAgentMessage,
} from '@kila/shared'
import {
  appendSessionMessage,
  getSessionMessages,
  updateSessionMeta,
} from './session-manager'

export function getAgentMessages(sessionId: string): AgentMessage[] {
  return getSessionMessages(sessionId)
    .map(sessionMessageToLegacyAgentMessage)
    .filter((message): message is AgentMessage => message !== null)
}

export function appendAgentMessage(sessionId: string, message: AgentMessage): void {
  appendSessionMessage(sessionId, legacyAgentMessageToSessionMessage(message))
}

export function touchAgentSession(sessionId: string): void {
  updateSessionMeta(sessionId, {})
}
