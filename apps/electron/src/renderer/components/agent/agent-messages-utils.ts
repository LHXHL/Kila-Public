/**
 * AgentMessages 工具函数与常量
 *
 * 纯函数、类型定义和样式常量，无 React 依赖。
 * 从 AgentMessages.tsx 中抽取，便于跨组件复用和独立测试。
 */

import { stripWidgetFencesToPlainText } from '@/lib/generative-ui/parse-show-widget'
import { estimateMessageShellHeight } from '@/lib/pretext/message-height-estimator'
import type { AgentMessage, FileAttachment } from '@kila/shared'
import {
  buildProcessTimelineEntries,
} from '@/atoms/agent-atoms'

// ===== 消息格式化 =====

export function formatMessageTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function getMessageSourceLabel(message: AgentMessage): string {
  if (message.messageSourceLabel?.trim()) {
    return message.messageSourceLabel
  }

  switch (message.messageSource) {
    case 'scheduled-task':
      return '定时任务'
    case 'im-bridge':
      return 'IM Bridge'
    case 'manual':
    default:
      return '手动'
  }
}

export function shouldShowMessageSourceBadge(message: AgentMessage): boolean {
  if (message.messageSourceLabel?.trim()) {
    return true
  }

  return message.messageSource === 'scheduled-task'
    || message.messageSource === 'im-bridge'
}

// ===== 附件解析 =====

export interface AttachedFileRef {
  filename: string
  path: string
  mediaType?: string
}

export function parseAttachedFiles(content: string): { files: AttachedFileRef[]; text: string } {
  const regex = /<attached_files>\n?([\s\S]*?)\n?<\/attached_files>\n*/
  const match = content.match(regex)
  if (!match) return { files: [], text: content }

  const files: AttachedFileRef[] = []
  const lines = match[1]!.split('\n')
  for (const line of lines) {
    const lineMatch = line.match(/^-\s+(.+?):\s+(.+)$/)
    if (lineMatch) {
      files.push({ filename: lineMatch[1]!.trim(), path: lineMatch[2]!.trim() })
    }
  }

  const text = content.replace(regex, '').trim()
  return { files, text }
}

function toAttachedFileRefs(attachments?: FileAttachment[]): AttachedFileRef[] {
  if (!attachments || attachments.length === 0) return []
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    path: attachment.localPath,
    mediaType: attachment.mediaType,
  }))
}

export function extractAttachedFiles(message: AgentMessage): { files: AttachedFileRef[]; text: string } {
  const legacy = parseAttachedFiles(message.content)
  const files = message.attachments && message.attachments.length > 0
    ? toAttachedFileRefs(message.attachments)
    : legacy.files

  return {
    files,
    text: legacy.files.length > 0 ? legacy.text : message.content,
  }
}

export function getAssistantPlainText(content: string): string {
  return stripWidgetFencesToPlainText(content)
}

export function getMessagePreviewText(message: AgentMessage): string {
  const text = extractAttachedFiles(message).text
  return message.role === 'assistant'
    ? getAssistantPlainText(text)
    : text
}

// ===== Payload 文本处理 =====

export const TOOL_PAYLOAD_VISIBLE_LINES = 10
export const TOOL_PAYLOAD_MAX_CHARS = 8_000
export const TOOL_PAYLOAD_EXPANDED_MAX_CHARS = 100_000

export function coercePayloadText(text: unknown): string {
  if (typeof text === 'string') return text
  if (text === null || text === undefined) return ''

  try {
    const serialized = JSON.stringify(text, null, 2)
    return serialized ?? String(text)
  } catch {
    return String(text)
  }
}

export function normalizePayloadText(text: unknown): string {
  return coercePayloadText(text).replace(/\r\n?/g, '\n')
}

export function countFoldableLines(text: unknown): number {
  if (!text) return 0

  const normalizedText = normalizePayloadText(text).replace(/\n+$/g, '')
  if (!normalizedText) return 0

  return normalizedText.split('\n').length
}

export function shouldEnablePayloadFolding(text: unknown, visibleLineCount = TOOL_PAYLOAD_VISIBLE_LINES): boolean {
  return countFoldableLines(text) > visibleLineCount
}

export function getFoldedPayloadText(
  text: unknown,
  visibleLineCount = TOOL_PAYLOAD_VISIBLE_LINES,
): {
  visibleText: string
  hiddenLineCount: number
  totalLineCount: number
} {
  const normalizedText = normalizePayloadText(text).replace(/\n+$/g, '')
  const totalLineCount = countFoldableLines(text)
  const lines = totalLineCount > 0 ? normalizedText.split('\n') : []
  const hiddenLineCount = Math.max(0, totalLineCount - visibleLineCount)

  if (hiddenLineCount === 0) {
    return {
      visibleText: normalizedText || coercePayloadText(text),
      hiddenLineCount,
      totalLineCount,
    }
  }

  return {
    visibleText: lines.slice(0, visibleLineCount).join('\n'),
    hiddenLineCount,
    totalLineCount,
  }
}

export function getRenderablePayloadText(
  text: unknown,
  maxChars = TOOL_PAYLOAD_MAX_CHARS,
): {
  text: string
  truncatedCharCount: number
} {
  const normalizedText = normalizePayloadText(text)
  const truncatedCharCount = Math.max(0, normalizedText.length - maxChars)

  if (truncatedCharCount === 0) {
    return {
      text: normalizedText,
      truncatedCharCount: 0,
    }
  }

  return {
    text: `${normalizedText.slice(0, maxChars)}\n… [截断 ${truncatedCharCount} 个字符]`,
    truncatedCharCount,
  }
}

