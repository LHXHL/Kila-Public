import type { AgentMessage } from '@kila/shared'

export interface LiveAssistantTurnVisibilityInput {
  streaming: boolean
  hydratingMessages: boolean
  hasVisibleStreamingContent: boolean
  hasTimelineEntries: boolean
  retrying: boolean
  messages: readonly Pick<AgentMessage, 'role'>[]
}

/**
 * 已完成的流式内容只用于桥接持久化消息加载前的空窗。
 * 一旦最新消息已是 assistant，持久化消息就接管本轮展示，避免同一组思考事件重复渲染。
 */
export function shouldShowLiveAssistantTurn({
  streaming,
  hydratingMessages,
  hasVisibleStreamingContent,
  hasTimelineEntries,
  retrying,
  messages,
}: LiveAssistantTurnVisibilityInput): boolean {
  if (streaming) return true

  const latestPersistedMessage = messages[messages.length - 1]
  if (latestPersistedMessage?.role === 'assistant') return false

  return hydratingMessages
    || hasVisibleStreamingContent
    || hasTimelineEntries
    || retrying
}
