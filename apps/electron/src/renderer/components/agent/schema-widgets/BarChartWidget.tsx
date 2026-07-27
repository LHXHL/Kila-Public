import { useTranslation } from 'react-i18next'
import type { BarChartSpec } from '@kila/shared'
import { getBarChartExtent, limitChartRows, toFiniteChartNumber } from './chart-data'

const SVG_WIDTH = 460
const SVG_HEIGHT = 220
const PADDING_LEFT = 24
const PADDING_RIGHT = 12
const PADDING_TOP = 16
const PADDING_BOTTOM = 34

function getChartColor(colorIndex?: 1 | 2 | 3 | 4 | 5): string {
  return `hsl(var(--chart-${colorIndex ?? 1}))`
}

interface BarChartWidgetProps {
  spec: BarChartSpec
  onBarClick?: (input: {
    row: BarChartSpec['data'][number]
    rowIndex: number
    xValue: string
    seriesKey: string
    seriesLabel: string
    value: number
  }) => void
}

export function BarChartWidget({ spec, onBarClick }: BarChartWidgetProps): JSX.Element {
  const { t } = useTranslation()
  const { rows: chartData, truncatedCount } = limitChartRows(spec.data)
  const chartWidth = SVG_WIDTH - PADDING_LEFT - PADDING_RIGHT
  const chartHeight = SVG_HEIGHT - PADDING_TOP - PADDING_BOTTOM
  const { min: minValue, max: maxValue } = getBarChartExtent(
    chartData.map((row) => spec.series.map((series) => toFiniteChartNumber(row[series.key]))),
    Boolean(spec.stacked),
  )
  const valueRange = Math.max(1, maxValue - minValue)
  const baselineY = PADDING_TOP + (maxValue / valueRange) * chartHeight
  const groupWidth = chartWidth / Math.max(1, chartData.length)
  const innerGap = spec.stacked ? 0 : 8
  const barWidth = spec.stacked
    ? Math.min(36, groupWidth * 0.58)
    : Math.max(8, Math.min(18, (groupWidth - innerGap * (spec.series.length - 1)) / spec.series.length))

  return (
    <div className="space-y-3">
      {spec.series.length > 1 && (
        <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          {spec.series.map((series, index) => (
            <div key={series.key} className="inline-flex items-center gap-1.5 rounded-md border border-border/30 px-2 py-1">
              <span className="size-2 rounded-full" style={{ backgroundColor: getChartColor(series.colorIndex ?? ((index % 5) + 1) as 1 | 2 | 3 | 4 | 5) }} />
              <span>{series.label}</span>
            </div>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} className="w-full overflow-visible" role="img" aria-label={t('agent.chart.barAria', { groups: chartData.length, series: spec.series.length })}>
        <title>{t('agent.chart.barTitle', { series: spec.series.map((series) => series.label).join('、') })}</title>
        {[0, 1, 2, 3].map((index) => {
          const y = PADDING_TOP + (chartHeight * index) / 3
          const labelValue = Number((maxValue - (valueRange * index) / 3).toFixed(2))
          return (
            <g key={index}>
              <line x1={PADDING_LEFT} y1={y} x2={SVG_WIDTH - PADDING_RIGHT} y2={y} stroke="hsl(var(--border))" strokeOpacity="0.35" strokeDasharray="4 4" />
              <text x={0} y={y + 4} fontSize="11" fill="hsl(var(--muted-foreground))">{labelValue}</text>
            </g>
          )
        })}
        {minValue < 0 && maxValue > 0 && (
          <line
            x1={PADDING_LEFT}
            y1={baselineY}
            x2={SVG_WIDTH - PADDING_RIGHT}
            y2={baselineY}
            stroke="hsl(var(--foreground))"
            strokeOpacity="0.35"
          />
        )}
        {chartData.map((row, rowIndex) => {
          const xBase = PADDING_LEFT + rowIndex * groupWidth + (groupWidth - (spec.stacked ? barWidth : spec.series.length * barWidth + (spec.series.length - 1) * innerGap)) / 2
          let positiveStackedOffset = 0
          let negativeStackedOffset = 0
          return (
            <g key={`${String(row[spec.xKey] ?? rowIndex)}`}>
              {spec.series.map((series, seriesIndex) => {
                const rawValue = row[series.key]
                const numericValue = toFiniteChartNumber(rawValue)
                const height = Math.abs(numericValue / valueRange) * chartHeight
                const x = spec.stacked ? xBase : xBase + seriesIndex * (barWidth + innerGap)
                const valueY = PADDING_TOP + ((maxValue - numericValue) / valueRange) * chartHeight
                const y = spec.stacked
                  ? numericValue >= 0
                    ? baselineY - positiveStackedOffset - height
                    : baselineY + negativeStackedOffset
                  : Math.min(baselineY, valueY)
                const rect = (
                  <rect
                    key={series.key}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={height}
                    rx="6"
                    fill={getChartColor(series.colorIndex ?? ((seriesIndex % 5) + 1) as 1 | 2 | 3 | 4 | 5)}
                    fillOpacity="0.88"
                    className={onBarClick ? 'cursor-pointer outline-none focus:stroke-ring focus:stroke-2' : undefined}
                    role={onBarClick ? 'button' : undefined}
                    tabIndex={onBarClick ? 0 : undefined}
                    aria-label={`${String(row[spec.xKey] ?? '')}，${series.label}：${numericValue}`}
                    onClick={onBarClick ? () => onBarClick({
                      row,
                      rowIndex,
                      xValue: String(row[spec.xKey] ?? ''),
                      seriesKey: series.key,
                      seriesLabel: series.label,
                      value: numericValue,
                    }) : undefined}
                    onKeyDown={onBarClick ? (event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      onBarClick({ row, rowIndex, xValue: String(row[spec.xKey] ?? ''), seriesKey: series.key, seriesLabel: series.label, value: numericValue })
                    } : undefined}
                  />
                )
                if (spec.stacked) {
                  if (numericValue >= 0) positiveStackedOffset += height
                  else negativeStackedOffset += height
                }
                return rect
              })}
              <text x={PADDING_LEFT + rowIndex * groupWidth + groupWidth / 2} y={SVG_HEIGHT - 8} textAnchor="middle" fontSize="11" fill="hsl(var(--muted-foreground))">
                {String(row[spec.xKey] ?? '')}
              </text>
            </g>
          )
        })}
      </svg>
      {truncatedCount > 0 && (
        <p className="text-[11px] text-muted-foreground">{t('agent.chart.truncatedBars', { shown: chartData.length, hidden: truncatedCount })}</p>
      )}
      {spec.yAxisLabel && (
        <div className="text-[11px] text-muted-foreground">{spec.yAxisLabel}</div>
      )}
    </div>
  )
}
