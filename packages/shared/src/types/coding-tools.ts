/**
 * Kila 自有 coding tools 的跨边界类型。
 *
 * 这些类型故意不依赖 Pi SDK，便于主进程 ToolHost 和隔离 Runtime
 * 分别实现工具执行端与 proxy tool。
 */

export interface ReadToolInput {
  path: string
  offset?: number
  limit?: number
}

export interface WriteToolInput {
  path: string
  content: string
}

export interface EditToolInput {
  path: string
  edits: Array<{
    oldText: string
    newText: string
  }>
}

export interface BashToolInput {
  command: string
  timeout?: number
}

export type CodingToolInput = ReadToolInput | WriteToolInput | EditToolInput | BashToolInput

export type CodingToolPermission = 'read' | 'write' | 'execute'

export interface CodingToolUpdate {
  partialText: string
  details?: Record<string, unknown>
}

export interface CodingToolResult {
  text: string
  details?: Record<string, unknown>
}

/** Coding tool 写入 ProcessRegistry 时使用的 Runtime 身份。 */
export interface CodingToolExecutionContext {
  appBootId: string
  bootId: string
  sessionId: string
  generation: number
  runId: string
  toolId: string
}

export interface CodingTool {
  name: 'read' | 'write' | 'edit' | 'bash'
  label: string
  description: string
  parameters: Record<string, unknown>
  permission: CodingToolPermission
  execute: (
    toolCallId: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: (update: CodingToolUpdate) => void,
    context?: CodingToolExecutionContext,
  ) => Promise<CodingToolResult>
}
