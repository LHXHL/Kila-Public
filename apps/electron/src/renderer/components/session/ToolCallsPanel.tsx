import * as React from 'react'
import { useAtomValue } from 'jotai'
import {
  normalizeAgentToolName,
  sessionMessageToLegacyAgentMessage,
  type AgentEvent,
  type AgentMessage,
} from '@kila/shared'
import { AlertTriangle, ChevronRight, Clock3, ImageIcon, Loader2, RefreshCw, Wrench } from 'lucide-react'
import {
  agentMessageRefreshAtom,
  agentStreamingStatesAtom,
  getActivityStatus,
  type ActivityStatus,
  type ToolActivity,
} from '@/atoms/agent-atoms'
import {
  StatusIcon,
  formatElapsed,
  getInputSummary,
  getToolDisplayName,
  getToolIcon,
} from '@/components/agent/ToolActivityItem'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { OverlayScrollbarArea } from '@/components/ui/overlay-scrollbar'
import { EntityMetadataChip } from '@/components/ui/entity-metadata-chip'
import { WorkspaceEntityRow } from '@/components/ui/workspace-entity-row'
import { cn } from '@/lib/utils'
import { formatPayloadPreview } from '@/components/agent/agent-messages-utils'

interface ToolCallsPanelProps {
  sessionId: string
}

const TOOL_CALL_PARTIAL_RESULT_MAX_CHARS = 48_000

export function getVisibleStatusLabel(status: ActivityStatus): string | null {
  switch (status) {
    case 'running':
      return '运行中'
    case 'completed':
      return null
    case 'error':
      return '失败'
    case 'backgrounded':
      return '后台中'
    case 'pending':
    default:
      return '等待中'
  }
}

function getStatusTone(status: ActivityStatus): 'neutral' | 'accent' | 'success' | 'warning' | 'danger' {
  if (status === 'error') return 'danger'
  if (status === 'completed') return 'success'
  if (status === 'running') return 'accent'
  if (status === 'backgrounded') return 'warning'
  return 'neutral'
}

function PayloadBlock({
  label,
  tone = 'neutral',
  children,
}: {
  label: string
  tone?: 'neutral' | 'danger'
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="space-y-1 px-1 py-0.5">
      <div
        className={cn(
          'text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/78',
          tone === 'danger' && 'text-destructive/78',
        )}
      >
        {label}
      </div>
      <pre
        className={cn(
          'max-h-[260px] overflow-auto whitespace-pre font-mono text-[11px] leading-5 text-foreground/78 [scrollbar-gutter:stable]',
          tone === 'danger' && 'text-destructive/82',
        )}
      >
        {children}
      </pre>
    </div>
  )
}

