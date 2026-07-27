import { normalizeAgentToolName } from '@kila/shared'
import i18n from '@/lib/i18n'
import {
  type ActivityGroup,
  type ActivityStatus,
  type ToolActivity,
  isActivityGroup,
} from '@/atoms/agent-atoms'

export const normalizeToolName = normalizeAgentToolName

export function getToolDisplayName(toolName: string): string {
  const normalizedToolName = normalizeToolName(toolName)
  if (normalizedToolName === 'generate_image') return 'Generate image'
  return normalizedToolName
}

export function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 1) return `${Math.max(1, Math.round(seconds * 1000))} ms`
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return `${minutes}m${remainingSeconds}s`
}

export function extractFilePath(input: Record<string, unknown>): string | null {
  const filePath = input.file_path ?? input.filePath ?? input.path ?? input.notebook_path
  return typeof filePath === 'string' && filePath.length > 0 ? filePath : null
}

export function getInputSummary(toolName: string, input: Record<string, unknown>): string | null {
  const normalizedToolName = normalizeToolName(toolName)

  if (normalizedToolName === 'Bash') {
    const command = input.command
    if (typeof command === 'string') return command.length > 80 ? `${command.slice(0, 80)}…` : command
  }
  if (normalizedToolName === 'Grep') {
    const pattern = input.pattern
    if (typeof pattern === 'string') return `/${pattern}/`
  }
  if (normalizedToolName === 'Glob') {
    const pattern = input.pattern
    if (typeof pattern === 'string') return pattern
  }
  if (normalizedToolName === 'WebFetch' || normalizedToolName === 'WebSearch') {
    const target = input.url ?? input.query
    if (typeof target === 'string') return target.length > 60 ? `${target.slice(0, 60)}…` : target
  }
  if (normalizedToolName === 'Skill') {
    const skill = input.skill
    if (typeof skill === 'string') return skill
  }
  if (normalizedToolName === 'Task') {
    const description = input.description ?? input.prompt
    if (typeof description === 'string') return description.length > 80 ? `${description.slice(0, 80)}…` : description
  }
  if (normalizedToolName === 'TaskCreate') {
    const subject = input.subject
    if (typeof subject === 'string') return subject.length > 80 ? `${subject.slice(0, 80)}…` : subject
  }
  if (normalizedToolName === 'TaskUpdate') {
    const parts: string[] = []
    if (typeof input.taskId === 'string') parts.push(`#${input.taskId}`)
    if (typeof input.status === 'string') parts.push(input.status)
    if (typeof input.subject === 'string') parts.push(input.subject.length > 60 ? `${input.subject.slice(0, 60)}…` : input.subject)
    return parts.length > 0 ? parts.join(' ') : null
  }
  if (normalizedToolName === 'TaskGet') {
    const taskId = input.taskId
    if (typeof taskId === 'string') return `#${taskId}`
  }
  if (normalizedToolName === 'TaskList') {
    const reason = input.reason
    if (typeof reason === 'string') return reason.length > 80 ? `${reason.slice(0, 80)}…` : reason
    return i18n.t('agent.tool.taskList')
  }
  if (normalizedToolName === 'Read') {
    const filePath = input.file_path ?? input.filePath
    if (typeof filePath === 'string') {
      const filename = filePath.split('/').pop() ?? filePath
      const offset = typeof input.offset === 'number' ? input.offset : null
      const limit = typeof input.limit === 'number' ? input.limit : null
      if (offset !== null || limit !== null) {
        const range = [offset !== null ? `L${offset}` : '', limit !== null ? `+${limit}` : ''].filter(Boolean).join(' ')
        return `${filename} ${range}`
      }
      return filename
    }
  }
  if (normalizedToolName === 'Edit' || normalizedToolName === 'Write') {
    const filePath = input.file_path ?? input.filePath
    if (typeof filePath === 'string') return filePath.split('/').pop() ?? filePath
  }
  if (normalizedToolName === 'NotebookEdit') {
    const filePath = input.notebook_path
    if (typeof filePath === 'string') return filePath.split('/').pop() ?? filePath
  }
  if (normalizedToolName === 'TodoWrite') {
    const todos = input.todos
    if (Array.isArray(todos)) return i18n.t('agent.tool.todoCount', { count: todos.length })
  }
  if (normalizedToolName === 'TeamCreate') {
    const name = input.team_name
    const description = input.description
    if (typeof name === 'string') {
      if (typeof description === 'string') return `${name} · ${description.length > 60 ? `${description.slice(0, 60)}…` : description}`
      return name
    }
  }
  if (normalizedToolName === 'Agent') {
    const agentName = input.name
    const description = input.description ?? input.prompt
    if (typeof agentName === 'string' && typeof description === 'string') {
      return `${agentName} · ${description.length > 60 ? `${description.slice(0, 60)}…` : description}`
    }
    if (typeof description === 'string') return description.length > 80 ? `${description.slice(0, 80)}…` : description
    if (typeof agentName === 'string') return agentName
  }
  if (normalizedToolName === 'generate_image') {
    const prompt = input.prompt
    if (typeof prompt === 'string') return prompt.length > 80 ? `${prompt.slice(0, 80)}…` : prompt
  }
  return null
}

