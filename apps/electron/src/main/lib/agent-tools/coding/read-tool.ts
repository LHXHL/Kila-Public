import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { CodingTool } from '@kila/shared'
import {
  CodingToolError,
  READ_DEFAULT_LIMIT,
  READ_MAX_BYTES,
  READ_MAX_LIMIT,
  READ_TOOL_PARAMETERS,
  parseReadInput,
} from './schemas'
import type { CodingPathPolicy } from './path-policy'

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

export function createReadTool(policy: CodingPathPolicy): CodingTool {
  return {
    name: 'read',
    label: 'Read',
    description: '读取工作区内的文本文件或返回受控图片文件引用。',
    parameters: READ_TOOL_PARAMETERS,
    permission: 'read',
    execute: async (_toolCallId, rawInput) => {
      const input = parseReadInput(rawInput)
      const targetPath = policy.resolveReadPath(input.path)
      const buffer = await readFile(targetPath)
      const mimeType = IMAGE_MIME_TYPES[extname(targetPath).toLowerCase()]
      if (mimeType) {
        return {
          text: `[图片文件]\n路径: ${targetPath}\nMIME: ${mimeType}`,
          details: {
            imageRef: { path: targetPath, mimeType, bytes: buffer.byteLength },
          },
        }
      }

      let text: string
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
      } catch {
        throw new CodingToolError('coding_read_invalid_encoding', `文件不是有效的 UTF-8 文本: ${input.path}`)
      }
      if (text.codePointAt(0) === 0xfeff) text = text.slice(1)

      const offset = normalizeOffset(input.offset)
      const limit = normalizeLimit(input.limit)
      const lines = text.split(/\r?\n/)
      const selectedLines: string[] = []
      for (let index = offset - 1; index < lines.length && selectedLines.length < limit; index += 1) {
        selectedLines.push(lines[index] ?? '')
      }

      let selected = selectedLines.join('\n')
      let truncated = selectedLines.length < Math.max(0, lines.length - offset + 1)
      if (Buffer.byteLength(selected, 'utf8') > READ_MAX_BYTES) {
        selected = truncateTextToBytes(selected, READ_MAX_BYTES)
        truncated = true
      }

      return {
        text: selected,
        details: {
          path: targetPath,
          offset,
          limit,
          truncation: {
            truncated,
            ...(truncated ? { nextOffset: offset + selectedLines.length } : {}),
          },
        },
      }
    },
  }
}

function normalizeOffset(offset: number | undefined): number {
  if (offset === undefined) return 1
  if (offset < 1) throw new CodingToolError('coding_invalid_args', 'offset 必须大于等于 1')
  return offset
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return READ_DEFAULT_LIMIT
  if (limit < 1 || limit > READ_MAX_LIMIT) {
    throw new CodingToolError('coding_invalid_args', `limit 必须在 1 到 ${READ_MAX_LIMIT} 之间`)
  }
  return limit
}

function truncateTextToBytes(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, 'utf8')
  if (buffer.byteLength <= maxBytes) return text
  return new TextDecoder('utf-8', { fatal: false }).decode(buffer.subarray(0, maxBytes))
}

