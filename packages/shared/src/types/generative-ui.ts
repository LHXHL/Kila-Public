export const SCHEMA_WIDGET_TYPES = [
  'stat-grid',
  'line-chart',
  'bar-chart',
  'comparison-table',
  'timeline',
  'flow-diagram',
] as const

export type SchemaWidgetType = (typeof SCHEMA_WIDGET_TYPES)[number]

export interface CodeWidgetPayload {
  kind?: 'code'
  title?: string
  widget_code: string
}

export interface StatGridItem {
  label: string
  value: string
  delta?: string
  tone?: 'neutral' | 'positive' | 'negative' | 'warning'
  footnote?: string
}

export interface StatGridSpec {
  items: StatGridItem[]
}

export interface ChartSeriesSpec {
  key: string
  label: string
  colorIndex?: 1 | 2 | 3 | 4 | 5
}

export interface LineChartSpec {
  xKey: string
  series: ChartSeriesSpec[]
  data: Array<Record<string, string | number>>
  yAxisLabel?: string
  showLegend?: boolean
}

export interface BarChartSpec {
  xKey: string
  series: ChartSeriesSpec[]
  data: Array<Record<string, string | number>>
  yAxisLabel?: string
  stacked?: boolean
}

export interface ComparisonTableColumn {
  key: string
  label: string
  align?: 'left' | 'center' | 'right'
}

export interface ComparisonTableSpec {
  columns: ComparisonTableColumn[]
  rows: Array<Record<string, string | number | boolean>>
  highlightColumnKeys?: string[]
}

export interface TimelineItem {
  title: string
  subtitle?: string
  timestamp?: string
  status?: 'done' | 'active' | 'pending' | 'error'
}

export interface TimelineSpec {
  items: TimelineItem[]
}

export interface FlowDiagramNode {
  id: string
  label: string
  group?: string
  tone?: 'neutral' | 'info' | 'success' | 'warning'
}

export interface FlowDiagramEdge {
  from: string
  to: string
  label?: string
}

export interface FlowDiagramSpec {
  nodes: FlowDiagramNode[]
  edges: FlowDiagramEdge[]
}

export type SchemaWidgetSpec =
  | StatGridSpec
  | LineChartSpec
  | BarChartSpec
  | ComparisonTableSpec
  | TimelineSpec
  | FlowDiagramSpec

export interface SchemaWidgetPayload {
  kind: 'schema'
  title?: string
  widget_type: SchemaWidgetType
  spec: SchemaWidgetSpec
  caption?: string
}

export type ShowWidgetPayload = CodeWidgetPayload | SchemaWidgetPayload
