import { z } from 'zod'
import type {
  CodeWidgetPayload,
  SchemaWidgetPayload,
  ShowWidgetPayload,
  SchemaWidgetType,
} from '@kila/shared'

const stringField = z.string().trim().min(1)
const optionalStringField = stringField.optional()
const chartValueSchema = z.union([z.string(), z.number()])
const rowValueSchema = z.union([z.string(), z.number(), z.boolean()])
const colorIndexSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
])

const chartSeriesSchema = z.object({
  key: stringField,
  label: stringField,
  colorIndex: colorIndexSchema.optional(),
})

const statGridSpecSchema = z.object({
  items: z.array(z.object({
    label: stringField,
    value: stringField,
    delta: optionalStringField,
    tone: z.enum(['neutral', 'positive', 'negative', 'warning']).optional(),
    footnote: optionalStringField,
  })).min(1).max(12),
})


function validateChartSpec(
  value: {
    xKey: string
    series: Array<{ key: string }>
    data: Array<Record<string, string | number>>
  },
  ctx: z.RefinementCtx,
): void {
  const seriesKeys = new Set<string>()
  value.series.forEach((series, seriesIndex) => {
    if (seriesKeys.has(series.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['series', seriesIndex, 'key'],
        message: 'chart series keys must be unique',
      })
    }
    seriesKeys.add(series.key)
  })

  value.data.forEach((row, rowIndex) => {
    if (!Object.prototype.hasOwnProperty.call(row, value.xKey) || String(row[value.xKey] ?? '').trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['data', rowIndex, value.xKey],
        message: 'chart xKey must exist in every row',
      })
    }

    value.series.forEach((series) => {
      const rawValue = row[series.key]
      const numericValue = typeof rawValue === 'number'
        ? rawValue
        : typeof rawValue === 'string' && rawValue.trim() !== ''
          ? Number(rawValue)
          : Number.NaN
      if (!Number.isFinite(numericValue)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['data', rowIndex, series.key],
          message: 'chart series values must be finite numbers',
        })
      }
    })
  })
}

const lineChartSpecSchema = z.object({
  xKey: stringField,
  series: z.array(chartSeriesSchema).min(1).max(4),
  data: z.array(z.record(z.string(), chartValueSchema)).min(1).max(24),
  yAxisLabel: optionalStringField,
  showLegend: z.boolean().optional(),
}).superRefine(validateChartSpec)

const barChartSpecSchema = z.object({
  xKey: stringField,
  series: z.array(chartSeriesSchema).min(1).max(4),
  data: z.array(z.record(z.string(), chartValueSchema)).min(1).max(24),
  yAxisLabel: optionalStringField,
  stacked: z.boolean().optional(),
}).superRefine(validateChartSpec)

const comparisonTableSpecSchema = z.object({
  columns: z.array(z.object({
    key: stringField,
    label: stringField,
    align: z.enum(['left', 'center', 'right']).optional(),
  })).min(1).max(10),
  rows: z.array(z.record(z.string(), rowValueSchema)).min(1).max(20),
  highlightColumnKeys: z.array(stringField).max(10).optional(),
})

const timelineSpecSchema = z.object({
  items: z.array(z.object({
    title: stringField,
    subtitle: optionalStringField,
    timestamp: optionalStringField,
    status: z.enum(['done', 'active', 'pending', 'error']).optional(),
  })).min(1).max(20),
})

const flowDiagramSpecSchema = z.object({
  nodes: z.array(z.object({
    id: stringField,
    label: stringField,
    group: optionalStringField,
    tone: z.enum(['neutral', 'info', 'success', 'warning']).optional(),
  })).min(1).max(16),
  edges: z.array(z.object({
    from: stringField,
    to: stringField,
    label: optionalStringField,
  })).max(24),
}).superRefine((value, ctx) => {
  const ids = new Set(value.nodes.map((node) => node.id))
  value.edges.forEach((edge, index) => {
    if (!ids.has(edge.from)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['edges', index, 'from'],
        message: 'flow edge.from must reference an existing node',
      })
    }
    if (!ids.has(edge.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['edges', index, 'to'],
        message: 'flow edge.to must reference an existing node',
      })
    }
  })
})

const codeWidgetPayloadSchema = z.object({
  kind: z.literal('code').optional(),
  title: optionalStringField,
  widget_code: stringField,
})

const schemaWidgetSpecSchemaByType = {
  'stat-grid': statGridSpecSchema,
  'line-chart': lineChartSpecSchema,
  'bar-chart': barChartSpecSchema,
  'comparison-table': comparisonTableSpecSchema,
  timeline: timelineSpecSchema,
  'flow-diagram': flowDiagramSpecSchema,
} satisfies Record<SchemaWidgetType, z.ZodTypeAny>

const schemaWidgetPayloadBaseSchema = z.object({
  kind: z.literal('schema'),
  title: optionalStringField,
  widget_type: z.enum([
    'stat-grid',
    'line-chart',
    'bar-chart',
    'comparison-table',
    'timeline',
    'flow-diagram',
  ]),
  caption: optionalStringField,
  spec: z.unknown(),
})

export function isSchemaWidgetPayload(payload: ShowWidgetPayload): payload is SchemaWidgetPayload {
  return payload.kind === 'schema'
}

export function isCodeWidgetPayload(payload: ShowWidgetPayload): payload is CodeWidgetPayload {
  return payload.kind !== 'schema'
}

export function safeParseShowWidgetPayload(value: unknown): ShowWidgetPayload | null {
  const schemaResult = schemaWidgetPayloadBaseSchema.safeParse(value)
  if (schemaResult.success) {
    const specSchema = schemaWidgetSpecSchemaByType[schemaResult.data.widget_type]
    const parsedSpec = specSchema.safeParse(schemaResult.data.spec)
    if (!parsedSpec.success) return null

    return {
      kind: 'schema',
      title: schemaResult.data.title,
      widget_type: schemaResult.data.widget_type,
      caption: schemaResult.data.caption,
      spec: parsedSpec.data,
    }
  }

  const codeResult = codeWidgetPayloadSchema.safeParse(value)
  if (!codeResult.success) return null

  return codeResult.data
}
