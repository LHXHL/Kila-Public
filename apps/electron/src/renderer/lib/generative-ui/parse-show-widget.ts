import type { SchemaWidgetPayload, ShowWidgetPayload } from '@kila/shared'
import { getWidgetCacheKey } from './widget-height-cache'
import {
  isSchemaWidgetPayload,
  safeParseShowWidgetPayload,
} from './widget-schema'

export type AssistantRenderableBlock =
  | { kind: 'markdown'; markdown: string }
  | { kind: 'codeWidget'; title?: string; widgetCode: string; cacheKey: string }
  | {
    kind: 'schemaWidget'
    title?: string
    caption?: string
    widgetType: SchemaWidgetPayload['widget_type']
    spec: SchemaWidgetPayload['spec']
    cacheKey: string
  }

interface PartialJsonStringField {
  value: string
  closed: boolean
}

const OPEN_FENCE = '```show-widget'
const CLOSING_FENCE_RE = /\n```[ \t]*(?=\n|$)/g
// Pi 某些模型会把 show-widget 当成伪工具调用输出，而不是遵守 fenced block 合约。
// 这里先将 XML 外壳归一化，再复用同一套 JSON / streaming 解析逻辑。
const SHOW_WIDGET_XML_OPEN_RE = /<show-widget\b[^>]*>\s*/gi
const SHOW_WIDGET_XML_CLOSE_RE = /\s*<\/show-widget\s*>/gi
const TOOL_CALL_BEFORE_WIDGET_RE = /<tool_call>\s*(?=<show-widget\b)/gi
// Pi 工具调用 XML 闭合：匹配 </parameter> 及其后的 </function> 等残留闭合标签
const PARAMETER_CLOSE_RE = /<\/parameter>(?:\s*<\/\w+>)*/g
const SHOW_WIDGET_BLOCK_RE = /```show-widget[^\n]*\n[\s\S]*?(?:\n```[ \t]*(?=\n|$)|$)/g

/**
 * 将 Pi 偶发输出的 `<tool_call><show-widget>...</show-widget>` 归一化为
 * Kila 的 canonical `\`\`\`show-widget` fence。
 *
 * 这是渲染端兼容层：system prompt 仍要求 fenced block，但不同模型/
 * Pi provider 可能把同一段 payload 序列化为 XML tool-call 外壳。
 */
export function normalizeShowWidgetMarkup(content: string): string {
  if (!content || !/<\/?show-widget\b/i.test(content)) return content

  return content
    // 某些输出同时带有 function/tool_call 标签，避免它们落入 markdown 正文。
    .replace(TOOL_CALL_BEFORE_WIDGET_RE, '')
    // 已观察到的异常格式会重复输出闭合标签，只保留一个。
    .replace(/<\/show-widget\s*>\s*<\/show-widget\s*>/gi, '</show-widget>')
    .replace(SHOW_WIDGET_XML_OPEN_RE, `${OPEN_FENCE}\n`)
    .replace(SHOW_WIDGET_XML_CLOSE_RE, '\n```')
}

function pushMarkdownBlock(blocks: AssistantRenderableBlock[], markdown: string): void {
  if (!markdown) return

  const lastBlock = blocks[blocks.length - 1]
  if (lastBlock?.kind === 'markdown') {
    lastBlock.markdown += markdown
    return
  }

  blocks.push({ kind: 'markdown', markdown })
}

function findFenceHeaderEnd(content: string, openIndex: number): number {
  return content.indexOf('\n', openIndex)
}

interface FenceMatch {
  index: number
  length: number
}

function findClosingFence(content: string, searchStart: number): FenceMatch | null {
  // 标准 Markdown 闭合 fence
  CLOSING_FENCE_RE.lastIndex = searchStart
  const mdMatch = CLOSING_FENCE_RE.exec(content)

  // Pi 工具调用 XML 闭合：show-widget 内容被 <parameter> 包裹，以 </parameter> 收尾
  PARAMETER_CLOSE_RE.lastIndex = searchStart
  const xmlMatch = PARAMETER_CLOSE_RE.exec(content)

  if (!mdMatch && !xmlMatch) return null
  if (mdMatch && !xmlMatch) return { index: mdMatch.index, length: mdMatch[0].length }
  if (!mdMatch && xmlMatch) return { index: xmlMatch.index, length: xmlMatch[0].length }

  // 两者都有，取靠前的
  return mdMatch!.index <= xmlMatch!.index
    ? { index: mdMatch!.index, length: mdMatch![0].length }
    : { index: xmlMatch!.index, length: xmlMatch![0].length }
}

function toPayloadCacheSource(payload: ShowWidgetPayload): string {
  if (isSchemaWidgetPayload(payload)) {
    return JSON.stringify({
      kind: 'schema',
      title: payload.title,
      caption: payload.caption,
      widget_type: payload.widget_type,
      spec: payload.spec,
    })
  }

  return payload.widget_code
}

function repairJsonControlChars(input: string): string {
  // 修复 AI 生成 JSON 中字符串内未转义的控制字符
  let result = ''
  let inString = false
  let escaping = false

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!

    if (escaping) {
      escaping = false
      result += ch
      continue
    }

    if (ch === '\\' && inString) {
      escaping = true
      result += ch
      continue
    }

    if (ch === '"') {
      inString = !inString
      result += ch
      continue
    }

    if (inString) {
      switch (ch) {
        case '\n': result += '\\n'; continue
        case '\r': result += '\\r'; continue
        case '\t': result += '\\t'; continue
        default: break
      }
    }

    result += ch
  }

  return result
}

