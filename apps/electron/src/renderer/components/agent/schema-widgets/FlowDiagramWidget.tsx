import type { FlowDiagramSpec } from '@kila/shared'

const SVG_WIDTH = 560
const NODE_WIDTH = 136
const NODE_HEIGHT = 54
const COLUMN_GAP = 90
const ROW_GAP = 34
const PADDING_X = 16
const PADDING_Y = 20

function getNodeToneColor(tone?: 'neutral' | 'info' | 'success' | 'warning'): string {
  switch (tone) {
    case 'info':
      return 'hsl(var(--chart-1))'
    case 'success':
      return 'hsl(var(--chart-2))'
    case 'warning':
      return 'hsl(var(--chart-3))'
    default:
      return 'hsl(var(--border))'
  }
}

function buildDepthMap(spec: FlowDiagramSpec): Map<string, number> {
  const parents = new Map<string, string[]>()
  spec.nodes.forEach((node) => parents.set(node.id, []))
  spec.edges.forEach((edge) => {
    parents.get(edge.to)?.push(edge.from)
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

  return depthMap
}

interface FlowDiagramWidgetProps {
  spec: FlowDiagramSpec
  onNodeClick?: (input: { node: FlowDiagramSpec['nodes'][number] }) => void
  onEdgeClick?: (input: { edge: FlowDiagramSpec['edges'][number] }) => void
}

export function FlowDiagramWidget({
  spec,
  onNodeClick,
  onEdgeClick,
}: FlowDiagramWidgetProps): JSX.Element {
  const depthMap = buildDepthMap(spec)
  const groups = new Map<number, typeof spec.nodes>()
  spec.nodes.forEach((node) => {
    const depth = depthMap.get(node.id) ?? 0
    const nodes = groups.get(depth) ?? []
    nodes.push(node)
    groups.set(depth, nodes)
  })

  const levels = [...groups.entries()].sort((a, b) => a[0] - b[0])
  const maxRows = Math.max(1, ...levels.map(([, nodes]) => nodes.length))
  const svgHeight = PADDING_Y * 2 + maxRows * NODE_HEIGHT + Math.max(0, maxRows - 1) * ROW_GAP
  const positions = new Map<string, { x: number; y: number }>()

  levels.forEach(([depth, nodes]) => {
    const totalHeight = nodes.length * NODE_HEIGHT + Math.max(0, nodes.length - 1) * ROW_GAP
    const startY = PADDING_Y + (svgHeight - PADDING_Y * 2 - totalHeight) / 2
    nodes.forEach((node, index) => {
      positions.set(node.id, {
        x: PADDING_X + depth * (NODE_WIDTH + COLUMN_GAP),
        y: startY + index * (NODE_HEIGHT + ROW_GAP),
      })
    })
  })

  return (
    <svg viewBox={`0 0 ${SVG_WIDTH} ${svgHeight}`} className="w-full overflow-visible">
      {spec.edges.map((edge, index) => {
        const from = positions.get(edge.from)
        const to = positions.get(edge.to)
        if (!from || !to) return null

        const startX = from.x + NODE_WIDTH
        const startY = from.y + NODE_HEIGHT / 2
        const endX = to.x
        const endY = to.y + NODE_HEIGHT / 2
        const midX = startX + (endX - startX) / 2
        const path = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`

        return (
          <g key={`${edge.from}:${edge.to}:${index}`}>
            <path
              d={path}
              fill="none"
              stroke="hsl(var(--border))"
              strokeOpacity="0.75"
              strokeWidth="2"
              className={undefined}
              onClick={onEdgeClick ? () => onEdgeClick({ edge }) : undefined}
            />
            {edge.label && (
              <text x={midX} y={(startY + endY) / 2 - 6} textAnchor="middle" fontSize="11" fill="hsl(var(--muted-foreground))">
                {edge.label}
              </text>
            )}
          </g>
        )
      })}
      {levels.flatMap(([, nodes]) => nodes).map((node) => {
        const position = positions.get(node.id)
        if (!position) return null

        return (
          <g key={node.id}>
            <rect
              x={position.x}
              y={position.y}
              width={NODE_WIDTH}
              height={NODE_HEIGHT}
              rx="14"
              fill="hsl(var(--background))"
              stroke={getNodeToneColor(node.tone)}
              strokeOpacity="0.45"
              className={undefined}
              onClick={onNodeClick ? () => onNodeClick({ node }) : undefined}
            />
            <text x={position.x + 12} y={position.y + 25} fontSize="13" fontWeight="600" fill="hsl(var(--foreground))">
              {node.label}
            </text>
            {node.group && (
              <text x={position.x + 12} y={position.y + 41} fontSize="11" fill="hsl(var(--muted-foreground))">
                {node.group}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
