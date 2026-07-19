export function toFiniteChartNumber(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

export function getFiniteChartExtent(values: number[]): { min: number; max: number } {
  const finiteValues = values.filter(Number.isFinite)
  if (finiteValues.length === 0) return { min: 0, max: 1 }
  const min = Math.min(...finiteValues)
  const max = Math.max(...finiteValues)
  return min === max ? { min, max: min + 1 } : { min, max }
}

export function getBarChartExtent(rows: number[][], stacked: boolean): { min: number; max: number } {
  const normalizedRows = rows.map((row) => row.map(toFiniteChartNumber))
  if (normalizedRows.length === 0 || normalizedRows.every((row) => row.length === 0)) {
    return { min: 0, max: 1 }
  }

  const values = stacked
    ? normalizedRows.flatMap((row) => [
      row.filter((value) => value < 0).reduce((sum, value) => sum + value, 0),
      row.filter((value) => value > 0).reduce((sum, value) => sum + value, 0),
    ])
    : normalizedRows.flat()
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  return min === max ? { min, max: min + 1 } : { min, max }
}

export const MAX_RENDERED_CHART_ROWS = 200

export function limitChartRows<T>(rows: T[], limit = MAX_RENDERED_CHART_ROWS): { rows: T[]; truncatedCount: number } {
  const safeLimit = Math.max(1, Math.floor(limit))
  return {
    rows: rows.length > safeLimit ? rows.slice(0, safeLimit) : rows,
    truncatedCount: Math.max(0, rows.length - safeLimit),
  }
}
