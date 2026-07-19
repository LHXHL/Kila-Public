import type {
  AgentMessage,
  FileAttachment,
  SessionMessage,
} from '../types'

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

  return {
    id: message.id,
    role: message.role === 'assistant' || message.role === 'status' || message.role === 'tool'
      ? message.role
      : 'user',
    content: parsed.content,
    createdAt: message.createdAt,
    model: message.model,
    attachments,
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
