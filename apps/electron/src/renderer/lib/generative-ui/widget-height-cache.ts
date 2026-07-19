const widgetHeightCache = new Map<string, number>()

/**
 * 使用完整内容计算稳定缓存键，避免不同 Widget 共享前 200 字符时高度串用。
 * 双 32-bit hash + 长度不是密码学哈希，但足以作为进程内布局缓存键。
 */
export function getWidgetCacheKey(widgetCode: string): string {
  let hashA = 0x811c9dc5
  let hashB = 0x9e3779b9

  for (let index = 0; index < widgetCode.length; index += 1) {
    const code = widgetCode.charCodeAt(index)
    hashA ^= code
    hashA = Math.imul(hashA, 0x01000193)
    hashB ^= code + index
    hashB = Math.imul(hashB, 0x85ebca6b)
  }

  return `widget:${widgetCode.length}:${(hashA >>> 0).toString(36)}:${(hashB >>> 0).toString(36)}`
}

export function getCachedWidgetHeight(cacheKey: string): number | undefined {
  return widgetHeightCache.get(cacheKey)
}

export function setCachedWidgetHeight(cacheKey: string, height: number): void {
  if (!cacheKey) return

  const nextHeight = Math.max(1, Math.ceil(height))
  widgetHeightCache.set(cacheKey, nextHeight)
}
