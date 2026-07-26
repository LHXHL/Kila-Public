import { existsSync, readFileSync } from 'node:fs'
import type { AssistantMessage, ImageContent, Message, Model, TextContent, ToolCall, ToolResultMessage, UserMessage } from '@earendil-works/pi-ai'
import type { AgentMessage, AgentToolResultImage, FileAttachment } from '@kila/shared'
import { extractKilaImageAttachments, withLegacyAttachedFilesBlock } from '@kila/shared'
import { resolveAttachmentPath } from '../config-paths'


import { createLogger } from '../logger'
const log = createLogger('Pi History')

type PiModel = Model<any>

interface SplitPromptAttachmentsResult {
  prompt: string
  imageAttachments: FileAttachment[]
  fileAttachments: FileAttachment[]
}

function isImageAttachment(attachment: FileAttachment): boolean {
  return attachment.mediaType.startsWith('image/')
}

function readAttachmentFileAsBase64(localPath: string): string {
  const fullPath = resolveAttachmentPath(localPath, { allowAbsolute: true })
  if (!existsSync(fullPath)) {
    throw new Error(`附件文件不存在: ${localPath}`)
  }

  return readFileSync(fullPath).toString('base64')
}

async function attachmentToImageContent(attachment: Pick<FileAttachment, 'localPath' | 'mediaType' | 'filename' | 'inlineData'>): Promise<ImageContent | null> {
  try {
    const data = attachment.inlineData || readAttachmentFileAsBase64(attachment.localPath)
    if (!data) {
      log.warn(`[Pi History] 图片附件 ${attachment.filename} 数据为空`)
      return null
    }
    return {
      type: 'image',
      data,
      mimeType: attachment.mediaType,
    }
  } catch (error) {
    log.warn(`[Pi History] 跳过不可读取的图片附件 ${attachment.filename}:`, error)
    return null
  }
}

function createAssistantMessage(message: AgentMessage, model: PiModel, toolCalls: ToolCall[]): AssistantMessage {
  const content: Array<TextContent | ToolCall> = []
  if (message.content.trim()) {
    content.push({ type: 'text', text: message.content })
  }
  content.push(...toolCalls)

  return {
    role: 'assistant',
    content,
    api: model.api,
    provider: model.provider,
    model: message.model ?? model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    // 有工具调用的历史轮次必须标记为 toolUse，否则 Pi/Anthropic 会认为 assistant 已终止，
    // 破坏 toolUse↔toolResult 的配对结构。
    stopReason: toolCalls.length > 0 ? 'toolUse' : 'stop',
    timestamp: message.createdAt,
  }
}

/**
 * 从一条 assistant 消息的事件里重建 Pi 需要的 toolCall 块。
 *
 * 以 tool_result 事件为驱动，保证生成的 toolCall 与后续 toolResult 严格 1:1 配对——
 * 严格 provider（如 Anthropic）要求每个 tool_result 前必须有对应的 tool_use，
 * 否则首次迁移灌入 Pi sidecar 后，第一条 prompt 会报 "tool_result without preceding tool_use"。
 * 优先复用 tool_start 里更完整的入参；缺失时回退到 tool_result 自带的 input。
 */
function collectToolCallsFromEvents(message: AgentMessage): ToolCall[] {
  const events = message.events ?? []
  const startById = new Map<string, Extract<NonNullable<AgentMessage['events']>[number], { type: 'tool_start' }>>()
  for (const event of events) {
    if (event.type === 'tool_start') {
      startById.set(event.toolUseId, event)
    }
  }

  const toolCalls: ToolCall[] = []
  const seen = new Set<string>()
  for (const event of events) {
    if (event.type !== 'tool_result') continue
    if (seen.has(event.toolUseId)) continue
    seen.add(event.toolUseId)
    const start = startById.get(event.toolUseId)
    toolCalls.push({
      type: 'toolCall',
      id: event.toolUseId,
      name: start?.toolName ?? event.toolName ?? 'unknown_tool',
      arguments: (start?.input ?? event.input ?? {}) as Record<string, unknown>,
    })
  }

  return toolCalls
}

