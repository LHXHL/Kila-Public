import type { StatGridSpec } from '@kila/shared'

const TONE_CLASS_NAME = {
  neutral: 'border-border/30 bg-background/55 text-foreground',
  positive: 'border-[hsl(var(--status-success)/0.28)] bg-status-success-soft text-status-success-foreground',
  negative: 'border-destructive/20 bg-destructive/5 text-destructive',
  warning: 'border-[hsl(var(--status-warning)/0.28)] bg-status-warning-soft text-status-warning-foreground',
} as const

interface StatGridWidgetProps {
  spec: StatGridSpec
  onItemClick?: (input: { item: StatGridSpec['items'][number]; index: number }) => void
}

export function StatGridWidget({ spec, onItemClick }: StatGridWidgetProps): JSX.Element {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {spec.items.map((item, index) => {
        const tone = item.tone ?? 'neutral'
        const body = (
          <>
            <div className="text-[12px] font-medium text-muted-foreground/80">{item.label}</div>
            <div className="mt-2 text-2xl font-semibold tracking-tight">{item.value}</div>
            {item.delta && (
              <div className="mt-2 text-[12px] font-medium">{item.delta}</div>
            )}
            {item.footnote && (
              <div className="mt-2 text-[11px] text-muted-foreground/80">{item.footnote}</div>
            )}
          </>
        )

        if (onItemClick) {
          return (
            <button
              key={`${item.label}:${item.value}`}
              type="button"
              className={`rounded-xl border p-3 text-left transition-transform hover:-translate-y-0.5 ${TONE_CLASS_NAME[tone]}`}
              onClick={() => onItemClick({ item, index })}
            >
              {body}
            </button>
          )
        }

        return (
          <div
            key={`${item.label}:${item.value}`}
            className={`rounded-xl border p-3 ${TONE_CLASS_NAME[tone]}`}
          >
            {body}
          </div>
        )
      })}
    </div>
  )
}
