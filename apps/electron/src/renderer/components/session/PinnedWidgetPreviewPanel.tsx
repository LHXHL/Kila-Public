import * as React from 'react'
import { useSetAtom } from 'jotai'
import type { SessionPinnedWidget, WidgetDraftIntent } from '@kila/shared'
import { Code, Eye, LayoutPanelTop } from 'lucide-react'
import { setWidgetDraftProposalAtom } from '@/atoms/agent-atoms'
import type { SessionWorkbenchViewMode } from './session-file-workbench-state'
import { CodeBlock } from '@kila/ui'
import { WidgetRenderer } from '@/components/agent/WidgetRenderer'
import { SchemaWidgetRenderer } from '@/components/agent/SchemaWidgetRenderer'

interface PinnedWidgetPreviewPanelProps {
  sessionId: string
  widget: SessionPinnedWidget | null
  viewMode: SessionWorkbenchViewMode
  onViewModeChange?: (mode: SessionWorkbenchViewMode) => void
}

function renderCodeContent(widget: SessionPinnedWidget): string {
  if (widget.payload.kind === 'schema') {
    return JSON.stringify(widget.payload, null, 2)
  }

  return widget.payload.widget_code
}

function resolveWidgetCodeLanguage(widget: SessionPinnedWidget): string {
  return widget.payload.kind === 'schema' ? 'json' : 'tsx'
}

export function PinnedWidgetPreviewPanel({
  sessionId,
  widget,
  viewMode,
  onViewModeChange,
}: PinnedWidgetPreviewPanelProps): React.ReactElement {
  const setWidgetDraftProposal = useSetAtom(setWidgetDraftProposalAtom)

  const handleDraftIntent = React.useCallback((intent: WidgetDraftIntent): void => {
    setWidgetDraftProposal({
      sessionId,
      proposal: intent,
    })
  }, [sessionId, setWidgetDraftProposal])

  if (!widget) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="flex max-w-[260px] flex-col items-center gap-2 text-center text-muted-foreground">
          <LayoutPanelTop className="size-8" />
          <div className="text-sm font-medium text-foreground">选择一个已固定 widget</div>
          <div className="text-xs leading-5">在 transcript 中 pin 的 widget 会出现在这里，方便持续查看。</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 pb-2.5 pt-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-foreground">{widget.title}</div>
          <div className="truncate text-[11px] text-muted-foreground">Pinned Widget · {widget.id}</div>
        </div>
        {onViewModeChange && (
          <div className="inline-flex items-center rounded-lg border bg-muted/35 p-0.5">
            <button
              type="button"
              className={viewMode === 'preview'
                ? 'rounded-lg bg-background px-3 py-1 text-xs font-medium text-foreground'
                : 'rounded-lg px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground'}
              onClick={() => onViewModeChange('preview')}
            >
              <span className="inline-flex items-center gap-1"><Eye className="size-3.5" />Preview</span>
            </button>
            <button
              type="button"
              className={viewMode === 'code'
                ? 'rounded-lg bg-background px-3 py-1 text-xs font-medium text-foreground'
                : 'rounded-lg px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground'}
              onClick={() => onViewModeChange('code')}
            >
              <span className="inline-flex items-center gap-1"><Code className="size-3.5" />Code</span>
            </button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {viewMode === 'code' ? (
          <div className="h-full overflow-auto px-3 py-3">
            <CodeBlock>
              <code className={`language-${resolveWidgetCodeLanguage(widget)}`}>{renderCodeContent(widget)}</code>
            </CodeBlock>
          </div>
        ) : widget.payload.kind === 'schema' ? (
          <div className="h-full overflow-auto px-4 py-3">
            <SchemaWidgetRenderer
              title={widget.payload.title || widget.title}
              caption={widget.payload.caption}
              widgetType={widget.payload.widget_type}
              spec={widget.payload.spec}
              draftSource={{
                widgetKey: `widget:${widget.id}`,
                pinId: widget.id,
              }}
              onDraftIntent={handleDraftIntent}
            />
          </div>
        ) : (
          <div className="h-full overflow-auto px-4 py-3">
            <WidgetRenderer
              title={widget.payload.title || widget.title}
              widgetCode={widget.payload.widget_code}
              draftSource={{
                widgetKey: `widget:${widget.id}`,
                pinId: widget.id,
              }}
              onDraftIntent={handleDraftIntent}
            />
          </div>
        )}
      </div>
    </div>
  )
}