function tryParsePayload(rawPayload: string): ShowWidgetPayload | null {
  try {
    const parsed = JSON.parse(rawPayload)
    return safeParseShowWidgetPayload(parsed)
  } catch {
    // 尝试修复字符串内未转义的控制字符
    try {
      const repaired = repairJsonControlChars(rawPayload)
      if (repaired === rawPayload) return null

      const parsed = JSON.parse(repaired)
      return safeParseShowWidgetPayload(parsed)
    } catch {
      return null
    }
  }
}

function readPartialJsonStringField(input: string, field: string): PartialJsonStringField | null {
  const fieldPattern = new RegExp(`"${field}"\\s*:\\s*"`, 'i')
  const match = fieldPattern.exec(input)
  if (!match) return null

  let value = ''
  let escaping = false
  let closed = false

  for (let index = match.index + match[0].length; index < input.length; index += 1) {
    const char = input[index]!

    if (escaping) {
      escaping = false

      switch (char) {
        case 'n':
          value += '\n'
          continue
        case 'r':
          value += '\r'
          continue
        case 't':
          value += '\t'
          continue
        case 'b':
          value += '\b'
          continue
        case 'f':
          value += '\f'
          continue
        case '"':
        case '\\':
        case '/':
          value += char
          continue
        case 'u': {
          const unicode = input.slice(index + 1, index + 5)
          if (/^[0-9a-fA-F]{4}$/.test(unicode)) {
            value += String.fromCharCode(Number.parseInt(unicode, 16))
            index += 4
          }
          continue
        }
        default:
          value += char
          continue
      }
    }

    if (char === '\\') {
      escaping = true
      continue
    }

    if (char === '"') {
      closed = true
      break
    }

    value += char
  }

  return { value, closed }
}

function truncatePartialScript(widgetCode: string): {
  widgetCode: string
  scriptsTruncated: boolean
} {
  const lowered = widgetCode.toLowerCase()
  const lastScriptIndex = lowered.lastIndexOf('<script')
  if (lastScriptIndex < 0) {
    return {
      widgetCode,
      scriptsTruncated: false,
    }
  }

  const closingIndex = lowered.indexOf('</script>', lastScriptIndex)
  if (closingIndex >= 0) {
    return {
      widgetCode,
      scriptsTruncated: false,
    }
  }

  return {
    widgetCode: widgetCode.slice(0, lastScriptIndex).trimEnd(),
    scriptsTruncated: true,
  }
}

function isLikelySchemaFence(rawPayload: string): boolean {
  return /"kind"\s*:\s*"schema"/i.test(rawPayload)
    || /"widget_type"\s*:/i.test(rawPayload)
}

function toRenderableBlock(payload: ShowWidgetPayload): AssistantRenderableBlock {
  const cacheKey = getWidgetCacheKey(toPayloadCacheSource(payload))

  if (isSchemaWidgetPayload(payload)) {
    return {
      kind: 'schemaWidget',
      title: payload.title,
      caption: payload.caption,
      widgetType: payload.widget_type,
      spec: payload.spec,
      cacheKey,
    }
  }

  return {
    kind: 'codeWidget',
    title: payload.title,
    widgetCode: payload.widget_code,
    cacheKey,
  }
}

