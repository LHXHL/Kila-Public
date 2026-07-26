/**
 * WorkflowCollapse — 思考+工具阶段折叠面板
 *
 * 对标 LobeHub WorkflowCollapse：
 * - thinking 和 tool 按事件顺序交织渲染
 * - 三级展开：collapsed / semi / full，丝滑过渡动画
 * - 标题栏：状态 Block + 流式标题 + 计时器 + 展开/折叠按钮
 * - 内容区：限高 ScrollArea 或全展开
 * - 状态图标：运行脉冲、成功、失败、混合
 */

import * as React from 'react'
import {
  Check,
  X,
  AlertTriangle,
  Maximize2,
  Minimize2,
  Wrench,
  ChevronDown,
  Loader2,
  Zap,
  Circle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatElapsed } from '../ToolActivityItem'
import {
  PROCESS_TONE_STYLE,
} from '../agent-messages-utils'
import { ToolAccordionItem } from './ToolAccordionItem'
import { ThinkingProcessCard } from './ThinkingProcessCard'
import type { BackgroundTask, ProcessTimelineEntry, ToolProcessEntry, ThinkingProcessEntry } from '@/atoms/agent-atoms'

// ===== 类型 =====

export type WorkflowExpandLevel = 'collapsed' | 'semi' | 'full'


// ===== 工具状态聚合 =====

function getToolEntries(entries: ProcessTimelineEntry[]): ToolProcessEntry[] {
  return entries.filter((e): e is ToolProcessEntry => e.kind === 'tool')
}

function getThinkingEntries(entries: ProcessTimelineEntry[]): ThinkingProcessEntry[] {
  return entries.filter((e): e is ThinkingProcessEntry => e.kind === 'thinking')
}

function getCompletionStatus(
  tools: ToolProcessEntry[],
): 'success' | 'partial' | 'error' {
  const completed = tools.filter((t) => t.activity.done)
  if (completed.length === 0) return 'success'
  const errorCount = completed.filter((t) => t.activity.isError).length
  if (errorCount === 0) return 'success'
  if (errorCount === completed.length) return 'error'
  return 'partial'
}

// ===== 流式标题文案 =====

function getStreamingHeadline(
  entries: ProcessTimelineEntry[],
  allComplete: boolean,
  elapsedSeconds?: number,
): string {
  const tools = getToolEntries(entries)

  if (allComplete) {
    return getCompletedSummary(entries, elapsedSeconds)
  }

  // 找到最后一个未完成的条目（可能是 thinking 或 tool）
  const lastRunning = entries.findLast((e) => {
    if (e.kind === 'tool') return !e.activity.done
    if (e.kind === 'thinking') return !e.done
    return false
  })

  if (lastRunning?.kind === 'tool') {
    const name = lastRunning.activity.displayName ?? lastRunning.activity.toolName
    const intent = lastRunning.activity.intent
    return intent ? `${name}: ${intent}` : name
  }

  if (lastRunning?.kind === 'thinking') {
    const preview = lastRunning.summaryText?.trim().replace(/\s+/g, ' ')
    return preview && preview.length > 40
      ? `思考中: ${preview.slice(0, 40)}…`
      : '思考中…'
  }

  return getCompletedSummary(entries, elapsedSeconds)
}

function getCompletedSummary(
  entries: ProcessTimelineEntry[],
  elapsedSeconds?: number,
): string {
  const tools = getToolEntries(entries)
  const thinkingCount = getThinkingEntries(entries).length
  const groups = new Map<string, number>()
  for (const t of tools) {
    const name = t.activity.displayName ?? t.activity.toolName
    groups.set(name, (groups.get(name) ?? 0) + 1)
  }
  const parts: string[] = []
  if (thinkingCount > 0) parts.push(`${thinkingCount} 次思考`)
  for (const [name, count] of groups) {
    parts.push(count > 1 ? `${name} (${count})` : name)
  }
  let summary = parts.join(' · ')
  if (elapsedSeconds && elapsedSeconds > 0) {
    summary += ` · ${formatElapsed(elapsedSeconds)}`
  }
  return summary
}

// ===== 状态图标 =====

function StatusBlock({
  streaming,
  completionStatus,
}: {
  streaming: boolean
  completionStatus: 'success' | 'partial' | 'error'
}): React.ReactElement {
  const base = 'flex size-6 items-center justify-center text-muted-foreground transition-colors duration-200'

  if (streaming) {
    return (
      <div className={base}>
        <Loader2 className="size-3.5 animate-spin" style={PROCESS_TONE_STYLE} />
      </div>
    )
  }

  switch (completionStatus) {
    case 'error':
      return (
        <div className={base}>
          <X className="size-3.5 text-status-danger" strokeWidth={2.5} />
        </div>
      )
    case 'partial': {
      return (
        <div className={base}>
          <Check className="size-3.5 text-status-success" strokeWidth={2.5} />
          <AlertTriangle className="ml-0.5 size-2.5 text-status-warning" />
        </div>
      )
    }
    default:
      return (
        <div className={base}>
          <Check className="size-3.5 text-status-success" strokeWidth={2.5} />
        </div>
      )
  }
}

// ===== 计时 Hook =====

