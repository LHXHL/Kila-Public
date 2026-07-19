import { DEFAULT_INTRINSIC_HEIGHT, USER_MESSAGE_HORIZONTAL_PADDING_PX, USER_MESSAGE_VERTICAL_PADDING_PX } from './config'
import { parseAssistantRenderableBlocks } from '@/lib/generative-ui/parse-show-widget'
import { getCachedWidgetHeight } from '@/lib/generative-ui/widget-height-cache'
import { DEFAULT_WIDGET_INTRINSIC_HEIGHT } from '@/lib/generative-ui/constants'
import { estimateSchemaWidgetHeight } from '@/lib/generative-ui/schema-widget-estimator'
import { normalizeMeasurementText } from './measurement-text'
import { measureNormalText, measurePreWrapText } from './text-layout'

export { DEFAULT_INTRINSIC_HEIGHT } from './config'

export interface EstimateMessageShellHeightInput {
  kind: 'user' | 'assistant' | 'tool' | 'status'
  text: string
  widthPx: number
  attachmentsCount: number
  processEntryCount: number
  hasActions: boolean
  surface: 'userBubble' | 'assistantBody'
}

const USER_HEADER_HEIGHT = 44
const ATTACHMENT_ROW_HEIGHT = 32
const PROCESS_ROW_HEIGHT = 28
const ACTIONS_HEIGHT = 28
const SECTION_GAP = 10
const BODY_BLOCK_GAP = 12
const DEFAULT_FONT = '400 14px Inter, "Segoe UI", sans-serif'
const DEFAULT_LINE_HEIGHT_PX = 22.4

const RICH_MARKDOWN_PATTERNS = [
  /(^|\n)```/,
  /(^|\n)\s*#{1,6}\s/m,
  /(^|\n)\s*[-*+]\s/m,
  /(^|\n)\s*\d+\.\s/m,
  /(^|\n)\s*>\s/m,
  /(^|\n)\|.*\|/m,
  /(^|\n)\s*\$\$/m,
  /!\[[^\]]*]\([^)]*\)/,
  /<([a-z][^>\s]*)(\s[^>]*)?>/i,
]

function estimateRows(count: number, perRow: number): number {
  if (count <= 0) return 0
  return Math.ceil(count / perRow)
}

function estimateSectionHeight(rows: number, rowHeight: number): number {
  return rows > 0 ? rows * rowHeight : 0
}

export function isPlainTextEligibleMarkdown(text: string): boolean {
  return !RICH_MARKDOWN_PATTERNS.some((pattern) => pattern.test(text))
}

function measureAssistantMarkdownHeight(text: string, widthPx: number): number {
  const normalizedText = normalizeMeasurementText(text)
  if (!normalizedText.trim()) return 0

  return isPlainTextEligibleMarkdown(text)
    ? measureNormalText({
      text: normalizedText,
      widthPx,
      font: DEFAULT_FONT,
      lineHeightPx: DEFAULT_LINE_HEIGHT_PX,
    }).height
    : DEFAULT_INTRINSIC_HEIGHT
}

function estimateAssistantMixedContentHeight(text: string, widthPx: number): number {
  const blocks = parseAssistantRenderableBlocks(text)
  const heights = blocks.flatMap((block) => {
    if (block.kind === 'codeWidget') {
      return [getCachedWidgetHeight(block.cacheKey) ?? DEFAULT_WIDGET_INTRINSIC_HEIGHT]
    }

    if (block.kind === 'schemaWidget') {
      return [estimateSchemaWidgetHeight({
        widgetType: block.widgetType,
        spec: block.spec,
        title: block.title,
        caption: block.caption,
      })]
    }

    const blockHeight = measureAssistantMarkdownHeight(block.markdown, widthPx)
    return blockHeight > 0 ? [blockHeight] : []
  })

  if (heights.length === 0) return 0

  return heights.reduce((sum, height, index) => (
    index === 0 ? height : sum + BODY_BLOCK_GAP + height
  ), 0)
}

export function estimateMessageShellHeight(input: EstimateMessageShellHeightInput): number {
  const normalizedText = normalizeMeasurementText(input.text)
  const safeWidth = Math.max(120, input.widthPx)
  const attachmentHeight = estimateSectionHeight(estimateRows(input.attachmentsCount, 3), ATTACHMENT_ROW_HEIGHT)
  const processHeight = estimateSectionHeight(input.processEntryCount, PROCESS_ROW_HEIGHT)
  const actionsHeight = input.hasActions ? ACTIONS_HEIGHT : 0
  const textGap = normalizedText ? SECTION_GAP : 0
  const attachmentGap = attachmentHeight > 0 ? SECTION_GAP : 0
  const processGap = processHeight > 0 ? SECTION_GAP : 0

  let textHeight = 0

  if (normalizedText) {
    if (input.kind === 'assistant') {
      textHeight = estimateAssistantMixedContentHeight(input.text, safeWidth)
    } else if (input.kind === 'tool' || input.kind === 'status') {
      textHeight = measureAssistantMarkdownHeight(input.text, safeWidth)
    } else {
      textHeight = measurePreWrapText({
        text: normalizedText,
        widthPx: Math.max(96, safeWidth - USER_MESSAGE_HORIZONTAL_PADDING_PX),
        font: DEFAULT_FONT,
        lineHeightPx: DEFAULT_LINE_HEIGHT_PX,
      }).height + USER_MESSAGE_VERTICAL_PADDING_PX
    }
  }

  if (input.surface === 'assistantBody' && !textHeight && normalizedText) {
    textHeight = DEFAULT_INTRINSIC_HEIGHT
  }

  const baseHeight = input.kind === 'user' ? USER_HEADER_HEIGHT : 0

  return Math.max(
    48,
    Math.ceil(baseHeight + attachmentHeight + attachmentGap + processHeight + processGap + textHeight + textGap + actionsHeight),
  )
}
