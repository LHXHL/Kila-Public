import type { LineChartSpec } from '@kila/shared'
import { getFiniteChartExtent, limitChartRows, toFiniteChartNumber } from './chart-data'

const SVG_WIDTH = 460
const SVG_HEIGHT = 220
const PADDING_LEFT = 28
const PADDING_RIGHT = 16
const PADDING_TOP = 16
const PADDING_BOTTOM = 34

function getChartColor(colorIndex?: 1 | 2 | 3 | 4 | 5): string {
  return `hsl(var(--chart-${colorIndex ?? 1}))`
}

function getSeriesValues(spec: LineChartSpec): number[] {
  return spec.data.flatMap((row) => spec.series.map((series) => {
    const value = row[series.key]
    return toFiniteChartNumber(value)
  }))
}

function buildPolylinePoints(spec: LineChartSpec, seriesKey: string): string {
  const chartWidth = SVG_WIDTH - PADDING_LEFT - PADDING_RIGHT
  const chartHeight = SVG_HEIGHT - PADDING_TOP - PADDING_BOTTOM
  const values = getSeriesValues(spec)
  const { min: minValue, max: maxValue } = getFiniteChartExtent(values)
  const range = Math.max(1, maxValue - minValue)

  return spec.data.map((row, index) => {
    const x = PADDING_LEFT + (spec.data.length === 1 ? chartWidth / 2 : (chartWidth * index) / (spec.data.length - 1))
    const rawValue = row[seriesKey]
    const numericValue = toFiniteChartNumber(rawValue)
    const y = PADDING_TOP + chartHeight - ((numericValue - minValue) / range) * chartHeight
    return `${x},${y}`
  }).join(' ')
}

export function LineChartWidget({ spec, onPointClick }: LineChartWidgetProps): JSX.Element {
  const { rows: chartData, truncatedCount } = limitChartRows(spec.data)
  const renderSpec = chartData === spec.data ? spec : { ...spec, data: chartData }
  const values = getSeriesValues(renderSpec)
  const { min: minValue, max: maxValue } = getFiniteChartExtent(values)
  const chartHeight = SVG_HEIGHT - PADDING_TOP - PADDING_BOTTOM
  const chartWidth = SVG_WIDTH - PADDING_LEFT - PADDING_RIGHT

  return (
    <LineChartWidgetBody
      spec={renderSpec}
      onPointClick={onPointClick}
      truncatedRowCount={truncatedCount}
      chartHeight={chartHeight}
      chartWidth={chartWidth}
      minValue={minValue}
      maxValue={maxValue}
    />
  )
}

interface LineChartWidgetProps {
  spec: LineChartSpec
  onPointClick?: (input: {
    row: LineChartSpec['data'][number]
    rowIndex: number
    xValue: string
    seriesKey: string
    seriesLabel: string
    value: number
  }) => void
}

function LineChartWidgetBody({
  spec,
  onPointClick,
  chartHeight,
  chartWidth,
  minValue,
  maxValue,
  truncatedRowCount,
}: LineChartWidgetProps & {
  chartHeight: number
  chartWidth: number
  minValue: number
  maxValue: number
  truncatedRowCount: number
}): JSX.Element {
  const range = Math.max(1, maxValue - minValue)

  return (
    <div className="space-y-3">
      {spec.showLegend !== false && spec.series.length > 1 && (
        <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          {spec.series.map((series, index) => (
            <div key={series.key} className="inline-flex items-center gap-1.5 rounded-full border border-border/30 px-2 py-1">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: getChartColor(series.colorIndex ?? ((index % 5) + 1) as 1 | 2 | 3 | 4 | 5) }}
              />
              <span>{series.label}</span>
            </div>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} className="w-full overflow-visible" role="img" aria-label={`折线图，共 ${spec.data.length} 个数据点、${spec.series.length} 个系列`}>
        <title>{`折线图：${spec.series.map((series) => series.label).join('、')}`}</title>
        {[0, 1, 2, 3].map((index) => {
          const y = PADDING_TOP + (chartHeight * index) / 3
          const labelValue = (maxValue - ((maxValue - minValue) * index) / 3).toFixed(0)
          return (
            <g key={index}>
              <line x1={PADDING_LEFT} y1={y} x2={SVG_WIDTH - PADDING_RIGHT} y2={y} stroke="hsl(var(--border))" strokeOpacity="0.35" strokeDasharray="4 4" />
              <text x={0} y={y + 4} fontSize="11" fill="hsl(var(--muted-foreground))">{labelValue}</text>
            </g>
          )
        })}
        {spec.series.map((series, index) => (
          <polyline
            key={series.key}
            fill="none"
            stroke={getChartColor(series.colorIndex ?? ((index % 5) + 1) as 1 | 2 | 3 | 4 | 5)}
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={buildPolylinePoints(spec, series.key)}
          />
        ))}
        {spec.series.flatMap((series) => spec.data.map((row, index) => {
          const x = PADDING_LEFT + (spec.data.length === 1 ? chartWidth / 2 : (chartWidth * index) / (spec.data.length - 1))
          const rawValue = row[series.key]
          const value = toFiniteChartNumber(rawValue)
          const y = PADDING_TOP + chartHeight - ((value - minValue) / range) * chartHeight
          const xValue = String(row[spec.xKey] ?? '')

          return (
            <g
              key={`${series.key}:${xValue}:${index}`}
              className={undefined}
              role={onPointClick ? 'button' : undefined}
              tabIndex={onPointClick ? 0 : undefined}
              aria-label={`${xValue}，${series.label}：${value}`}
              onClick={onPointClick ? () => onPointClick({
                row,
                rowIndex: index,
                xValue,
                seriesKey: series.key,
                seriesLabel: series.label,
                value,
              }) : undefined}
              onKeyDown={onPointClick ? (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onPointClick({ row, rowIndex: index, xValue, seriesKey: series.key, seriesLabel: series.label, value })
              } : undefined}
            >
              <circle
                cx={x}
                cy={y}
                r="8"
                fill="transparent"
              />
              <circle
                cx={x}
                cy={y}
                r="4.5"
                fill={getChartColor(series.colorIndex ?? ((index % 5) + 1) as 1 | 2 | 3 | 4 | 5)}
                stroke="hsl(var(--background))"
                strokeWidth="2"
              />
            </g>
          )
        }))}
        {spec.data.map((row, index) => {
          const x = PADDING_LEFT + (spec.data.length === 1 ? chartWidth / 2 : (chartWidth * index) / (spec.data.length - 1))
          const label = String(row[spec.xKey] ?? '')
          return (
            <text key={`${label}:${index}`} x={x} y={SVG_HEIGHT - 8} textAnchor="middle" fontSize="11" fill="hsl(var(--muted-foreground))">{label}</text>
          )
        })}
      </svg>
      {truncatedRowCount > 0 && (
        <p className="text-[11px] text-muted-foreground">数据量较大，仅显示前 {spec.data.length} 个点，另有 {truncatedRowCount} 个点未绘制。</p>
      )}
      {spec.yAxisLabel && (
        <div className="text-[11px] text-muted-foreground">{spec.yAxisLabel}</div>
      )}
    </div>
  )
}
