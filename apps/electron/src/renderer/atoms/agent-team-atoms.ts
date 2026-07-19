import { atom } from 'jotai'
import { normalizeAgentToolName, type AgentEvent, type AgentMessage } from '@kila/shared'
import { currentSessionIdAtom } from './session-atoms'
import {
  agentStreamingStatesAtom,
  getActivityStatus,
  type ActivityStatus,
  type ToolActivity,
} from './agent-stream-atoms'

/** 子代理条目（从 ToolActivity 派生，用于侧面板展示） */
export interface SubAgentEntry {
  toolUseId: string
  toolName: 'Task' | 'Agent'
  name?: string
  subagentType?: string
  description: string
  teamName?: string
  status: ActivityStatus
  elapsedSeconds?: number
  isBackground?: boolean
  taskId?: string
  childActivities: ToolActivity[]
}

// ============================================================================
// Team Overview — 从 ToolActivity 提取丰富的团队信息
// ============================================================================

/** 团队全景信息（从工具调用事件提取） */
export interface TeamOverview {
  /** 团队名称（来自 TeamCreate） */
  teamName?: string
  /** 团队描述 */
  teamDescription?: string
  /** 任务看板项（来自 TaskCreate + TaskUpdate） */
  tasks: TeamTaskItem[]
}

/** 团队任务项 */
export interface TeamTaskItem {
  /** 任务编号（从 result 中解析） */
  taskNumber?: string
  /** 任务主题 */
  subject: string
  /** 任务描述 */
  description?: string
  /** 进行中标签 */
  activeForm?: string
  /** 被哪些任务阻塞 */
  blockedBy: string[]
  /** 状态（来自 TaskUpdate） */
  status?: string
  /** 工具调用 ID */
  toolUseId: string
}

/**
 * 从 ToolActivity[] 构建 SubAgentEntry[]
 *
 * 将 Task/Agent 提取为顶层条目，
 * 其子活动（parentToolUseId 匹配）嵌套在 childActivities 中。
 */
export function buildTeamActivityEntries(activities: ToolActivity[]): SubAgentEntry[] {
  const subAgentIds = new Set<string>()
  const entries: SubAgentEntry[] = []

  for (const activity of activities) {
    if (normalizeAgentToolName(activity.toolName) === 'Task' || normalizeAgentToolName(activity.toolName) === 'Agent') {
      subAgentIds.add(activity.toolUseId)
    }
  }

  if (subAgentIds.size === 0) return []

  const childrenMap = new Map<string, ToolActivity[]>()
  for (const activity of activities) {
    if (activity.parentToolUseId && subAgentIds.has(activity.parentToolUseId)) {
      const children = childrenMap.get(activity.parentToolUseId) ?? []
      children.push(activity)
      childrenMap.set(activity.parentToolUseId, children)
    }
  }

  for (const activity of activities) {
    const normalizedToolName = normalizeAgentToolName(activity.toolName)
    if (normalizedToolName !== 'Task' && normalizedToolName !== 'Agent') continue

    const description = typeof activity.input.description === 'string'
      ? activity.input.description
      : typeof activity.input.prompt === 'string'
        ? activity.input.prompt
        : activity.intent ?? activity.toolName

    entries.push({
      toolUseId: activity.toolUseId,
      toolName: normalizedToolName,
      name: typeof activity.input.name === 'string' ? activity.input.name : undefined,
      subagentType: typeof activity.input.subagent_type === 'string' ? activity.input.subagent_type : undefined,
      description,
      teamName: typeof activity.input.team_name === 'string' ? activity.input.team_name : undefined,
      status: getActivityStatus(activity),
      elapsedSeconds: activity.elapsedSeconds,
      isBackground: activity.isBackground,
      taskId: activity.taskId,
      childActivities: childrenMap.get(activity.toolUseId) ?? [],
    })
  }

  return entries
}

/**
 * 从 ToolActivity[] 提取团队全景信息
 *
 * 解析 TeamCreate、TaskCreate、TaskUpdate 工具调用，
 * 构建团队名称和 Task Board。
 */
