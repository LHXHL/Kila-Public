import type { EditToolInput, ReadToolInput, WriteToolInput, BashToolInput } from '@kila/shared'

export const READ_MAX_BYTES = 256 * 1024
export const READ_DEFAULT_LIMIT = 2000
export const READ_MAX_LIMIT = 10000
export const WRITE_MAX_BYTES = 8 * 1024 * 1024
export const EDIT_MAX_INPUT_BYTES = 16 * 1024 * 1024
export const EDIT_MAX_EDITS = 100
export const BASH_MAX_COMMAND_BYTES = 128 * 1024
export const BASH_DEFAULT_TIMEOUT_MS = 120_000
export const BASH_MIN_TIMEOUT_MS = 1_000
export const BASH_MAX_TIMEOUT_MS = 600_000

export const READ_TOOL_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    path: { type: 'string', description: '要读取的文件路径' },
    offset: { type: 'number', description: '起始行号，从 1 开始' },
    limit: { type: 'number', description: '最多返回的行数' },
  },
  required: ['path'],
}

export const WRITE_TOOL_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    path: { type: 'string', description: '要写入的文件路径' },
    content: { type: 'string', description: '完整文件内容' },
  },
  required: ['path', 'content'],
}

export const EDIT_TOOL_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    path: { type: 'string', description: '要修改的文件路径' },
    edits: {
      type: 'array',
      description: '按顺序应用的精确文本替换列表',
      items: {
        type: 'object',
        properties: {
          oldText: { type: 'string' },
          newText: { type: 'string' },
        },
        required: ['oldText', 'newText'],
      },
    },
  },
  required: ['path', 'edits'],
}

export const BASH_TOOL_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    command: { type: 'string', description: '要执行的 shell 命令' },
    timeout: { type: 'number', description: '超时时间，单位为毫秒' },
  },
  required: ['command'],
}

export class CodingToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'CodingToolError'
  }
}

export function asRecord(value: unknown, toolName: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CodingToolError('coding_invalid_args', `${toolName} 工具参数必须是对象`)
  }
  return value as Record<string, unknown>
}

export function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new CodingToolError('coding_invalid_args', `${field} 必须是字符串`)
  }
  return value
}

export function parseReadInput(value: unknown): ReadToolInput {
  const input = asRecord(value, 'read')
  const offset = input.offset === undefined ? undefined : parseFiniteNumber(input.offset, 'offset')
  const limit = input.limit === undefined ? undefined : parseFiniteNumber(input.limit, 'limit')
  return {
    path: asString(input.path, 'path'),
    ...(offset === undefined ? {} : { offset }),
    ...(limit === undefined ? {} : { limit }),
  }
}

export function parseWriteInput(value: unknown): WriteToolInput {
  const input = asRecord(value, 'write')
  return {
    path: asString(input.path, 'path'),
    content: asString(input.content, 'content'),
  }
}

export function parseEditInput(value: unknown): EditToolInput {
  const input = asRecord(value, 'edit')
  if (!Array.isArray(input.edits)) {
    throw new CodingToolError('coding_invalid_args', 'edits 必须是数组')
  }
  return {
    path: asString(input.path, 'path'),
    edits: input.edits.map((edit, index) => {
      const record = asRecord(edit, `edits[${index}]`)
      return {
        oldText: asString(record.oldText, `edits[${index}].oldText`),
        newText: asString(record.newText, `edits[${index}].newText`),
      }
    }),
  }
}

export function parseBashInput(value: unknown): BashToolInput {
  const input = asRecord(value, 'bash')
  const timeout = input.timeout === undefined ? undefined : parseFiniteNumber(input.timeout, 'timeout')
  return {
    command: asString(input.command, 'command'),
    ...(timeout === undefined ? {} : { timeout }),
  }
}

function parseFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CodingToolError('coding_invalid_args', `${field} 必须是有限数字`)
  }
  return Math.floor(value)
}