function buildUserTextContent(content: string, attachments?: FileAttachment[]): string {
  return withLegacyAttachedFilesBlock(content, attachments)
}

async function buildToolResultContent(
  result: string,
  imageAttachments?: AgentToolResultImage[],
): Promise<Array<TextContent | ImageContent>> {
  const parsed = extractKilaImageAttachments(result)
  const attachments = imageAttachments?.length
    ? imageAttachments
    : parsed.images

  const content: Array<TextContent | ImageContent> = []
  const text = attachments.length > 0 ? parsed.cleanedText : result.trim()
  if (text) {
    content.push({ type: 'text', text })
  }

  for (const attachment of attachments) {
    const imageContent = await attachmentToImageContent(attachment)
    if (imageContent) {
      content.push(imageContent)
    }
  }

  return content
}

async function createUserMessage(message: AgentMessage): Promise<UserMessage | null> {
  const split = splitAttachmentsForPiPrompt(message.content, message.attachments)
  const imageContents = await buildPromptImages(split.imageAttachments)

  if (imageContents.length === 0) {
    return {
      role: 'user',
      content: split.prompt,
      timestamp: message.createdAt,
    }
  }

  const content: Array<TextContent | ImageContent> = []
  if (split.prompt.trim()) {
    content.push({ type: 'text', text: split.prompt })
  }
  content.push(...imageContents)

  return {
    role: 'user',
    content,
    timestamp: message.createdAt,
  }
}

async function createToolResultMessages(message: AgentMessage): Promise<ToolResultMessage[]> {
  const toolResultEvents = message.events?.filter(
    (event): event is Extract<NonNullable<AgentMessage['events']>[number], { type: 'tool_result' }> => event.type === 'tool_result',
  ) ?? []

  const resultMessages: ToolResultMessage[] = []
  for (const event of toolResultEvents) {
    resultMessages.push({
      role: 'toolResult',
      toolCallId: event.toolUseId,
      toolName: event.toolName ?? 'unknown_tool',
      content: await buildToolResultContent(event.result, event.imageAttachments),
      isError: event.isError,
      timestamp: message.createdAt,
    })
  }

  return resultMessages
}

export function splitAttachmentsForPiPrompt(content: string, attachments?: FileAttachment[]): SplitPromptAttachmentsResult {
  const imageAttachments: FileAttachment[] = []
  const fileAttachments: FileAttachment[] = []

  for (const attachment of attachments ?? []) {
    if (isImageAttachment(attachment)) {
      imageAttachments.push(attachment)
    } else {
      fileAttachments.push(attachment)
    }
  }

  return {
    prompt: buildUserTextContent(content, fileAttachments) + (imageAttachments.length > 0
      ? `\n\n[用户粘贴了图片: ${imageAttachments.map(a => a.filename).join(', ')}]`
      : ''),
    imageAttachments,
    fileAttachments,
  }
}

export async function buildPromptImages(attachments?: FileAttachment[]): Promise<ImageContent[]> {
  const images: ImageContent[] = []
  for (const attachment of attachments ?? []) {
    const imageContent = await attachmentToImageContent(attachment)
    if (imageContent) {
      images.push(imageContent)
    }
  }
  return images
}

export async function convertHistoryToPiMessages(
  messages: AgentMessage[],
  model: PiModel,
): Promise<Message[]> {
  const result: Message[] = []

  for (const message of messages) {
    if (message.role === 'user') {
      const userMessage = await createUserMessage(message)
      if (userMessage) {
        result.push(userMessage)
      }
      continue
    }

    if (message.role !== 'assistant') {
      continue
    }

    // 先重建 toolCall 块，再决定是否产出 assistant 消息：
    // 即使文本为空，只要本轮有工具调用，也必须产出带 toolCall 的 assistant 消息，
    // 否则后续 toolResult 会成为“孤儿”，破坏严格 provider 的配对校验。
    const toolCalls = collectToolCallsFromEvents(message)
    if (message.content.trim() || toolCalls.length > 0) {
      result.push(createAssistantMessage(message, model, toolCalls))
    }

    const toolResultMessages = await createToolResultMessages(message)
    result.push(...toolResultMessages)
  }

  return result
}
