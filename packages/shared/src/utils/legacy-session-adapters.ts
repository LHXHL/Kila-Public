import type {
  AgentMessage,
  FileAttachment,
  SessionMessage,
} from '../types'
import { compactAgentEventsForPersistence } from './agent-events-compact'

const LEGACY_ATTACHED_FILES_REGEX = /<attached_files>\n?([\s\S]*?)\n?<\/attached_files>\n*/i

function parseLegacyAttachedFiles(content: string): {
  content: string
  attachments?: FileAttachment[]
} {
  const match = content.match(LEGACY_ATTACHED_FILES_REGEX)
  if (!match) {
    return { content }
  }

  const attachments = match[1]!
    .split('\n')
    .map((line) => line.match(/^-\s+(.+?):\s+(.+)$/))
    .filter((line): line is RegExpMatchArray => line !== null)
    .map((line) => ({
      id: `legacy:${line[2]!.trim()}`,
      filename: line[1]!.trim(),
      mediaType: 'application/octet-stream',
      localPath: line[2]!.trim(),
      size: 0,
    }))

  return {
    content: content.replace(LEGACY_ATTACHED_FILES_REGEX, '').trim(),
    attachments: attachments.length > 0 ? attachments : undefined,
  }
}

export function legacyAgentMessageToSessionMessage(message: AgentMessage): SessionMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    model: message.model,
    attachments: message.attachments,
    events: message.events,
    errorCode: message.errorCode,
    errorTitle: message.errorTitle,
    errorDetails: message.errorDetails,
    errorOriginal: message.errorOriginal,
    errorCanRetry: message.errorCanRetry,
    errorActions: message.errorActions,
    messageSource: message.messageSource,
    messageSourceLabel: message.messageSourceLabel,
    relatedTaskId: message.relatedTaskId,
  }
}

export function withLegacyAttachedFilesBlock(content: string, attachments?: FileAttachment[]): string {
  if (!attachments || attachments.length === 0) return content

  const attachmentLines = attachments.map((attachment) => `- ${attachment.filename}: ${attachment.localPath}`)
  const block = `<attached_files>\n${attachmentLines.join('\n')}\n</attached_files>`

  return content.trim()
    ? `${block}\n\n${content}`
    : block
}

export function sessionMessageToLegacyAgentMessage(message: SessionMessage): AgentMessage | null {
  if (message.role === 'system') {
    return null
  }

  const parsed = parseLegacyAttachedFiles(message.content)
  const attachments = message.attachments && message.attachments.length > 0
    ? message.attachments
    : parsed.attachments

  // 惰性规范化：老会话的 thinking_delta / tool_update 可能是逐 token 碎片，
  // 在读取出口合并成聚合事件。新数据已是聚合态，此调用为 no-op（短路返回原数组）。
  // 保留「无 events 即 undefined」语义，避免给无事件消息注入空数组。
  const events = message.events && message.events.length > 0
    ? compactAgentEventsForPersistence(message.events)
    : message.events

  return {
    id: message.id,
    role: message.role === 'assistant' || message.role === 'status' || message.role === 'tool'
      ? message.role
      : 'user',
    content: parsed.content,
    createdAt: message.createdAt,
    model: message.model,
    attachments,
    events,
    errorCode: message.errorCode,
    errorTitle: message.errorTitle,
    errorDetails: message.errorDetails,
    errorOriginal: message.errorOriginal,
    errorCanRetry: message.errorCanRetry,
    errorActions: message.errorActions,
    messageSource: message.messageSource,
    messageSourceLabel: message.messageSourceLabel,
    relatedTaskId: message.relatedTaskId,
  }
}