function useElapsedTimer(startedAt?: number, running?: boolean): number {
  const [seconds, setSeconds] = React.useState(0)
  React.useEffect(() => {
    if (!running || !startedAt) {
      setSeconds(0)
      return
    }
    const tick = () => setSeconds(Math.floor((Date.now() - startedAt) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [running, startedAt])
  return seconds
}

// ===== WorkflowCollapse 主组件 =====

interface WorkflowCollapseProps {
  entries: ProcessTimelineEntry[]
  backgroundTasks?: BackgroundTask[]
  streaming?: boolean
  startedAt?: number
  sessionPath?: string | null
  animate?: boolean
}

export function WorkflowCollapse({
  entries,
  backgroundTasks,
  streaming = false,
  startedAt,
  sessionPath,
  animate = false,
}: WorkflowCollapseProps): React.ReactElement {
  const tools = React.useMemo(() => getToolEntries(entries), [entries])
  const allComplete = entries.length > 0 && entries.every((e) => {
    if (e.kind === 'tool') return e.activity.done
    if (e.kind === 'thinking') return e.done
    return true
  })
  const completionStatus = React.useMemo(() => getCompletionStatus(tools), [tools])

  const elapsed = useElapsedTimer(startedAt, streaming && !allComplete)
  const totalElapsed = allComplete
    ? (tools.at(-1)?.activity.elapsedSeconds ?? 0)
    : elapsed

  const headline = React.useMemo(
    () => getStreamingHeadline(entries, allComplete, totalElapsed),
    [entries, allComplete, totalElapsed],
  )

  // 展开状态管理：默认半展开（semi），用户可手动折叠或全展开
  const [expandLevel, setExpandLevel] = React.useState<WorkflowExpandLevel>('semi')

  const isExpanded = expandLevel !== 'collapsed'
  const constrained = expandLevel === 'semi'

  const backgroundTaskMap = React.useMemo(
    () => new Map((backgroundTasks ?? []).map((t) => [t.toolUseId, t] as const)),
    [backgroundTasks],
  )

  const isStreaming = streaming && !allComplete
  // 内容区 ref，用于流式新增条目时自动滚动到底部
  const contentRef = React.useRef<HTMLDivElement>(null)

  // 流式中出现新思考/工具条目时，自动将内容区滚动到底部
  React.useEffect(() => {
    if (!isStreaming || expandLevel === 'collapsed' || !contentRef.current) return
    contentRef.current.scrollTop = contentRef.current.scrollHeight
  }, [entries.length, isStreaming, expandLevel])

  // 整轮回复结束后自动收起
  React.useEffect(() => {
    if (!streaming && entries.length > 0) setExpandLevel('collapsed')
  }, [streaming])


  return (
    <div
      className={cn(
        'mb-2.5 w-full rounded-xl border border-border/40 bg-muted/10 transition-all duration-300',
        isExpanded ? 'shadow-sm' : 'shadow-none',
        animate && 'animate-in fade-in slide-in-from-top-2 duration-300',
      )}
    >
      {/* 标题栏 */}
      <div className="group/title flex items-center px-1 py-1">
        <button
          type="button"
          aria-expanded={isExpanded}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1 text-left hover:bg-muted/20"
          onClick={() => setExpandLevel(isExpanded ? 'collapsed' : 'semi')}
        >
          <StatusBlock streaming={isStreaming} completionStatus={completionStatus} />

          <span className={cn(
            'min-w-0 flex-1 truncate text-[13px] transition-colors duration-300',
            isStreaming ? 'font-medium text-foreground/80' : 'text-muted-foreground',
          )}>
            {headline}
          </span>

          {isStreaming && totalElapsed > 0 && (
            <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground/50">
              {formatElapsed(totalElapsed)}
            </span>
          )}

          {entries.length > 0 && (
            <span className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums',
              isStreaming
                ? 'bg-[hsl(var(--process-tone)/0.12)] text-process-tone'
                : 'bg-muted/60 text-muted-foreground/70',
            )}>
              {entries.length}
            </span>
          )}

          <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground/40 transition-transform duration-300', isExpanded && 'rotate-180')} />
        </button>

        {/* 三级展开按钮 */}
        <button
          type="button"
          aria-label={expandLevel === 'full' ? '收起过程详情' : '展开更多过程详情'}
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-md transition-all duration-200',
            'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50',
            'opacity-0 group-hover/title:opacity-100 focus-visible:opacity-100',
          )}
          onClick={(e) => {
            if (expandLevel === 'collapsed') {
              setExpandLevel('semi')
            } else if (expandLevel === 'semi') {
              setExpandLevel('full')
            } else {
              setExpandLevel('collapsed')
            }
          }}
        >
          {expandLevel === 'semi' ? (
            <Maximize2 className="size-3.5" />
          ) : expandLevel === 'full' ? (
            <Minimize2 className="size-3.5" />
          ) : (
            <Wrench className="size-3.5" />
          )}
        </button>
      </div>

      {/* 折叠时卸载过程详情；展开后由各条目自行延迟挂载重内容。 */}
      {isExpanded && (
        <div className="animate-in fade-in slide-in-from-top-1 duration-150">
          <div
            ref={contentRef}
            className={cn(
              'border-t border-border/20 px-2 py-2',
              constrained && 'max-h-[min(40vh,320px)] overflow-y-auto',
            )}
          >
            {entries.map((entry) => {
              if (entry.kind === 'thinking') {
                return (
                  <ThinkingProcessCard
                    key={entry.id}
                    entry={entry}
                    startedAt={startedAt}
                    streaming={streaming}
                    sessionPath={sessionPath}
                  />
                )
              }

              return (
                <ToolAccordionItem
                  key={entry.id}
                  entry={entry}
                  backgroundTask={backgroundTaskMap.get(entry.activity.toolUseId)}
                  sessionPath={sessionPath}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
