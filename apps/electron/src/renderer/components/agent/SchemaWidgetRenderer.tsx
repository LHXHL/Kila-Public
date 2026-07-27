import * as React from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const [isPinning, setIsPinning] = React.useState(false)
  const canPin = Boolean(sessionId && sourceMessageId && sourceBlockKey)
  const hasHeader = Boolean(title || toolbar || canPin)

  const emitDraftIntent = React.useCallback((intent: WidgetDraftIntent): void => {
    onDraftIntent?.(intent)
  }, [onDraftIntent])

  const body = React.useMemo(() => {
    const heading = title?.trim() || t('agent.widget.thisWidget')

    switch (widgetType) {
      case 'stat-grid':
        return (
          <StatGridWidget
            spec={spec as import('@kila/shared').StatGridSpec}
            onItemClick={onDraftIntent ? ({ item }) => {
              const intent = buildDraftIntent(
                t('agent.widget.prompts.stat', { widget: heading, metric: item.label }),
                t('agent.widget.prompts.analyzeLabel', { target: item.label }),
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
                t('agent.widget.prompts.point', { widget: heading, x: xValue, series: seriesLabel, value }),
                t('agent.widget.prompts.analyzeLabel', { target: xValue }),
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
                t('agent.widget.prompts.point', { widget: heading, x: xValue, series: seriesLabel, value }),
                t('agent.widget.prompts.analyzeLabel', { target: xValue }),
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
              const rowLabel = firstValue === undefined || firstValue === null
                ? t('agent.widget.prompts.thisRow')
                : String(firstValue)
              const intent = buildDraftIntent(
                t('agent.widget.prompts.row', { widget: heading, row: rowLabel }),
                t('agent.widget.prompts.analyzeLabel', { target: rowLabel }),
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
                t('agent.widget.prompts.timeline', { widget: heading, stage: item.title }),
                t('agent.widget.prompts.expandLabel', { target: item.title }),
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
                t('agent.widget.prompts.node', { widget: heading, node: node.label }),
                t('agent.widget.prompts.analyzeLabel', { target: node.label }),
                draftSource,
              )
              if (intent) emitDraftIntent(intent)
            } : undefined}
            onEdgeClick={onDraftIntent ? ({ edge }) => {
              const intent = buildDraftIntent(
                t('agent.widget.prompts.edge', { widget: heading, from: edge.from, to: edge.to }),
                t('agent.widget.prompts.analyzeLabel', { target: `${edge.from}→${edge.to}` }),
                draftSource,
              )
              if (intent) emitDraftIntent(intent)
            } : undefined}
          />
        )
      default:
        return <div className="rounded-lg border border-border/30 bg-muted/20 p-3 text-sm text-muted-foreground">{t('agent.widget.unsupportedSchema')}</div>
    }
  }, [draftSource, emitDraftIntent, onDraftIntent, spec, t, title, widgetType])

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
      toast.success(t('agent.widget.pinned'))
    } catch (error) {
      console.error('[SchemaWidgetRenderer] 固定 widget 失败:', error)
      toast.error(t('agent.widget.pinFailed'))
    } finally {
      setIsPinning(false)
    }
  }, [canPin, caption, onPinned, sessionId, sourceBlockKey, sourceMessageId, spec, t, title, widgetType])

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
                {isPinning ? t('agent.widget.pinning') : t('agent.widget.pin')}
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
