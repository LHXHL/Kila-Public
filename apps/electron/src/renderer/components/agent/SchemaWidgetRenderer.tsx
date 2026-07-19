import * as React from 'react'
import type {
  BarChartSpec,
  ComparisonTableSpec,
  FlowDiagramSpec,
  LineChartSpec,
  SchemaWidgetPayload,
  SchemaWidgetSpec,
  SchemaWidgetType,
  SessionPinnedWidget,
  WidgetDraftIntent,
  WidgetDraftIntentSource,
} from '@kila/shared'
import { Pin } from 'lucide-react'
import { toast } from 'sonner'
import { WidgetErrorBoundary } from './WidgetErrorBoundary'
import { StatGridWidget } from './schema-widgets/StatGridWidget'
import { LineChartWidget } from './schema-widgets/LineChartWidget'
import { BarChartWidget } from './schema-widgets/BarChartWidget'
import { ComparisonTableWidget } from './schema-widgets/ComparisonTableWidget'
import { TimelineWidget } from './schema-widgets/TimelineWidget'
import { FlowDiagramWidget } from './schema-widgets/FlowDiagramWidget'

export interface SchemaWidgetRendererProps {
  title?: string
  caption?: string
  widgetType: SchemaWidgetType
  spec: SchemaWidgetSpec
  toolbar?: React.ReactNode
  sessionId?: string
  sourceMessageId?: string
  sourceBlockKey?: string
  onPinned?: (widget: SessionPinnedWidget) => void
  onDraftIntent?: (intent: WidgetDraftIntent) => void
  draftSource?: WidgetDraftIntentSource
}

function buildDraftIntent(
  prompt: string,
  label: string | undefined,
  source?: WidgetDraftIntentSource,
): WidgetDraftIntent | null {
  if (!source) return null

  const normalizedPrompt = prompt.trim()
  if (!normalizedPrompt) return null

  const normalizedLabel = label?.trim()

  return {
    type: 'draft_message',
    prompt: normalizedPrompt,
    ...(normalizedLabel ? { label: normalizedLabel } : {}),
    source,
  }
}

