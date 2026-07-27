/**
 * AgentMessages — Agent 消息列表
 *
 * 分页消息窗口 + 离屏渲染优化 + 流式更新 + 迷你地图。
 * 子组件已拆分至 AgentMessageItem.tsx、process-cards.tsx、
 * use-process-disclosure.ts、agent-messages-utils.ts。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Message, MessageContent, StreamingIndicator } from '@/components/ai-elements/message'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { ScrollMinimap } from '@/components/ai-elements/scroll-minimap'
import type { MinimapItem } from '@/components/ai-elements/scroll-minimap'
import { useSmoothStreamContent } from '@kila/ui'
import { useElementWidth } from '@/hooks/use-element-width'
import { useMessageHeightRegistry } from '@/hooks/use-message-height-registry'
import {
  ASSISTANT_MESSAGE_MAX_WIDTH_PX,
  USER_MESSAGE_MAX_WIDTH_PX,
} from '@/lib/pretext/config'
import { upsertSessionPinnedWidgetAtom } from '@/atoms/session-board-atoms'
import { setWidgetDraftProposalAtom, buildAssistantTurnTimelineEntries, type AgentStreamState } from '@/atoms/agent-atoms'
import { agentMessageHydratingAtom } from '@/atoms/agent-ui-atoms'
import { useBackgroundTasks } from '@/hooks/useBackgroundTasks'
import { userProfileAtom } from '@/atoms/user-profile'
import { AgentMessageItem, RetryingNotice, AssistantTurnTimeline } from './AgentMessageItem'
import { MemoryTraceBadge } from './MemoryTraceBadge'
import { AgentWelcomeState } from './AgentWelcomeState'
import { Button } from '@/components/ui/button'
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react'
import {
  resolvePredictedMessageHeight,
  getMessagePreviewText,
} from './agent-messages-utils'
import { shouldShowLiveAssistantTurn } from './agent-live-turn-visibility'
import type {
  AgentMessage,
  SessionPinnedWidget,
  WidgetDraftIntent,
} from '@kila/shared'

/** AgentMessages 属性接口 */
interface AgentMessagesProps {
  sessionId: string
  messages: AgentMessage[]
  streaming: boolean
  streamState?: AgentStreamState
  sessionPath?: string | null
  onRetry?: () => void
  onRegenerateTurn?: (messageId: string) => void
  onEditTurn?: (message: AgentMessage) => void
  onBranchFromMessage?: (messageId: string) => void
  onRewindToMessage?: (messageId: string) => void
  onRetryInNewSession?: () => void
  onCompact?: () => void
  onUseStarterPrompt?: (prompt: string) => void
  followUpSuggestion?: string | null
  onUseFollowUp?: (prompt: string) => void
  hasEarlierMessages?: boolean
  loadedMessageCount?: number
  totalMessageCount?: number
  loadingEarlierMessages?: boolean
  onLoadEarlierMessages?: () => void
  initialLoading?: boolean
  loadError?: string | null
  onRetryLoad?: () => void
}

/**
 * 消息列表主体
 *
 * 包 memo：AgentView 因草稿、附件、会话列表等非消息状态重渲染时，
 * 不再连带重跑整棵消息树；本会话流式更新仍通过 streamState 引用变化正常透传。
 */