export function parseAssistantRenderableBlocks(content: string): AssistantRenderableBlock[] {
  if (!content) return []

  content = normalizeShowWidgetMarkup(content)

  const blocks: AssistantRenderableBlock[] = []
  let cursor = 0

  while (cursor < content.length) {
    const openIndex = content.indexOf(OPEN_FENCE, cursor)
    if (openIndex < 0) {
      pushMarkdownBlock(blocks, content.slice(cursor))
      break
    }

    pushMarkdownBlock(blocks, content.slice(cursor, openIndex))

    const headerEnd = findFenceHeaderEnd(content, openIndex)
    if (headerEnd < 0) {
      pushMarkdownBlock(blocks, content.slice(openIndex))
      break
    }

    const closingMatch = findClosingFence(content, headerEnd + 1)
    if (!closingMatch) {
      pushMarkdownBlock(blocks, content.slice(openIndex))
      break
    }

    const fenceEnd = closingMatch.index + closingMatch.length
    const rawPayload = content.slice(headerEnd + 1, closingMatch.index)
    const parsedPayload = tryParsePayload(rawPayload.trim())

    if (!parsedPayload) {
      pushMarkdownBlock(blocks, content.slice(openIndex, fenceEnd))
    } else {
      blocks.push(toRenderableBlock(parsedPayload))
    }

    cursor = fenceEnd
  }

  return blocks
}

export function parseStreamingAssistantBlocks(content: string): {
  completedBlocks: AssistantRenderableBlock[]
  partialWidget?: {
    title?: string
    widgetCode: string
    cacheKey: string
    scriptsTruncated: boolean
  }
} {
  if (!content) return { completedBlocks: [] }

  content = normalizeShowWidgetMarkup(content)

  const completedBlocks: AssistantRenderableBlock[] = []
  let cursor = 0

  while (cursor < content.length) {
    const openIndex = content.indexOf(OPEN_FENCE, cursor)
    if (openIndex < 0) {
      pushMarkdownBlock(completedBlocks, content.slice(cursor))
      return { completedBlocks }
    }

    pushMarkdownBlock(completedBlocks, content.slice(cursor, openIndex))

    const headerEnd = findFenceHeaderEnd(content, openIndex)
    if (headerEnd < 0) {
      return { completedBlocks }
    }

    const closingMatch = findClosingFence(content, headerEnd + 1)
    if (!closingMatch) {
      const partialRawPayload = content.slice(headerEnd + 1)
      if (isLikelySchemaFence(partialRawPayload)) {
        return { completedBlocks }
      }

      const titleField = readPartialJsonStringField(partialRawPayload, 'title')
      const widgetCodeField = readPartialJsonStringField(partialRawPayload, 'widget_code')

      if (!widgetCodeField || widgetCodeField.value.length === 0) {
        return { completedBlocks }
      }

      const truncated = truncatePartialScript(widgetCodeField.value)
      const partialWidgetCode = truncated.widgetCode
      if (!partialWidgetCode) {
        return { completedBlocks }
      }

      return {
        completedBlocks,
        partialWidget: {
          title: titleField?.value,
          widgetCode: partialWidgetCode,
          cacheKey: getWidgetCacheKey(partialWidgetCode),
          scriptsTruncated: truncated.scriptsTruncated || !widgetCodeField.closed,
        },
      }
    }

    const fenceEnd = closingMatch.index + closingMatch.length
    const rawPayload = content.slice(headerEnd + 1, closingMatch.index)
    const parsedPayload = tryParsePayload(rawPayload.trim())

    if (!parsedPayload) {
      pushMarkdownBlock(completedBlocks, content.slice(openIndex, fenceEnd))
    } else {
      completedBlocks.push(toRenderableBlock(parsedPayload))
    }

    cursor = fenceEnd
  }

  return { completedBlocks }
}

export function stripWidgetFencesToPlainText(content: string): string {
  if (!content) return ''

  return normalizeShowWidgetMarkup(content)
    .replace(/\r\n?/g, '\n')
    .replace(SHOW_WIDGET_BLOCK_RE, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}
