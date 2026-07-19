import { existsSync, readFileSync } from 'node:fs'
import type { AssistantMessage, ImageContent, Message, Model, TextContent, ToolResultMessage, UserMessage } from '@earendil-works/pi-ai'
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

function createAssistantTextMessage(message: AgentMessage, model: PiModel): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: message.content }],
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
    stopReason: 'stop',
    timestamp: message.createdAt,
  }
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

    if (message.content.trim()) {
      result.push(createAssistantTextMessage(message, model))
    }

    const toolResultMessages = await createToolResultMessages(message)
    result.push(...toolResultMessages)
  }

  return result
}
