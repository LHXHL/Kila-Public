/**
 * 入站拒绝的统一副作用
 *
 * 拒绝一条入站消息时必须同时做到三件事：不进 Agent、回一条提示、写审计日志。
 * 抽到这里是为了让 `BridgeManager` 只保留编排，不再堆叠这些细节。
 */

import type { BridgeAdapter, BridgeInboundMessage } from '../adapters/base-adapter'
import type { ImBridgeAuditLog } from '../audit-log'
import type { InboundGuardRejection } from './inbound-guard'

export interface RejectInboundMessageInput {
  message: BridgeInboundMessage
  rejection: InboundGuardRejection
  adapter: BridgeAdapter
  auditLog: ImBridgeAuditLog
  onSendError?: (error: unknown) => void
}

export async function rejectInboundMessage(input: RejectInboundMessageInput): Promise<void> {
  const { message, rejection, adapter, auditLog } = input

  auditLog.appendChannelError({
    channelType: message.channelType,
    endpointKey: message.endpointKey,
    chatId: message.chatId,
    threadId: message.threadId,
    errorMessage: `入站被拒绝 (${rejection.reason})`,
  })
  auditLog.appendOutboundMessage({
    channelType: message.channelType,
    endpointKey: message.endpointKey,
    chatId: message.chatId,
    threadId: message.threadId,
    text: rejection.message,
    deliveryKind: 'system',
    reason: rejection.reason,
  })

  await adapter.sendMessage({
    chatId: message.chatId,
    threadId: message.threadId,
    endpointKey: message.endpointKey,
    text: rejection.message,
    deliveryKind: 'system',
    providerContext: message.providerContext,
  }).catch((error) => {
    input.onSendError?.(error)
  })
}