export function getToolActivityTarget(activity: ToolActivity): string | null {
  return getInputSummary(activity.toolName, activity.input)
    ?? activity.displayName
    ?? activity.intent
    ?? null
}

export function getToolActivityTitle(activity: ToolActivity): string {
  return getToolActivityTarget(activity) ?? getToolDisplayName(activity.toolName)
}


// 工具输出可能达到数 MB；限制单个 DOM 文本节点，完整内容仍可通过复制获取。
export const TOOL_RESULT_PREVIEW_CHARS = 2_000
export const TOOL_RESULT_EXPANDED_CHARS = 48_000

export function getRenderedToolResult(result: string, expanded: boolean): { text: string; truncated: boolean } {
  const limit = expanded ? TOOL_RESULT_EXPANDED_CHARS : TOOL_RESULT_PREVIEW_CHARS
  if (result.length <= limit) return { text: result, truncated: false }
  return {
    text: `${result.slice(0, limit)}\n… ${i18n.t('agent.tool.resultTruncated')}`,
    truncated: true,
  }
}

export interface CompactActivityGroup {
  kind: 'compact-group'
  key: string
  toolName: string
  activities: ToolActivity[]
  status: ActivityStatus
  elapsedSeconds?: number
}

export function isCompactActivityGroup(
  item: ActivityGroup | ToolActivity | CompactActivityGroup,
): item is CompactActivityGroup {
  return 'kind' in item && item.kind === 'compact-group'
}

function canCompactActivity(activity: ToolActivity): boolean {
  if (!activity.done || activity.isError) return false
  const toolName = normalizeToolName(activity.toolName)
  if (toolName === 'TodoWrite' || toolName === 'TaskCreate' || toolName === 'Task') return false
  if (activity.imageAttachments && activity.imageAttachments.length > 0) return false
  return true
}

export function compactAdjacentToolActivities(
  items: Array<ActivityGroup | ToolActivity>,
): Array<ActivityGroup | ToolActivity | CompactActivityGroup> {
  const compacted: Array<ActivityGroup | ToolActivity | CompactActivityGroup> = []
  let pending: ToolActivity[] = []

  const flush = (): void => {
    if (pending.length === 0) return
    if (pending.length < 3) {
      compacted.push(...pending)
    } else {
      const first = pending[0]!
      const latest = pending[pending.length - 1]!
      compacted.push({
        kind: 'compact-group',
        key: `${normalizeToolName(latest.toolName)}:${first.toolUseId}:${latest.toolUseId}`,
        toolName: latest.toolName,
        activities: pending,
        status: 'completed',
        elapsedSeconds: pending.reduce((sum, activity) => sum + (activity.elapsedSeconds ?? 0), 0),
      })
    }
    pending = []
  }

  for (const item of items) {
    if (isActivityGroup(item) || !canCompactActivity(item)) {
      flush()
      compacted.push(item)
      continue
    }

    const previous = pending[pending.length - 1]
    if (!previous || normalizeToolName(previous.toolName) === normalizeToolName(item.toolName)) {
      pending.push(item)
    } else {
      flush()
      pending.push(item)
    }
  }

  flush()
  return compacted
}
