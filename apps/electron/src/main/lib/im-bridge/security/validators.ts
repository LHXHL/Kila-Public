import type { BridgeInboundMessage } from '../adapters/base-adapter'

export function hasUsableInboundContent(message: BridgeInboundMessage): boolean {
  return Boolean(message.text.trim() || message.attachments.length > 0)
}

export function buildInboundUserMessage(message: BridgeInboundMessage): string {
  const trimmed = message.text.trim()
  if (trimmed) {
    return trimmed
  }

  if (message.attachments.length === 0) {
    return ''
  }

  const filenames = message.attachments
    .slice(0, 3)
    .map((attachment) => attachment.filename)
    .join(', ')

  return `请结合我上传的附件继续处理：${filenames}`
}
