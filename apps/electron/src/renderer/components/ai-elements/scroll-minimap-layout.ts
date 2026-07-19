export interface ScrollMinimapLayoutItem {
  id: string
  heightPx: number
}

export interface MinimapBar {
  key: string
  topRatio: number
  heightRatio: number
  itemIds: string[]
}

export function buildScrollMinimapLayout(input: {
  items: ScrollMinimapLayoutItem[]
  maxBars: number
}): MinimapBar[] {
  if (input.items.length === 0 || input.maxBars <= 0) return []

  const normalizedItems = input.items.map((item) => ({
    ...item,
    heightPx: Math.max(1, item.heightPx),
  }))
  const totalHeight = normalizedItems.reduce((sum, item) => sum + item.heightPx, 0)
  const barCount = Math.min(input.maxBars, Math.max(1, normalizedItems.length === 1 ? input.maxBars : normalizedItems.length))
  const bucketHeight = totalHeight / barCount
  const bars: MinimapBar[] = []

  let offset = 0
  for (let i = 0; i < barCount; i += 1) {
    const start = i * bucketHeight
    const end = i === barCount - 1 ? totalHeight : start + bucketHeight
    const itemIds = normalizedItems
      .filter((item) => {
        const itemStart = offset
        const itemEnd = offset + item.heightPx
        offset = itemEnd
        return itemEnd > start && itemStart < end
      })
      .map((item) => item.id)

    offset = 0
    bars.push({
      key: `bar-${i}`,
      topRatio: i / barCount,
      heightRatio: 1 / barCount,
      itemIds,
    })
  }

  return bars
}
