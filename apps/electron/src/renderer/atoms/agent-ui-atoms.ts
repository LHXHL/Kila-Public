import { atom } from 'jotai'
import type {
  AgentMessage,
  AgentPendingFile,
  QuickSuggestion,
  SessionMeta,
  SessionSendInput,
  ThinkingLevel,
  WidgetDraftIntent,
} from '@kila/shared'
import { currentSessionIdAtom, sessionsAtom } from './session-atoms'

/** 待自动发送的 Agent 提示（从设置页"session完成配置"触发） */
export interface AgentPendingPrompt {
  sessionId: string
  message: string
}

export interface AgentQueuedSend {
  id: string
  sessionId: string
  input: SessionSendInput
  createdAt: number
}

export type AgentSidePanelToolId = 'files' | 'web' | 'tools' | 'git'

/**
 * 后台任务数据结构
 *
 * 用于 ActiveTasksBar 显示运行中的 Agent 任务和 Shell 任务。
 */
export interface BackgroundTask {
  /** 任务或 Shell ID */
  id: string
  /** 任务类型 */
  type: 'agent' | 'shell'
  /** 关联的工具调用 ID（用于滚动定位到 ToolActivityItem） */
  toolUseId: string
  /** 任务开始时间戳 */
  startTime: number
  /** 已耗时（秒） */
  elapsedSeconds: number
  /** 任务意图/描述 */
  intent?: string
}

export const agentChannelIdAtom = atom<string | null>(null)
export const agentModelIdAtom = atom<string | null>(null)
export const currentAgentMessagesAtom = atom<AgentMessage[]>([])
export const agentPendingPromptAtom = atom<AgentPendingPrompt | null>(null)

/** Agent 待发送文件列表（按 Session 隔离，避免切换标签时附件串会话） */
export const agentPendingFilesMapAtom = atom<Map<string, AgentPendingFile[]>>(new Map())

export function disposePendingFiles(
  files: readonly AgentPendingFile[],
  dataStore?: Map<string, string>,
  revokeObjectUrl?: (url: string) => void,
): void {
  for (const file of files) {
    if (file.previewUrl?.startsWith('blob:')) {
      revokeObjectUrl?.(file.previewUrl)
    }
    dataStore?.delete(file.id)
  }
}

export function setSessionPendingFilesMap(
  map: Map<string, AgentPendingFile[]>,
  sessionId: string,
  files: AgentPendingFile[],
): Map<string, AgentPendingFile[]> {
  const current = map.get(sessionId) ?? []
  if (current === files) return map

  const next = new Map(map)
  if (files.length === 0) {
    next.delete(sessionId)
  } else {
    next.set(sessionId, files)
  }
  return next
}

/** 等待执行结束后自动发送的消息队列 */
export const agentQueuedSendMapAtom = atom<Map<string, readonly AgentQueuedSend[]>>(new Map())

export function enqueueQueuedSendMap(
  map: Map<string, readonly AgentQueuedSend[]>,
  item: AgentQueuedSend,
): Map<string, readonly AgentQueuedSend[]> {
  const queue = [...(map.get(item.sessionId) ?? []), item]
  const next = new Map(map)
  next.set(item.sessionId, queue)
  return next
}

export function prependQueuedSendMap(
  map: Map<string, readonly AgentQueuedSend[]>,
  item: AgentQueuedSend,
): Map<string, readonly AgentQueuedSend[]> {
  const queue = [item, ...(map.get(item.sessionId) ?? [])]
  const next = new Map(map)
  next.set(item.sessionId, queue)
  return next
}

export function shiftQueuedSendMap(
  map: Map<string, readonly AgentQueuedSend[]>,
  sessionId: string,
): { map: Map<string, readonly AgentQueuedSend[]>; item: AgentQueuedSend | null } {
  const queue = map.get(sessionId) ?? []
  if (queue.length === 0) {
    return { map, item: null }
  }

  const [item, ...rest] = queue
  const next = new Map(map)
  if (rest.length > 0) {
    next.set(sessionId, rest)
  } else {
    next.delete(sessionId)
  }

  return { map: next, item: item ?? null }
}

export function removeQueuedSendMapItem(
  map: Map<string, readonly AgentQueuedSend[]>,
  sessionId: string,
  queuedId: string,
): Map<string, readonly AgentQueuedSend[]> {
  const queue = map.get(sessionId) ?? []
  const nextQueue = queue.filter((item) => item.id !== queuedId)
  if (nextQueue.length === queue.length) return map

  const next = new Map(map)
  if (nextQueue.length > 0) {
    next.set(sessionId, nextQueue)
  } else {
    next.delete(sessionId)
  }
  return next
}

/** Agent 能力版本号（沿用旧名）— 每次修改全局 MCP/Skills 后自增，触发提及建议与设置页刷新 */
export const workspaceCapabilitiesVersionAtom = atom(0)

/** 工作区文件版本号 — 文件变化时自增，触发文件浏览器重新加载 */
export const workspaceFilesVersionAtom = atom(0)

/** 侧面板当前激活工具（per-session Map） */
export const agentSidePanelActiveToolMapAtom = atom<Map<string, AgentSidePanelToolId | null>>(new Map())

/** 侧面板关闭请求（per-session Map，值为请求时间戳） */
export const agentSidePanelCloseRequestMapAtom = atom<Map<string, number>>(new Map())

/** Agent 默认思考等级 */
export const agentThinkingLevelAtom = atom<ThinkingLevel>('none')

/** Agent 最大预算（美元/次） */
export const agentMaxBudgetUsdAtom = atom<number | undefined>(undefined)

