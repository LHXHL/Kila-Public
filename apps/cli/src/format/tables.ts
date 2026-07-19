function visibleLength(value: string): number {
  return [...value].length
}

export function truncate(value: string, maxLength: number): string {
  if (visibleLength(value) <= maxLength) return value
  return `${[...value].slice(0, Math.max(0, maxLength - 1)).join('')}…`
}

export function formatTable(
  headers: string[],
  rows: string[][],
): string {
  const widths = headers.map((header, columnIndex) => {
    const values = rows.map((row) => row[columnIndex] ?? '')
    return Math.max(visibleLength(header), ...values.map(visibleLength))
  })

  const renderRow = (row: string[]): string => row
    .map((value, columnIndex) => value.padEnd(widths[columnIndex]!, ' '))
    .join('  ')

  return [
    renderRow(headers),
    renderRow(headers.map((_, index) => ''.padEnd(widths[index]!, '-'))),
    ...rows.map(renderRow),
  ].join('\n')
}

export function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp
  const diffSeconds = Math.max(0, Math.floor(diffMs / 1000))

  if (diffSeconds < 60) return `${diffSeconds}s ago`
  const diffMinutes = Math.floor(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays}d ago`
  const diffMonths = Math.floor(diffDays / 30)
  if (diffMonths < 12) return `${diffMonths}mo ago`
  return `${Math.floor(diffMonths / 12)}y ago`
}