export function buildSessionToolCallActivities(
  messages: AgentMessage[],
  streamingEvents?: AgentEvent[],
): ToolActivity[] {
  const activities: ToolActivity[] = []
  const activityMap = new Map<string, ToolActivity>()
  const startedAtMap = new Map<string, number>()

  const ensureActivity = (
    toolUseId: string,
    toolName?: string,
    input?: Record<string, unknown>,
  ): ToolActivity => {
    const existing = activityMap.get(toolUseId)
    if (existing) return existing

    const activity: ToolActivity = {
      toolUseId,
      toolName: toolName ? normalizeAgentToolName(toolName) : 'Tool',
      input: input ?? {},
      done: false,
    }
    activityMap.set(toolUseId, activity)
    activities.push(activity)
    return activity
  }

  const consumeEvents = (events: AgentEvent[] | undefined): void => {
    for (const event of events ?? []) {
      if (event.type === 'tool_start') {
        const activity = ensureActivity(event.toolUseId, event.toolName, event.input)
        activity.toolName = normalizeAgentToolName(event.toolName)
        activity.input = event.input
        activity.intent = event.intent ?? activity.intent
        activity.displayName = event.displayName ?? activity.displayName
        activity.parentToolUseId = event.parentToolUseId ?? activity.parentToolUseId
        activity.done = false
        if (event.timestamp !== undefined) startedAtMap.set(event.toolUseId, event.timestamp)
        continue
      }

      if (event.type === 'tool_update') {
        const activity = ensureActivity(event.toolUseId, event.toolName)
        if (event.toolName) activity.toolName = normalizeAgentToolName(event.toolName)
        const nextPartial = `${activity.partialResult ?? ''}${event.partialText}`
        activity.partialResult = nextPartial.length > TOOL_CALL_PARTIAL_RESULT_MAX_CHARS
          ? nextPartial.slice(0, TOOL_CALL_PARTIAL_RESULT_MAX_CHARS)
          : nextPartial
        activity.done = false
        continue
      }

      if (event.type === 'tool_result') {
        const activity = ensureActivity(event.toolUseId, event.toolName, event.input)
        if (event.toolName) activity.toolName = normalizeAgentToolName(event.toolName)
        activity.input = event.input ?? activity.input
        activity.result = event.result
        activity.partialResult = undefined
        activity.isError = event.isError
        activity.done = true
        activity.imageAttachments = event.imageAttachments
        const startedAt = startedAtMap.get(event.toolUseId)
        if (startedAt !== undefined && event.timestamp !== undefined) {
          activity.elapsedSeconds = Math.max(0, Number(((event.timestamp - startedAt) / 1000).toFixed(1)))
        }
        continue
      }

      if (event.type === 'task_backgrounded' || event.type === 'shell_backgrounded') {
        const activity = activityMap.get(event.toolUseId)
        if (!activity) continue
        activity.isBackground = true
        activity.done = true
        if (event.type === 'task_backgrounded') {
          activity.taskId = event.taskId
          activity.intent = event.intent ?? activity.intent
        } else {
          activity.shellId = event.shellId
          activity.intent = event.command ?? event.intent ?? activity.intent
        }
      }
    }
  }

  for (const message of messages) consumeEvents(message.events)
  consumeEvents(streamingEvents)
  return activities
}

