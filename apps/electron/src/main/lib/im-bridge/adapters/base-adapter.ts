import type { FileAttachment } from '@kila/shared'
import type {
  BridgeChannelStatus,
  BridgeChannelType,
  BridgeAttachmentProviderPayload,
  BridgeAdapterCapabilities,
  BridgeOutboundAttachment,
  BridgeProviderContext,
  BridgePermissionPrompt,
  BridgeTestResult,
} from '@kila/shared'

export interface BridgeAttachmentReference {
  remoteId: string
  filename: string
  mediaType: string
  size: number
  downloadUrl?: string
  providerPayload?: BridgeAttachmentProviderPayload
}

export interface BridgeInboundMessage {
  channelType: BridgeChannelType
  endpointKey: string
  botId?: string
  chatId: string
  threadId?: string
  userId: string
  displayName?: string
  messageId: string
  text: string
  attachments: BridgeAttachmentReference[]
  providerContext?: BridgeProviderContext
}

export interface BridgePermissionAction {
  channelType: BridgeChannelType
  endpointKey: string
  chatId: string
  threadId?: string
  userId?: string
  callbackToken: string
  behavior: 'allow' | 'deny'
  alwaysAllow: boolean
}

export type BridgeAdapterEvent =
  | { type: 'message'; message: BridgeInboundMessage }
  | { type: 'permission_action'; action: BridgePermissionAction }

export interface BridgeOutboundMessage {
  endpointKey?: string
  chatId: string
  threadId?: string
  text: string
  parseMode?: 'HTML'
  deliveryKind?: 'assistant' | 'command' | 'system'
  attachments?: BridgeOutboundAttachment[]
  providerContext?: BridgeProviderContext
}

export interface BridgePermissionPromptMessage extends BridgePermissionPrompt {
  chatId: string
  threadId?: string
  promptText: string
  providerContext?: BridgeProviderContext
}

export interface BridgeAdapter {
  readonly channelType: BridgeChannelType
  readonly capabilities?: BridgeAdapterCapabilities
  start(): Promise<void>
  stop(): void
  getStatus(): BridgeChannelStatus
  onEvent(handler: (event: BridgeAdapterEvent) => void): () => void
  onStatusChanged(handler: (status: BridgeChannelStatus) => void): () => void
  sendMessage(input: BridgeOutboundMessage): Promise<void>
  sendPermissionPrompt(input: BridgePermissionPromptMessage): Promise<void>
  testConnection(): Promise<BridgeTestResult>
  downloadAttachments(attachments: BridgeAttachmentReference[], sessionId: string): Promise<FileAttachment[]>
}

export abstract class BaseImAdapter implements BridgeAdapter {
  protected readonly handlers = new Set<(event: BridgeAdapterEvent) => void>()
  protected readonly statusHandlers = new Set<(status: BridgeChannelStatus) => void>()
  protected status: BridgeChannelStatus

  abstract readonly channelType: BridgeChannelType

  constructor(channelType: BridgeChannelType) {
    this.status = {
      channel: channelType,
      enabled: false,
      status: 'disconnected',
    }
  }

  abstract start(): Promise<void>
  abstract stop(): void
  abstract sendMessage(input: BridgeOutboundMessage): Promise<void>
  abstract sendPermissionPrompt(input: BridgePermissionPromptMessage): Promise<void>
  abstract testConnection(): Promise<BridgeTestResult>
  abstract downloadAttachments(attachments: BridgeAttachmentReference[], sessionId: string): Promise<FileAttachment[]>

  getStatus(): BridgeChannelStatus {
    return { ...this.status }
  }

  onEvent(handler: (event: BridgeAdapterEvent) => void): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  onStatusChanged(handler: (status: BridgeChannelStatus) => void): () => void {
    this.statusHandlers.add(handler)
    return () => {
      this.statusHandlers.delete(handler)
    }
  }

  protected emit(event: BridgeAdapterEvent): void {
    for (const handler of this.handlers) {
      handler(event)
    }
  }

  protected updateStatus(updates: Partial<BridgeChannelStatus>): void {
    this.status = {
      ...this.status,
      ...updates,
    }

    for (const handler of this.statusHandlers) {
      handler(this.getStatus())
    }
  }
}
