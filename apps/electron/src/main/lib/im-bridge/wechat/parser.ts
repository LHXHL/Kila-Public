import type { BridgeAttachmentReference } from '../adapters/base-adapter'
import type {
  ParsedWeChatInbound,
  WeChatIlinkMessageItem,
  WeChatIlinkRawMessage,
} from './types'

function asString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  return ''
}

function getTextItems(message: WeChatIlinkRawMessage): string[] {
  const text = asString(message.text || message.content)
  const items = message.item_list ?? message.items ?? []
  const itemText = items
    .map((item) => asString(item.text_item?.text || item.voice_item?.text || item.text || item.content))
    .filter(Boolean)
  return [text, ...itemText].filter(Boolean)
}

function getAttachmentType(item: WeChatIlinkMessageItem): string | null {
  const numericType = typeof item.type === 'number'
    ? item.type
    : typeof item.msg_type === 'number'
      ? item.msg_type
      : null
  if (numericType === 1) return null
  if (numericType === 2) return 'image'
  if (numericType === 3) return 'voice'
  if (numericType === 4) return 'file'
  if (numericType === 5) return 'video'

  const type = asString(item.type || item.msg_type)
  if (!type) return null
  if (['text', 'plain', 'markdown'].includes(type.toLowerCase())) return null
  return type.toLowerCase()
}

function mediaTypeFor(item: WeChatIlinkMessageItem, type: string): string {
  const explicit = asString(item.mediaType || item.media_type)
  if (explicit) return explicit
  if (type.includes('image') || type === 'pic') return 'image/jpeg'
  if (type.includes('video')) return 'video/mp4'
  return 'application/octet-stream'
}

function getAttachments(accountId: string, message: WeChatIlinkRawMessage): BridgeAttachmentReference[] {
  const items = [
    ...(message.item_list ?? []),
    ...(message.items ?? []),
    ...(message.attachment_list ?? []),
  ]
  const attachments: BridgeAttachmentReference[] = []

  for (const item of items) {
    const type = getAttachmentType(item)
    if (!type) continue

    const media = item.image_item?.media ?? item.voice_item?.media ?? item.file_item?.media ?? item.video_item?.media
    const filename = asString(item.filename || item.file_name || item.file_item?.file_name || item.name) || `${type}-${attachments.length + 1}`
    const remoteId = asString(item.remoteId || item.remote_id || item.fileId || item.file_id || item.fileKey || item.file_key || filename)
    const url = asString(item.full_url || item.cdn_url || item.url || item.image_item?.url || media?.full_url)
    const size = typeof item.size === 'number'
      ? item.size
      : typeof item.file_size === 'number'
        ? item.file_size
        : item.file_item?.len
          ? Number.parseInt(item.file_item.len, 10) || 0
          : 0

    attachments.push({
      remoteId,
      filename,
      mediaType: mediaTypeFor(item, type),
      size,
      downloadUrl: url || undefined,
      providerPayload: {
        wechat: {
          accountId,
          aesKey: asString(item.aesKey || item.aes_key || item.image_item?.aeskey || media?.aes_key) || undefined,
          encryptQueryParam: asString(item.encryptQueryParam || item.encrypt_query_param || media?.encrypt_query_param) || undefined,
          cdnUrl: url || undefined,
          fileId: asString(item.fileId || item.file_id) || undefined,
          fileKey: asString(item.fileKey || item.file_key) || undefined,
          rawFilename: filename,
        },
      },
    })
  }

  return attachments
}

export function buildWeChatEndpointKey(accountId: string, peerId: string): string {
  return `wechat:${accountId}:user:${peerId}`
}

export function parseWeChatTextApproval(text: string): {
  behavior: 'allow' | 'deny'
  alwaysAllow: boolean
  approvalCode: string
} | null {
  const trimmed = text.trim()
  const match = trimmed.match(/^\/(allow-always|allow|deny)\s+([A-Za-z0-9_-]{4,16})$/)
  if (!match) return null
  const approvalCode = match[2]
  if (!approvalCode) return null

  return {
    behavior: match[1] === 'deny' ? 'deny' : 'allow',
    alwaysAllow: match[1] === 'allow-always',
    approvalCode: approvalCode.toUpperCase(),
  }
}

export function parseWeChatInbound(input: {
  accountId: string
  raw: WeChatIlinkRawMessage
  typingTicket?: string
}): ParsedWeChatInbound | null {
  const peerId = asString(
    input.raw.peerId
    || input.raw.peer_id
    || input.raw.from_user_id
    || input.raw.fromUserId
    || input.raw.from_user_id
    || input.raw.fromUserName
    || input.raw.from_user_name,
  )
  if (!peerId) return null

  const messageId = asString(input.raw.message_id || input.raw.msg_id || input.raw.id) || `${Date.now()}:${peerId}`
  const contextToken = asString(input.raw.contextToken || input.raw.context_token)
  const sessionId = asString(input.raw.sessionId || input.raw.session_id)
  const typingTicket = asString(input.raw.typingTicket || input.raw.typing_ticket) || input.typingTicket
  const text = getTextItems(input.raw).join('\n\n')
  const attachments = getAttachments(input.accountId, input.raw)

  return {
    message: {
      channelType: 'wechat',
      endpointKey: buildWeChatEndpointKey(input.accountId, peerId),
      chatId: peerId,
      userId: peerId,
      displayName: asString(input.raw.displayName || input.raw.display_name || input.raw.nickname) || undefined,
      messageId,
      text,
      attachments,
      providerContext: {
        wechat: {
          accountId: input.accountId,
          peerId,
          contextToken: contextToken || undefined,
          sessionId: sessionId || undefined,
          typingTicket,
        },
      },
    },
    context: contextToken
      ? {
        accountId: input.accountId,
        peerId,
        contextToken,
        sessionId: sessionId || undefined,
        typingTicket,
        lastSeenAt: Date.now(),
      }
      : undefined,
  }
}