export function ToolCallsPanel({ sessionId }: ToolCallsPanelProps): React.ReactElement {
  const refreshMap = useAtomValue(agentMessageRefreshAtom)
  const streamingStates = useAtomValue(agentStreamingStatesAtom)
  const refreshVersion = refreshMap.get(sessionId) ?? 0
  const streamState = streamingStates.get(sessionId)
  const [persistedMessages, setPersistedMessages] = React.useState<AgentMessage[]>([])
  const [expandedMap, setExpandedMap] = React.useState<Record<string, boolean>>({})
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [retryVersion, setRetryVersion] = React.useState(0)

  React.useEffect(() => {
    setExpandedMap({})
  }, [sessionId])

  React.useEffect(() => {
    setPersistedMessages([])
  }, [sessionId])

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)

    window.electronAPI
      .getSessionMessages(sessionId)
      .then((sessionMessages) => {
        if (cancelled) return

        const nextMessages = sessionMessages
          .map(sessionMessageToLegacyAgentMessage)
          .filter((message): message is AgentMessage => message !== null)

        setPersistedMessages(nextMessages)
        setLoading(false)
      })
      .catch((error) => {
        if (cancelled) return
        console.error('[ToolCallsPanel] 加载会话消息失败:', error)
        setPersistedMessages([])
        setLoadError(error instanceof Error ? error.message : '工具调用加载失败')
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [retryVersion, sessionId, refreshVersion])

  const toolActivities = React.useMemo(
    () => buildSessionToolCallActivities(persistedMessages, streamState?.processEvents),
    [persistedMessages, streamState?.processEvents],
  )

  const orderedActivities = React.useMemo(
    () => [...toolActivities].reverse(),
    [toolActivities],
  )

  if (loading && orderedActivities.length === 0) {
    return <div role="status" className="flex h-full items-center justify-center gap-2 px-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />正在加载工具调用…</div>
  }

  if (loadError && orderedActivities.length === 0) {
    return (
      <div role="alert" className="flex h-full items-center justify-center px-6">
        <div className="flex max-w-[280px] flex-col items-center gap-3 text-center">
          <AlertTriangle className="size-7 text-destructive" />
          <div className="text-sm font-medium text-foreground">工具调用加载失败</div>
          <div className="text-xs text-muted-foreground">{loadError}</div>
          <button type="button" className="flex items-center gap-1.5 text-xs text-primary hover:underline" onClick={() => setRetryVersion((value) => value + 1)}><RefreshCw className="size-3.5" />重试</button>
        </div>
      </div>
    )
  }

  if (orderedActivities.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="flex max-w-[280px] flex-col items-center gap-2 text-center text-muted-foreground">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted/35 text-foreground/75">
            <Wrench className="size-5" />
          </div>
          <div className="text-sm font-medium text-foreground">还没有工具调用</div>
          <div className="text-xs leading-5">
            当 Agent 运行搜索、读写文件、执行命令或调用 MCP 时，这里会显示详细记录。
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <OverlayScrollbarArea
        className="min-h-0 flex-1 overflow-y-auto"
        options={{ overflow: { x: 'hidden', y: 'scroll' } }}
      >
        <div className="space-y-1.5 p-3">
          {orderedActivities.map((activity) => {
            const ToolIcon = getToolIcon(activity.toolName)
            const status = getActivityStatus(activity)
            const inputSummary = getInputSummary(activity.toolName, activity.input)
            const isOpen = expandedMap[activity.toolUseId] ?? status === 'running'

            return (
              <Collapsible
                key={activity.toolUseId}
                open={isOpen}
                onOpenChange={(nextOpen) => {
                  setExpandedMap((prev) => ({
                    ...prev,
                    [activity.toolUseId]: nextOpen,
                  }))
                }}
              >
                <section
                  style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 52px' }}
                  className={cn(
                    'rounded-[var(--kila-panel-radius-inner)] border border-transparent transition-colors',
                    isOpen && 'border-border/55 bg-muted/[0.12]',
                  )}
                >
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="block w-full text-left"
                    >
                      <WorkspaceEntityRow
                        compact
                        selected={isOpen}
                        icon={<ToolIcon className="size-4" />}
                        title={activity.displayName ?? getToolDisplayName(activity.toolName)}
                        description={inputSummary || activity.toolName}
                        metadata={(
                          <>
                            {getVisibleStatusLabel(status) && (
                              <EntityMetadataChip tone={getStatusTone(status)}>
                                {getVisibleStatusLabel(status)}
                              </EntityMetadataChip>
                            )}
                            {activity.elapsedSeconds != null && activity.elapsedSeconds > 0 && (
                              <EntityMetadataChip>
                                <Clock3 className="size-3" />
                                {formatElapsed(activity.elapsedSeconds)}
                              </EntityMetadataChip>
                            )}
                            {activity.imageAttachments && activity.imageAttachments.length > 0 && (
                              <EntityMetadataChip>
                                <ImageIcon className="size-3" />
                                {activity.imageAttachments.length}
                              </EntityMetadataChip>
                            )}
                          </>
                        )}
                        trailing={(
                          <>
                            <StatusIcon status={status} toolName={activity.toolName} />
                            <ChevronRight
                              className={cn(
                                'size-3.5 text-muted-foreground transition-transform duration-200',
                                isOpen && 'rotate-90',
                              )}
                            />
                          </>
                        )}
                      />
                    </button>
                  </CollapsibleTrigger>

                  {isOpen && (
                    <CollapsibleContent className="kila-collapsible-content px-2.5 pb-2 pt-0">
                      <div className="ml-9 space-y-2 pl-2">
                        <PayloadBlock label="Input">
                          {formatPayloadPreview(activity.input) || '{}'}
                        </PayloadBlock>

                        <PayloadBlock label={activity.isError ? 'Error' : 'Result'} tone={activity.isError ? 'danger' : 'neutral'}>
                          {formatPayloadPreview(activity.result ?? activity.partialResult) || (activity.done ? '无文本结果' : '运行中...')}
                        </PayloadBlock>
                      </div>
                    </CollapsibleContent>
                  )}
                </section>
              </Collapsible>
            )
          })}
        </div>
      </OverlayScrollbarArea>
    </div>
  )
}