// ===== 过程卡片格式化 =====

export function formatProcessDuration(seconds?: number): string | null {
  if (!seconds || seconds <= 0) return null
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return `${minutes}m${remainingSeconds}s`
}

export function formatToolPayload(input: Record<string, unknown>): string {
  const filtered = Object.fromEntries(
    Object.entries(input).filter(([key]) => !key.startsWith('_')),
  )
  try {
    return JSON.stringify(filtered, null, 2)
  } catch {
    return '[不可序列化]'
  }
}

export function formatThinkingDuration(durationLabel: string): string {
  const minuteMatch = durationLabel.match(/^(\d+)m(\d+)s$/)
  if (minuteMatch) return `${minuteMatch[1]} 分 ${minuteMatch[2]} 秒`

  const secondMatch = durationLabel.match(/^(\d+(?:\.\d+)?)s$/)
  if (secondMatch) return `${secondMatch[1]} 秒`

  const millisecondMatch = durationLabel.match(/^(\d+)\sms$/)
  if (millisecondMatch) return `${millisecondMatch[1]} 毫秒`

  return durationLabel
}

export function getThinkingTitle(
  durationLabel: string | null,
  running: boolean,
  summaryText?: string,
): string {
  if (running) {
    const preview = summaryText?.trim().replace(/\s+/g, ' ')
    if (preview) return preview.length > 40 ? `${preview.slice(0, 40)}…` : preview
    return durationLabel
      ? `Kila 思考了 ${formatThinkingDuration(durationLabel)}`
      : 'Kila 思考中…'
  }

  if (durationLabel) {
    return `Kila 思考了 ${formatThinkingDuration(durationLabel)}`
  }

  return 'Kila 完成了思考'
}

// ===== 高度预测 =====

export function resolvePredictedMessageHeight(input: {
  message: AgentMessage
  userWidthPx: number
  assistantWidthPx: number
  hasRegenerateAction: boolean
  hasRetryActions: boolean
  hasCompactAction: boolean
}): number {
  const { files: attachedFiles, text } = extractAttachedFiles(input.message)
  const processEntryCount = buildProcessTimelineEntries(input.message.events).length
  const hasVisibleUserBody = Boolean(text || attachedFiles.length > 0)
  const hasVisibleAssistantBody = Boolean(text || attachedFiles.length > 0 || processEntryCount > 0)

  if (input.message.role === 'user') {
    return estimateMessageShellHeight({
      kind: 'user',
      text,
      widthPx: input.userWidthPx,
      attachmentsCount: attachedFiles.length,
      processEntryCount: 0,
      hasActions: Boolean(text || (hasVisibleUserBody && input.hasRegenerateAction)),
      surface: 'userBubble',
    })
  }

  if (input.message.role === 'assistant' || input.message.role === 'tool') {
    return estimateMessageShellHeight({
      kind: input.message.role,
      text,
      widthPx: input.assistantWidthPx,
      attachmentsCount: attachedFiles.length,
      processEntryCount,
      hasActions: Boolean(text || (input.message.role === 'assistant' && hasVisibleAssistantBody && input.hasRegenerateAction)),
      surface: 'assistantBody',
    })
  }

  return estimateMessageShellHeight({
    kind: 'status',
    text: input.message.content,
    widthPx: input.assistantWidthPx,
    attachmentsCount: attachedFiles.length,
    processEntryCount: 0,
    hasActions: input.hasRetryActions || input.hasCompactAction || input.hasRegenerateAction,
    surface: 'assistantBody',
  })
}

// ===== 通用 =====

export function isImageFile(filename: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(filename)
}

// ===== 样式常量 =====

export const THINKING_SUMMARY_ROW_CLASS = 'group inline-flex max-w-[min(100%,58rem)] items-center gap-2.5 py-1 text-left'
export const THINKING_SUMMARY_TEXT_CLASS = 'min-w-0 max-w-[48rem]'
export const TOOL_CARD_WIDTH_CLASS = 'w-full max-w-[min(100%,40rem)]'
export const TOOL_CARD_SHELL_CLASS = 'w-full bg-transparent'
export const TOOL_ROW_HEADER_CLASS = 'group flex w-full items-center gap-2 rounded-xl px-2 py-1 text-left'
export const TOOL_ROW_ICON_CLASS = 'flex size-6 shrink-0 items-center justify-center text-muted-foreground/80'
export const TOOL_CARD_DETAILS_CLASS = 'pl-8 pt-0.5'
export const TOOL_CARD_DETAILS_INNER_CLASS = 'ml-1 border-l border-border/20 pb-1 pl-4'
export const TOOL_ROW_TARGET_CLASS = 'max-w-[20rem] truncate text-[12px] font-mono text-muted-foreground/60'
export const PROCESS_TONE_STYLE = { color: 'hsl(var(--process-tone))' } as const
export const PROCESS_TONE_SOFT_STYLE = { color: 'hsl(var(--process-tone) / 0.82)' } as const
export const PROCESS_TONE_FADE_STYLE = { color: 'hsl(var(--process-tone) / 0.62)' } as const