function SchemaWidgetRendererInner({
  title,
  caption,
  widgetType,
  spec,
  toolbar,
  sessionId,
  sourceMessageId,
  sourceBlockKey,
  onPinned,
  onDraftIntent,
  draftSource,
}: SchemaWidgetRendererProps): React.ReactElement {
  const [isPinning, setIsPinning] = React.useState(false)
  const canPin = Boolean(sessionId && sourceMessageId && sourceBlockKey)
  const hasHeader = Boolean(title || toolbar || canPin)

  const emitDraftIntent = React.useCallback((intent: WidgetDraftIntent): void => {
    onDraftIntent?.(intent)
  }, [onDraftIntent])

  const body = React.useMemo(() => {
    const heading = title?.trim() || undefined

    switch (widgetType) {
      case 'stat-grid':
        return (
          <StatGridWidget
            spec={spec as import('@kila/shared').StatGridSpec}
            onItemClick={onDraftIntent ? ({ item }) => {
              const intent = buildDraftIntent(
                `基于「${heading || '这个 widget'}」，进一步解释指标「${item.label}」的含义、变化原因和后续建议。`,
                `分析 ${item.label}`,
                draftSource,
              )
              if (intent) emitDraftIntent(intent)
            } : undefined}
          />
        )
      case 'line-chart':
        return (
          <LineChartWidget
            spec={spec as LineChartSpec}
            onPointClick={onDraftIntent ? ({ xValue, seriesLabel, value }) => {
              const intent = buildDraftIntent(
                `基于「${heading || '这个 widget'}」，解释 ${xValue} 的 ${seriesLabel} = ${value} 的原因，并给出下一步分析建议。`,
                `分析 ${xValue}`,
                draftSource,
              )
              if (intent) emitDraftIntent(intent)
            } : undefined}
          />
        )
      case 'bar-chart':
        return (
          <BarChartWidget
            spec={spec as BarChartSpec}
            onBarClick={onDraftIntent ? ({ xValue, seriesLabel, value }) => {
              const intent = buildDraftIntent(
                `基于「${heading || '这个 widget'}」，解释 ${xValue} 的 ${seriesLabel} = ${value} 的原因，并给出下一步分析建议。`,
                `分析 ${xValue}`,
                draftSource,
              )
              if (intent) emitDraftIntent(intent)
            } : undefined}
          />
        )
      case 'comparison-table':
        return (
          <ComparisonTableWidget
            spec={spec as ComparisonTableSpec}
            onRowClick={onDraftIntent ? ({ row }) => {
              const firstValue = Object.values(row)[0]
              const intent = buildDraftIntent(
                `基于「${heading || '这个 widget'}」，展开分析这一行数据，并解释它与其他行相比的差异。重点关注 ${String(firstValue ?? '该项')}。`,
                `分析 ${String(firstValue ?? '该行')}`,
                draftSource,
              )
              if (intent) emitDraftIntent(intent)
            } : undefined}
          />
        )
      case 'timeline':
        return (
          <TimelineWidget
            spec={spec as import('@kila/shared').TimelineSpec}
            onItemClick={onDraftIntent ? ({ item }) => {
              const intent = buildDraftIntent(
                `基于「${heading || '这个 widget'}」，详细解释「${item.title}」阶段的作用、前后依赖以及风险点。`,
                `展开 ${item.title}`,
                draftSource,
              )
              if (intent) emitDraftIntent(intent)
            } : undefined}
          />
        )
      case 'flow-diagram':
        return (
          <FlowDiagramWidget
            spec={spec as FlowDiagramSpec}
            onNodeClick={onDraftIntent ? ({ node }) => {
              const intent = buildDraftIntent(
                `基于「${heading || '这个 widget'}」，说明节点「${node.label}」在整体流程中的作用与上下游关系。`,
                `分析 ${node.label}`,
                draftSource,
              )
              if (intent) emitDraftIntent(intent)
            } : undefined}
            onEdgeClick={onDraftIntent ? ({ edge }) => {
              const intent = buildDraftIntent(
                `基于「${heading || '这个 widget'}」，说明连接「${edge.from} -> ${edge.to}」在整体流程中的作用与上下游关系。`,
                `分析 ${edge.from}→${edge.to}`,
                draftSource,
              )
              if (intent) emitDraftIntent(intent)
            } : undefined}
          />
        )
      default:
        return <div className="rounded-lg border border-border/30 bg-muted/20 p-3 text-sm text-muted-foreground">暂不支持该 schema widget。</div>
    }
  }, [draftSource, emitDraftIntent, onDraftIntent, spec, title, widgetType])

  const handlePin = React.useCallback(async (): Promise<void> => {
    if (!canPin || !sessionId || !sourceMessageId || !sourceBlockKey) return

    setIsPinning(true)

    try {
      const pinnedWidget = await window.electronAPI.pinSessionWidget({
        sessionId,
        sourceMessageId,
        sourceBlockKey,
        title: title?.trim() || 'Schema Widget',
        payload: {
          kind: 'schema',
          title,
          caption,
          widget_type: widgetType,
          spec,
        } satisfies SchemaWidgetPayload,
      })
      onPinned?.(pinnedWidget)
      toast.success('已固定到右侧 Board')
    } catch (error) {
      console.error('[SchemaWidgetRenderer] 固定 widget 失败:', error)
      toast.error('固定 widget 失败')
    } finally {
      setIsPinning(false)
    }
  }, [canPin, caption, onPinned, sessionId, sourceBlockKey, sourceMessageId, spec, title, widgetType])

  return (
    <div className="group/widget relative my-1.5 w-full overflow-hidden rounded-xl border border-border/30 bg-background/40">
      {hasHeader && (
        <div className="flex items-start justify-between gap-3 px-4 pb-2 pt-3">
          <div className="min-w-0">
            {title && (
              <div className="truncate text-sm font-medium text-foreground">{title}</div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1 opacity-70 transition-opacity hover:opacity-100 group-hover/widget:opacity-100 group-focus-within/widget:opacity-100">
            {canPin && (
              <button
                type="button"
                onClick={() => { void handlePin() }}
                disabled={isPinning}
                className="inline-flex items-center gap-1 rounded-md border border-border/25 bg-background/80 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:cursor-wait disabled:opacity-60"
              >
                <Pin className="size-3.5" />
                {isPinning ? '固定中…' : '固定'}
              </button>
            )}
            {toolbar}
          </div>
        </div>
      )}
      <div className="px-4 pb-4 pt-1">
        {body}
        {caption && (
          <div className="mt-3 text-[12px] text-muted-foreground">{caption}</div>
        )}
      </div>
    </div>
  )
}

export function SchemaWidgetRenderer(props: SchemaWidgetRendererProps): React.ReactElement {
  return (
    <WidgetErrorBoundary>
      <SchemaWidgetRendererInner {...props} />
    </WidgetErrorBoundary>
  )
}