export const AgentMessages = React.memo(function AgentMessages({
  sessionId,
  messages,
  streaming,
  streamState,
  sessionPath,
  onRetry,
  onRegenerateTurn,
  onEditTurn,
  onBranchFromMessage,
  onRewindToMessage,
  onRetryInNewSession,
  onCompact,
  onUseStarterPrompt,
  followUpSuggestion,
  onUseFollowUp,
  hasEarlierMessages = false,
  loadedMessageCount = messages.length,
  totalMessageCount = messages.length,
  loadingEarlierMessages = false,
  onLoadEarlierMessages,
  initialLoading = false,
  loadError = null,
  onRetryLoad,
}: AgentMessagesProps): React.ReactElement {
  const { t } = useTranslation()
  const userProfile = useAtomValue(userProfileAtom)
  const hydratingSessions = useAtomValue(agentMessageHydratingAtom)
  const upsertPinnedWidget = useSetAtom(upsertSessionPinnedWidgetAtom)
  const setWidgetDraftProposal = useSetAtom(setWidgetDraftProposalAtom)
  const { width: transcriptWidth, setElement: setTranscriptElement } = useElementWidth<HTMLDivElement>()
  const {
    setPredictedHeights,
    observeMessageElement,
    pruneMessageIds,
    getHeightPx,
  } = useMessageHeightRegistry()
  const messageElementRefCallbacks = React.useRef(
    new Map<string, (node: HTMLDivElement | null) => void>(),
  )

  const [ready, setReady] = React.useState(false)
  const prevSessionIdRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (sessionId !== prevSessionIdRef.current) {
      prevSessionIdRef.current = sessionId
      setReady(false)
    }
  }, [sessionId])

  React.useEffect(() => {
    if (ready) return
    if (messages.length === 0 && !streaming) {
      setReady(true)
      return
    }
    let cancelled = false
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) setReady(true)
      })
    })
    return () => { cancelled = true }
  }, [messages, streaming, ready])

  const streamingContent = streamState?.content ?? ''
  const smoothContent = useSmoothStreamContent(streamingContent)
  const visibleStreamingContent = smoothContent || (!streaming ? streamingContent : '')
  const timelineEntries = React.useMemo(
    () => buildAssistantTurnTimelineEntries(streamState?.processEvents, visibleStreamingContent),
    [streamState?.processEvents, visibleStreamingContent],
  )
  const retrying = streamState?.retrying
  const startedAt = streamState?.startedAt
  const hydratingMessages = hydratingSessions.has(sessionId) && Boolean(streamState)
  const hasLiveAssistantTurn = shouldShowLiveAssistantTurn({
    streaming,
    hydratingMessages,
    hasVisibleStreamingContent: Boolean(visibleStreamingContent),
    hasTimelineEntries: timelineEntries.length > 0,
    retrying: Boolean(retrying),
    messages,
  })

  const { tasks: backgroundTasks } = useBackgroundTasks(sessionId)

  const userMessageWidth = transcriptWidth > 0
    ? Math.min(USER_MESSAGE_MAX_WIDTH_PX, Math.max(160, transcriptWidth - 36))
    : USER_MESSAGE_MAX_WIDTH_PX
  const assistantMessageWidth = transcriptWidth > 0
    ? Math.min(ASSISTANT_MESSAGE_MAX_WIDTH_PX, Math.max(220, transcriptWidth - 36))
    : ASSISTANT_MESSAGE_MAX_WIDTH_PX

  const handlePinnedWidget = React.useCallback((widget: SessionPinnedWidget): void => {
    upsertPinnedWidget(widget)
  }, [upsertPinnedWidget])

  const handleWidgetDraftIntent = React.useCallback((intent: WidgetDraftIntent): void => {
    setWidgetDraftProposal({
      sessionId,
      proposal: intent,
    })
  }, [sessionId, setWidgetDraftProposal])

  React.useEffect(() => {
    const ids = messages.map((message) => message.id)
    pruneMessageIds(ids)
  }, [messages, pruneMessageIds])

  React.useEffect(() => {
    const activeIds = new Set(messages.map((message) => message.id))

    for (const id of messageElementRefCallbacks.current.keys()) {
      if (!activeIds.has(id)) {
        messageElementRefCallbacks.current.delete(id)
      }
    }
  }, [messages])

  const getMessageElementRef = React.useCallback((id: string) => {
    const existing = messageElementRefCallbacks.current.get(id)
    if (existing) return existing

    const callback = (node: HTMLDivElement | null): void => {
      observeMessageElement(id, node)
    }

    messageElementRefCallbacks.current.set(id, callback)
    return callback
  }, [observeMessageElement])

  React.useEffect(() => {
    const predictions = messages.map((message) => [
      message.id,
      resolvePredictedMessageHeight({
        message,
        userWidthPx: userMessageWidth,
        assistantWidthPx: assistantMessageWidth,
        hasRegenerateAction: Boolean(onRegenerateTurn),
        hasRetryActions: Boolean(onRetry || onRetryInNewSession),
        hasCompactAction: Boolean(onCompact),
      }),
    ] as const)
    setPredictedHeights(predictions)
  }, [
    assistantMessageWidth,
    messages,
    onCompact,
    onRegenerateTurn,
    onRetry,
    onRetryInNewSession,
    setPredictedHeights,
    userMessageWidth,
  ])

  const minimapItems: MinimapItem[] = React.useMemo(
    () => messages.map((m) => ({
      id: m.id,
      role: m.role === 'user' ? 'user' : m.role === 'status' ? 'status' as const : 'assistant',
      preview: getMessagePreviewText(m).slice(0, 80),
      avatar: m.role === 'user' ? userProfile.avatar : undefined,
      model: m.model,
      heightPx: getHeightPx(m.id),
    })),
    [getHeightPx, messages, userProfile.avatar]
  )

  return (
    <Conversation
      className={ready ? `${streaming ? '' : 'cv-ready '}opacity-100 transition-opacity duration-200` : 'opacity-0'}
      initial="instant"
    >
      <ConversationContent className="py-5">
        {messages.length === 0 && initialLoading ? (
          <div role="status" className="flex min-h-[280px] items-center justify-center px-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('agent.message.loadingTranscript')}
            </div>
          </div>
        ) : messages.length === 0 && loadError ? (
          <div role="alert" className="flex min-h-[280px] items-center justify-center px-6">
            <div className="flex max-w-sm flex-col items-center gap-3 text-center">
              <AlertCircle className="size-8 text-destructive" />
              <div>
                <div className="text-sm font-medium text-foreground">{t('agent.message.transcriptLoadFailed')}</div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">{loadError}</div>
              </div>
              {onRetryLoad && (
                <Button type="button" variant="outline" size="sm" onClick={onRetryLoad}>
                  <RefreshCw className="mr-1.5 size-3.5" />{t('common.retry')}
                </Button>
              )}
            </div>
          </div>
        ) : messages.length === 0 && !hasLiveAssistantTurn ? (
          <AgentWelcomeState sessionPath={sessionPath} onUsePrompt={onUseStarterPrompt} />
        ) : (
          <div ref={setTranscriptElement} className="w-full px-4 md:px-8 xl:px-10" role="log" aria-live="polite" aria-label={t('agent.message.listLabel')}>
            {hasEarlierMessages && onLoadEarlierMessages && (
              <div className="flex justify-center pb-4">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loadingEarlierMessages}
                  onClick={onLoadEarlierMessages}
                >
                  {loadingEarlierMessages
                    ? t('agent.message.loadingEarlier')
                    : t('agent.message.loadEarlier', { loaded: loadedMessageCount, total: totalMessageCount })}
                </Button>
              </div>
            )}
            {messages.map((msg: AgentMessage, index) => (
              <div
                key={msg.id}
                data-message-id={msg.id}
                ref={getMessageElementRef(msg.id)}
                style={{
                  contentVisibility: streaming && index === messages.length - 1 ? 'visible' : 'auto',
                  containIntrinsicSize: `auto ${Math.round(getHeightPx(msg.id))}px`,
                  contain: streaming && index === messages.length - 1 ? undefined : 'layout paint style',
                }}
              >
                <AgentMessageItem
                  sessionId={sessionId}
                  message={msg}
                  sessionPath={sessionPath}
                  onRetry={onRetry}
                  onRegenerateTurn={onRegenerateTurn}
                  onEditTurn={onEditTurn}
                  onBranchFromMessage={onBranchFromMessage}
                  onRewindToMessage={onRewindToMessage}
                  onRetryInNewSession={onRetryInNewSession}
                  onCompact={onCompact}
                  onPinnedWidget={handlePinnedWidget}
                  onWidgetDraftIntent={handleWidgetDraftIntent}
                  followUpSuggestion={index === messages.length - 1 ? followUpSuggestion : null}
                  onUseFollowUp={onUseFollowUp}
                />
              </div>
            ))}

            {hasLiveAssistantTurn && (
              <Message from="assistant">
                <MessageContent>
                  <AssistantTurnTimeline
                    entries={timelineEntries}
                    backgroundTasks={backgroundTasks}
                    startedAt={startedAt}
                    streaming={streaming}
                    sessionPath={sessionPath}
                    animate
                  />
                  <MemoryTraceBadge trace={streamState?.memoryTrace} />
                  {retrying && (
                    <div className="mb-2.5 w-full">
                      <RetryingNotice retrying={retrying} />
                    </div>
                  )}
                  {smoothContent ? (
                    streaming && <StreamingIndicator />
                  ) : null}
                </MessageContent>
              </Message>
            )}
            <div className="h-8 w-full shrink-0" />
          </div>
        )}
      </ConversationContent>
      <ScrollMinimap items={minimapItems} />
      <ConversationScrollButton />
    </Conversation>
  )
})