/** Agent 最大轮次 */
export const agentMaxTurnsAtom = atom<number | undefined>(undefined)

export const currentAgentSessionAtom = atom<SessionMeta | null>((get) => {
  const sessions = get(sessionsAtom)
  const currentId = get(currentSessionIdAtom)
  if (!currentId) return null
  return sessions.find((session) => session.id === currentId) ?? null
})

/**
 * Agent 流式错误消息 Map — 以 sessionId 为 key
 * 错误发生时写入，下次发送或手动关闭时清除
 */
export const agentStreamErrorsAtom = atom<Map<string, string>>(new Map())

/**
 * Agent 消息刷新版本 Map — 以 sessionId 为 key
 * 全局监听器在流式完成/错误时递增版本号，
 * AgentView 监听版本号变化来重新加载消息。
 */
export const agentMessageRefreshAtom = atom<Map<string, number>>(new Map())

/** 会话消息正在从持久化存储重新水合，用于保留已完成流式气泡直到消息落屏 */
export const agentMessageHydratingAtom = atom<Set<string>>(new Set<string>())

/** 当前 Agent 会话的错误消息（派生只读原子） */
export const currentAgentErrorAtom = atom<string | null>((get) => {
  const currentId = get(currentSessionIdAtom)
  if (!currentId) return null
  return get(agentStreamErrorsAtom).get(currentId) ?? null
})

/**
 * Agent 会话输入框草稿 Map — 以 sessionId 为 key
 * 用于在切换会话时保留输入框内容
 */
export const agentSessionDraftsAtom = atom<Map<string, string>>(new Map())

/** Widget draft proposal Map — 以 sessionId 为 key，存储待确认的 widget follow-up 草稿 */
export const widgetDraftProposalMapAtom = atom<Map<string, WidgetDraftIntent>>(new Map())

/**
 * 会话附加目录 Map — 以 sessionId 为 key
 * 存储每个会话通过"附加文件夹"功能关联的外部目录路径列表。
 * 这些路径作为 SDK additionalDirectories 参数传递。
 */
export const agentAttachedDirectoriesMapAtom = atom<Map<string, string[]>>(new Map())

/**
 * 工作区级附加目录列表（按 workspaceId 存储）
 *
 * 工作区内所有会话共享这些附加目录。
 */
export const workspaceAttachedDirectoriesMapAtom = atom<Map<string, string[]>>(new Map())

/** 当前 Agent 会话的草稿内容（派生读写原子） */
export const currentAgentSessionDraftAtom = atom(
  (get) => {
    const currentId = get(currentSessionIdAtom)
    if (!currentId) return ''
    return get(agentSessionDraftsAtom).get(currentId) ?? ''
  },
  (get, set, newDraft: string) => {
    const currentId = get(currentSessionIdAtom)
    if (!currentId) return
    set(agentSessionDraftsAtom, (prev) => {
      const map = new Map(prev)
      if (newDraft.trim() === '') {
        map.delete(currentId)
      } else {
        map.set(currentId, newDraft)
      }
      return map
    })
  },
)

/** 当前 Agent 会话的 widget 草稿提案（派生只读原子） */
export const currentWidgetDraftProposalAtom = atom<WidgetDraftIntent | null>((get) => {
  const currentId = get(currentSessionIdAtom)
  if (!currentId) return null
  return get(widgetDraftProposalMapAtom).get(currentId) ?? null
})

export const setWidgetDraftProposalAtom = atom(
  null,
  (_get, set, input: { sessionId: string; proposal: WidgetDraftIntent }) => {
    set(widgetDraftProposalMapAtom, (prev) => {
      const map = new Map(prev)
      map.set(input.sessionId, input.proposal)
      return map
    })
  },
)

export const clearWidgetDraftProposalAtom = atom(
  null,
  (_get, set, sessionId: string) => {
    set(widgetDraftProposalMapAtom, (prev) => {
      if (!prev.has(sessionId)) return prev
      const map = new Map(prev)
      map.delete(sessionId)
      return map
    })
  },
)

/** Agent 提示建议 Map — 以 sessionId 为 key，存储最近一条建议 */
export const agentPromptSuggestionsAtom = atom<Map<string, string>>(new Map())

/** 当前 Agent 会话的提示建议（派生只读原子） */
export const currentAgentSuggestionAtom = atom<string | null>((get) => {
  const currentId = get(currentSessionIdAtom)
  if (!currentId) return null
  return get(agentPromptSuggestionsAtom).get(currentId) ?? null
})

/** 欢迎界面快捷建议 — 应用启动时 LLM 生成并缓存（所有空会话共享） */
export const sessionQuickSuggestionsAtom = atom<QuickSuggestion[]>([])

/** 隐身模式 — 开启后本条消息不加入记忆（per-message，发送后自动关闭） */
export const incognitoModeAtom = atom<boolean>(false)

/**
 * 后台任务列表原子家族（替代已废弃的 jotai atomFamily）
 *
 * 按 sessionId 隔离，每个会话独立管理后台任务。
 * 任务完成后从列表中移除（只显示运行中任务）。
 */
const backgroundTasksAtomCache = new Map<string, ReturnType<typeof atom<BackgroundTask[]>>>()

export function backgroundTasksAtomFamily(sessionId: string) {
  let cached = backgroundTasksAtomCache.get(sessionId)
  if (!cached) {
    cached = atom<BackgroundTask[]>([])
    backgroundTasksAtomCache.set(sessionId, cached)
  }
  return cached
}

/** Session 删除后释放 atom family 缓存，避免长期运行时保留已删除会话。 */
export function releaseBackgroundTasksAtom(sessionId: string): void {
  backgroundTasksAtomCache.delete(sessionId)
}