export function extractTeamOverview(activities: ToolActivity[]): TeamOverview | null {
  let teamName: string | undefined
  let teamDescription: string | undefined
  const tasks: TeamTaskItem[] = []

  for (const activity of activities) {
    switch (normalizeAgentToolName(activity.toolName)) {
      case 'TeamCreate': {
        if (typeof activity.input.team_name === 'string') teamName = activity.input.team_name
        if (typeof activity.input.description === 'string') teamDescription = activity.input.description
        break
      }

      case 'TaskCreate': {
        const subject = typeof activity.input.subject === 'string' ? activity.input.subject : ''
        if (!subject) break
        let taskNumber: string | undefined
        if (activity.result) {
          const match = activity.result.match(/(?:Task\s+)?#(\d+)/i)
          if (match) taskNumber = match[1]
        }
        tasks.push({
          taskNumber,
          subject,
          description: typeof activity.input.description === 'string' ? activity.input.description : undefined,
          activeForm: typeof activity.input.activeForm === 'string' ? activity.input.activeForm : undefined,
          blockedBy: [],
          toolUseId: activity.toolUseId,
        })
        break
      }

      case 'TaskUpdate': {
        const taskId = typeof activity.input.taskId === 'string' ? activity.input.taskId : undefined
        if (!taskId) break
        const task = tasks.find((item) => item.taskNumber === taskId)
        if (task) {
          if (Array.isArray(activity.input.addBlockedBy)) {
            for (const dependency of activity.input.addBlockedBy) {
              if (typeof dependency === 'string' && !task.blockedBy.includes(dependency)) {
                task.blockedBy.push(dependency)
              }
            }
          }
          if (typeof activity.input.status === 'string') {
            task.status = activity.input.status
          }
        }
        break
      }

      default:
        break
    }
  }

  if (!teamName && tasks.length === 0) return null

  return { teamName, teamDescription, tasks }
}

/**
 * 从持久化消息中重建 Team 数据
 *
 * 页面刷新后，从 JSONL 加载的 AgentMessage.events 中提取
 * ToolActivity[] 和 TeamOverview，用于填充缓存 atoms。
 */
export function rebuildTeamDataFromMessages(messages: AgentMessage[]): {
  toolActivities: ToolActivity[]
  overview: TeamOverview | null
} | null {
  const allEvents: AgentEvent[] = []
  for (const message of messages) {
    if (message.events) allEvents.push(...message.events)
  }
  if (allEvents.length === 0) return null

  const toolActivities: ToolActivity[] = []
  for (const event of allEvents) {
    if (event.type === 'tool_start') {
      toolActivities.push({
        toolUseId: event.toolUseId,
        toolName: normalizeAgentToolName(event.toolName),
        input: event.input ?? {},
        intent: event.intent,
        displayName: event.displayName,
        done: false,
        parentToolUseId: event.parentToolUseId,
      })
    } else if (event.type === 'tool_result') {
      const index = toolActivities.findIndex((activity) => activity.toolUseId === event.toolUseId)
      if (index >= 0) {
        toolActivities[index] = {
          ...toolActivities[index]!,
          result: event.result,
          isError: event.isError,
          done: true,
        }
      }
    }
  }

  const hasTeamActivity = toolActivities.some((activity) => {
    const toolName = normalizeAgentToolName(activity.toolName)
    return toolName === 'TeamCreate'
      || toolName === 'TaskCreate'
      || toolName === 'Agent'
      || toolName === 'Task'
  })

  if (!hasTeamActivity) return null

  const overview = extractTeamOverview(toolActivities)
  return { toolActivities, overview }
}

/**
 * Team 活动缓存 — 以 sessionId 为 key
 *
 * 流式完成后 agentStreamingStatesAtom 会被清除，
 * 此缓存在清除前保存 Team 活动数据，确保面板内容不丢失。
 */
export const cachedTeamActivitiesAtom = atom<Map<string, SubAgentEntry[]>>(new Map())

/**
 * TeamOverview 缓存 — 以 sessionId 为 key
 *
 * 流式完成后保存 TeamOverview 快照，确保切换 tab 后团队全景数据不丢失。
 */
export const cachedTeamOverviewsAtom = atom<Map<string, TeamOverview>>(new Map())

/**
 * 已关闭 Team 面板的 sessionId 集合
 *
 * 用户主动关闭 Team 活动面板后，阻止 derived atoms 返回数据。
 * 当新一轮流式请求开始时自动清除（允许新 Team 数据显示）。
 */
export const dismissedTeamSessionIdsAtom = atom<Set<string>>(new Set<string>())

/** 当前会话是否有 Team/Task 活动（派生只读原子，同时检查流式状态和缓存） */
export const hasTeamActivityAtom = atom<boolean>((get) => {
  const currentId = get(currentSessionIdAtom)
  if (!currentId) return false
  if (get(dismissedTeamSessionIdsAtom).has(currentId)) return false

  const state = get(agentStreamingStatesAtom).get(currentId)
  if (state) {
    const hasActivity = state.toolActivities.some(
      (activity) => normalizeAgentToolName(activity.toolName) === 'Task' || normalizeAgentToolName(activity.toolName) === 'Agent',
    )
    if (hasActivity) return true
  }

  const cached = get(cachedTeamActivitiesAtom).get(currentId)
  return cached !== undefined && cached.length > 0
})

/** 当前会话的 Team 活动数据（派生只读原子，同时读取流式状态和缓存） */
export const teamActivityEntriesAtom = atom<SubAgentEntry[]>((get) => {
  const currentId = get(currentSessionIdAtom)
  if (!currentId) return []
  if (get(dismissedTeamSessionIdsAtom).has(currentId)) return []

  const state = get(agentStreamingStatesAtom).get(currentId)
  if (state && state.toolActivities.length > 0) {
    const entries = buildTeamActivityEntries(state.toolActivities)
    if (entries.length > 0) return entries
  }

  return get(cachedTeamActivitiesAtom).get(currentId) ?? []
})

/** 运行中的子代理数量（用于 badge 指示器） */
export const teamActivityCountAtom = atom<number>((get) => {
  const entries = get(teamActivityEntriesAtom)
  return entries.filter((entry) => entry.status === 'running' || entry.status === 'backgrounded').length
})

/** 团队全景信息（派生只读原子，从 toolActivities 提取，回退到缓存） */
export const teamOverviewAtom = atom<TeamOverview | null>((get) => {
  const currentId = get(currentSessionIdAtom)
  if (!currentId) return null
  if (get(dismissedTeamSessionIdsAtom).has(currentId)) return null

  const state = get(agentStreamingStatesAtom).get(currentId)
  if (state) {
    const overview = extractTeamOverview(state.toolActivities)
    if (overview) return overview
  }

  return get(cachedTeamOverviewsAtom).get(currentId) ?? null
})
