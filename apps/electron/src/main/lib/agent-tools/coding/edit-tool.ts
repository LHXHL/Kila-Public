import { readFile } from 'node:fs/promises'
import type { CodingTool } from '@kila/shared'
import {
  CodingToolError,
  EDIT_MAX_EDITS,
  EDIT_MAX_INPUT_BYTES,
  EDIT_TOOL_PARAMETERS,
  parseEditInput,
} from './schemas'
import type { CodingPathPolicy } from './path-policy'
import { writeTextAtomically } from './write-tool'

export function createEditTool(policy: CodingPathPolicy): CodingTool {
  return {
    name: 'edit',
    label: 'Edit',
    description: '对工作区内的文本文件应用精确且顺序执行的文本替换。',
    parameters: EDIT_TOOL_PARAMETERS,
    permission: 'write',
    execute: async (_toolCallId, rawInput) => {
      const input = parseEditInput(rawInput)
      if (input.edits.length > EDIT_MAX_EDITS) {
        throw new CodingToolError('coding_edit_too_many_edits', `单次最多支持 ${EDIT_MAX_EDITS} 个 edit`)
      }

      const targetPath = policy.resolveWritePath(input.path)
      const originalBuffer = await readFile(targetPath)
      if (originalBuffer.byteLength > EDIT_MAX_INPUT_BYTES) {
        throw new CodingToolError('coding_edit_too_large', `待编辑文件超过 ${EDIT_MAX_INPUT_BYTES} 字节限制`)
      }

      let original: string
      try {
        original = new TextDecoder('utf-8', { fatal: true }).decode(originalBuffer)
      } catch {
        throw new CodingToolError('coding_read_invalid_encoding', `文件不是有效的 UTF-8 文本: ${input.path}`)
      }
      if (original.codePointAt(0) === 0xfeff) original = original.slice(1)

      let edited = original
      let firstChangedLine: number | undefined
      for (const edit of input.edits) {
        if (edit.oldText.length === 0) {
          throw new CodingToolError('coding_edit_not_found', 'oldText 不能为空')
        }
        const firstIndex = edited.indexOf(edit.oldText)
        if (firstIndex < 0) {
          throw new CodingToolError('coding_edit_not_found', `未找到要替换的文本: ${edit.oldText}`)
        }
        if (edited.indexOf(edit.oldText, firstIndex + edit.oldText.length) >= 0) {
          throw new CodingToolError('coding_edit_ambiguous', `要替换的文本出现多次，无法安全编辑: ${edit.oldText}`)
        }
        if (firstChangedLine === undefined) {
          firstChangedLine = edited.slice(0, firstIndex).split('\n').length
        }
        edited = `${edited.slice(0, firstIndex)}${edit.newText}${edited.slice(firstIndex + edit.oldText.length)}`
      }

      const diff = createCompactDiff(original, edited)
      const bytesWritten = await writeTextAtomically(targetPath, edited)
      return {
        text: `已修改 ${targetPath}`,
        details: {
          path: targetPath,
          diff,
          patch: diff,
          firstChangedLine,
          bytesWritten,
        },
      }
    },
  }
}

function createCompactDiff(before: string, after: string): string {
  if (before === after) return ''
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  let prefix = 0
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < beforeLines.length - prefix
    && suffix < afterLines.length - prefix
    && beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const oldMiddle = beforeLines.slice(prefix, beforeLines.length - suffix)
  const newMiddle = afterLines.slice(prefix, afterLines.length - suffix)
  const header = `@@ -${prefix + 1},${oldMiddle.length} +${prefix + 1},${newMiddle.length} @@`
  return [header, ...oldMiddle.map((line) => `-${line}`), ...newMiddle.map((line) => `+${line}`)].join('\n')
}

