import type {
  FlowDiagramSpec,
  SchemaWidgetSpec,
  SchemaWidgetType,
} from '@kila/shared'

const SHELL_VERTICAL_PADDING = 32
const TITLE_HEIGHT = 24
const CAPTION_HEIGHT = 20
const META_GAP = 10

function getMetaHeight(title?: string, caption?: string): number {
  let height = SHELL_VERTICAL_PADDING
  if (title) {
    height += TITLE_HEIGHT
  }
  if (caption) {
    height += (title ? META_GAP : 0) + CAPTION_HEIGHT
  }
  return height
}

function estimateStatGridHeight(spec: SchemaWidgetSpec): number {
  if (!('items' in spec)) return 220
  const rows = Math.ceil(spec.items.length / 2)
  return 24 + rows * 92 + Math.max(0, rows - 1) * 12
}

function estimateLineChartHeight(spec: SchemaWidgetSpec): number {
  if (!('series' in spec) || !('data' in spec)) return 300
  const showLegend = 'showLegend' in spec ? spec.showLegend : undefined
  const legendHeight = (showLegend ?? spec.series.length > 1) ? 28 : 0
  const axisLabelHeight = spec.yAxisLabel ? 18 : 0
  return 236 + legendHeight + axisLabelHeight
}

function estimateBarChartHeight(spec: SchemaWidgetSpec): number {
  if (!('series' in spec) || !('data' in spec)) return 310
  const legendHeight = spec.series.length > 1 ? 28 : 0
  const axisLabelHeight = spec.yAxisLabel ? 18 : 0
  return 244 + legendHeight + axisLabelHeight
}

function estimateComparisonTableHeight(spec: SchemaWidgetSpec): number {
  if (!('rows' in spec) || !('columns' in spec)) return 240
  return 40 + 38 + spec.rows.length * 36
}

function estimateTimelineHeight(spec: SchemaWidgetSpec): number {
  if (!('items' in spec)) return 220
  return 24 + spec.items.length * 56
}

function estimateFlowLevels(spec: FlowDiagramSpec): number {
  const parents = new Map<string, string[]>()
  const children = new Map<string, string[]>()

  spec.nodes.forEach((node) => {
    parents.set(node.id, [])
    children.set(node.id, [])
  })

  spec.edges.forEach((edge) => {
    parents.get(edge.to)?.push(edge.from)
    children.get(edge.from)?.push(edge.to)
  })

  const depthMap = new Map<string, number>()
  const visiting = new Set<string>()

  const getDepth = (nodeId: string): number => {
    const cached = depthMap.get(nodeId)
    if (cached !== undefined) return cached
    if (visiting.has(nodeId)) return 0

    visiting.add(nodeId)
    const incoming = parents.get(nodeId) ?? []
    const depth = incoming.length === 0
      ? 0
      : Math.max(...incoming.map((parentId) => getDepth(parentId))) + 1
    visiting.delete(nodeId)
    depthMap.set(nodeId, depth)
    return depth
  }

  spec.nodes.forEach((node) => {
    getDepth(node.id)
  })

  return Math.max(1, ...depthMap.values()) + 1
}

function estimateFlowDiagramHeight(spec: SchemaWidgetSpec): number {
  if (!('nodes' in spec) || !('edges' in spec)) return 260
  const levels = estimateFlowLevels(spec as FlowDiagramSpec)
  const perLevel = Math.ceil(spec.nodes.length / levels)
  return 120 + levels * 28 + perLevel * 84
}

export function estimateSchemaWidgetHeight(input: {
  widgetType: SchemaWidgetType
  spec: SchemaWidgetSpec
  title?: string
  caption?: string
}): number {
  const metaHeight = getMetaHeight(input.title, input.caption)

  const bodyHeight = (() => {
    switch (input.widgetType) {
      case 'stat-grid':
        return estimateStatGridHeight(input.spec)
      case 'line-chart':
        return estimateLineChartHeight(input.spec)
      case 'bar-chart':
        return estimateBarChartHeight(input.spec)
      case 'comparison-table':
        return estimateComparisonTableHeight(input.spec)
      case 'timeline':
        return estimateTimelineHeight(input.spec)
      case 'flow-diagram':
        return estimateFlowDiagramHeight(input.spec)
      default:
        return 320
    }
  })()

  return Math.ceil(metaHeight + bodyHeight)
}
