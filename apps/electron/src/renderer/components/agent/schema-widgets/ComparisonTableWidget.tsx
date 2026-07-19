import type { ComparisonTableSpec } from '@kila/shared'

interface ComparisonTableWidgetProps {
  spec: ComparisonTableSpec
  onRowClick?: (input: { row: ComparisonTableSpec['rows'][number]; rowIndex: number }) => void
}

export function ComparisonTableWidget({ spec, onRowClick }: ComparisonTableWidgetProps): JSX.Element {
  return (
    <div className="overflow-x-auto rounded-xl border border-border/30">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted/30 text-muted-foreground">
          <tr>
            {spec.columns.map((column) => (
              <th
                key={column.key}
                className="border-b border-border/30 px-3 py-2 text-xs font-medium"
                style={{ textAlign: column.align ?? 'left' }}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className={`odd:bg-background even:bg-muted/10 ${onRowClick ? 'transition-colors hover:bg-accent/40' : ''}`}
              onClick={onRowClick ? () => onRowClick({ row, rowIndex }) : undefined}
            >
              {spec.columns.map((column) => {
                const highlighted = spec.highlightColumnKeys?.includes(column.key)
                return (
                  <td
                    key={column.key}
                    className={`border-b border-border/20 px-3 py-2 text-sm ${highlighted ? 'font-medium text-foreground' : 'text-foreground/78'}`}
                    style={{ textAlign: column.align ?? 'left' }}
                  >
                    {String(row[column.key] ?? '—')}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
