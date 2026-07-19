import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DangerLevel, BridgeChannelType } from '@kila/shared'
import { getImBridgeAuditDir } from '../config-paths'
import type { BridgeAttachmentReference } from './adapters/base-adapter'


import { createLogger } from '../logger'
const log = createLogger('IM Bridge')

const MAX_TEXT_PREVIEW_LENGTH = 1000

type BridgeAuditEventType =
  | 'inbound_message'
  | 'outbound_message'
  | 'permission_prompt'
  | 'permission_action'
  | 'channel_error'

type BridgeDeliveryKind = 'assistant' | 'command' | 'system'

export interface BridgeAuditAttachmentRecord {
  remoteId: string
  filename: string
  mediaType: string
  size: number
}

export interface BridgeAuditEntry {
  timestamp: string
  eventType: BridgeAuditEventType
  channelType?: BridgeChannelType
  endpointKey?: string
  sessionId?: string
  chatId?: string
  threadId?: string
  userId?: string
  messageId?: string
  requestId?: string
  toolName?: string
  dangerLevel?: DangerLevel
  deliveryKind?: BridgeDeliveryKind
  behavior?: 'allow' | 'deny'
  alwaysAllow?: boolean
  ok?: boolean
  reason?: string
  errorMessage?: string
  textPreview?: string
  textLength?: number
  chunkCount?: number
  attachments?: BridgeAuditAttachmentRecord[]
}

interface ImBridgeAuditLogDeps {
  getAuditDir?: () => string
  now?: () => Date
  appendLine?: (filePath: string, line: string) => void
}

function trimTextPreview(text: string | undefined): string | undefined {
  const normalized = text?.trim()
  if (!normalized) return undefined
  if (normalized.length <= MAX_TEXT_PREVIEW_LENGTH) {
    return normalized
  }
  return `${normalized.slice(0, MAX_TEXT_PREVIEW_LENGTH)}…`
}

function normalizeAttachments(attachments: BridgeAttachmentReference[] | undefined): BridgeAuditAttachmentRecord[] | undefined {
  if (!attachments?.length) return undefined

  return attachments.map((attachment) => ({
    remoteId: attachment.remoteId,
    filename: attachment.filename,
    mediaType: attachment.mediaType,
    size: attachment.size,
  }))
}

function createFileName(now: Date): string {
  return `${now.toISOString().slice(0, 10)}.jsonl`
}

export class ImBridgeAuditLog {
  private readonly getAuditDir: () => string
  private readonly now: () => Date
  private readonly appendLine: (filePath: string, line: string) => void

  constructor(deps?: ImBridgeAuditLogDeps) {
    this.getAuditDir = deps?.getAuditDir ?? getImBridgeAuditDir
    this.now = deps?.now ?? (() => new Date())
    this.appendLine = deps?.appendLine ?? ((filePath, line) => {
      appendFileSync(filePath, line, 'utf-8')
    })
  }

  append(entry: Omit<BridgeAuditEntry, 'timestamp'>): void {
    const now = this.now()
    const filePath = join(this.getAuditDir(), createFileName(now))
    const line = `${JSON.stringify({
      ...entry,
      textPreview: trimTextPreview(entry.textPreview),
      timestamp: now.toISOString(),
    })}\n`

    try {
      this.appendLine(filePath, line)
    } catch (error) {
      log.error('[IM Bridge] Failed to append audit log', error)
    }
  }

  appendInboundMessage(input: {
    channelType: BridgeChannelType
    endpointKey: string
    sessionId?: string
    chatId: string
    threadId?: string
    userId?: string
    messageId: string
    text: string
    attachments?: BridgeAttachmentReference[]
  }): void {
    this.append({
      eventType: 'inbound_message',
      channelType: input.channelType,
      endpointKey: input.endpointKey,
      sessionId: input.sessionId,
      chatId: input.chatId,
      threadId: input.threadId,
      userId: input.userId,
      messageId: input.messageId,
      textPreview: input.text,
      textLength: input.text.length,
      attachments: normalizeAttachments(input.attachments),
    })
  }

  appendOutboundMessage(input: {
    channelType: BridgeChannelType
    endpointKey: string
    sessionId?: string
    chatId: string
    threadId?: string
    text: string
    deliveryKind: BridgeDeliveryKind
    chunkCount?: number
    reason?: string
  }): void {
    this.append({
      eventType: 'outbound_message',
      channelType: input.channelType,
      endpointKey: input.endpointKey,
      sessionId: input.sessionId,
      chatId: input.chatId,
      threadId: input.threadId,
      textPreview: input.text,
      textLength: input.text.length,
      deliveryKind: input.deliveryKind,
      chunkCount: input.chunkCount,
      reason: input.reason,
    })
  }

  appendPermissionPrompt(input: {
    channelType: BridgeChannelType
    endpointKey: string
    sessionId: string
    requestId: string
    toolName: string
    dangerLevel: DangerLevel
    reason?: string
  }): void {
    this.append({
      eventType: 'permission_prompt',
      channelType: input.channelType,
      endpointKey: input.endpointKey,
      sessionId: input.sessionId,
      requestId: input.requestId,
      toolName: input.toolName,
      dangerLevel: input.dangerLevel,
      reason: input.reason,
    })
  }

  appendPermissionAction(input: {
    channelType: BridgeChannelType
    endpointKey: string
    sessionId?: string
    chatId: string
    threadId?: string
    behavior: 'allow' | 'deny'
    alwaysAllow: boolean
    ok: boolean
    reason: string
  }): void {
    this.append({
      eventType: 'permission_action',
      channelType: input.channelType,
      endpointKey: input.endpointKey,
      sessionId: input.sessionId,
      chatId: input.chatId,
      threadId: input.threadId,
      behavior: input.behavior,
      alwaysAllow: input.alwaysAllow,
      ok: input.ok,
      reason: input.reason,
    })
  }

  appendChannelError(input: {
    channelType: BridgeChannelType
    endpointKey?: string
    chatId?: string
    threadId?: string
    errorMessage: string
  }): void {
    this.append({
      eventType: 'channel_error',
      channelType: input.channelType,
      endpointKey: input.endpointKey,
      chatId: input.chatId,
      threadId: input.threadId,
      errorMessage: input.errorMessage,
    })
  }
}

export const imBridgeAuditLog = new ImBridgeAuditLog()
