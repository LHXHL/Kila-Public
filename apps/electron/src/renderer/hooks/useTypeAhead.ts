/**
 * useTypeAhead — 列表 type-ahead 按键跳转 hook
 *
 * 在长列表中，用户按字母键即可跳转到匹配项（macOS Finder 同款行为）。
 * 支持多字符 buffer 并在 1s 后自动重置。
 */

import * as React from 'react'

interface TypeAheadOptions<T> {
  /** 列表项数组 */
  items: T[]
  /** 从列表项中提取用于匹配的文本（通常是 title） */
  getLabel: (item: T) => string
  /** 跳转到某项时的回调 */
  onMatch: (item: T, index: number) => void
  /** 是否启用（默认 true） */
  enabled?: boolean
}

/**
 * 返回一个 onKeyDown handler，绑定到容器元素即可。
 * 支持连续按键累积 buffer 匹配。
 */
export function useTypeAhead<T>({
  items,
  getLabel,
  onMatch,
  enabled = true,
}: TypeAheadOptions<T>): {
  onKeyDown: (e: React.KeyboardEvent) => void
} {
  const bufferRef = React.useRef('')
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (!enabled) return

      // 忽略修饰键、功能键、特殊键
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key.length !== 1) return

      // 忽略输入框内的按键
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }

      e.preventDefault()

      // 累积 buffer
      bufferRef.current += e.key.toLowerCase()

      // 重置计时器
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        bufferRef.current = ''
      }, 1000)

      // 查找匹配项
      const query = bufferRef.current
      const matchIndex = items.findIndex((item) =>
        getLabel(item).toLowerCase().startsWith(query),
      )

      if (matchIndex >= 0) {
        onMatch(items[matchIndex]!, matchIndex)
      }
    },
    [enabled, items, getLabel, onMatch],
  )

  // 清理计时器
  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return { onKeyDown }
}
