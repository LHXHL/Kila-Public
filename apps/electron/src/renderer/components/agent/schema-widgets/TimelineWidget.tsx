import type { TimelineSpec } from '@kila/shared'

const STATUS_CLASS_NAME = {
  done: 'bg-[hsl(var(--status-success))]',
  active: 'bg-[hsl(var(--chart-1))]',
  pending: 'bg-muted-foreground/35',
  error: 'bg-destructive',
} as const

interface TimelineWidgetProps {
  spec: TimelineSpec
  onItemClick?: (input: { item: TimelineSpec['items'][number]; index: number }) => void
}

export function TimelineWidget({ spec, onItemClick }: TimelineWidgetProps): JSX.Element {
  return (
    <div className="space-y-3">
      {spec.items.map((item, index) => {
        const status = item.status ?? 'pending'
        const content = (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-medium text-foreground">{item.title}</div>
              {item.timestamp && (
                <div className="text-[11px] text-muted-foreground">{item.timestamp}</div>
              )}
            </div>
            {item.subtitle && (
              <div className="mt-1 text-[12px] text-muted-foreground">{item.subtitle}</div>
            )}
          </>
        )
        return (
          <div key={`${item.title}:${index}`} className="grid grid-cols-[18px_minmax(0,1fr)] gap-3">
            <div className="flex flex-col items-center">
              <span className={`mt-1 size-3 rounded-full ${STATUS_CLASS_NAME[status]}`} />
              {index < spec.items.length - 1 && (
                <span className="mt-1 h-full w-px bg-border/40" />
              )}
            </div>
            {onItemClick ? (
              <button
                type="button"
                className="pb-3 text-left transition-colors hover:text-foreground"
                onClick={() => onItemClick({ item, index })}
              >
                {content}
              </button>
            ) : (
              <div className="pb-3">
                {content}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
