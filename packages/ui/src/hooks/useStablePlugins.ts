/**
 * useStablePlugins — rehype/remark 插件列表引用稳定化
 *
 * 对标 LobeHub lobe-ui：
 * https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/StreamdownRender.tsx#L101-L109
 *
 * 防止插件数组引用变化（即使内容相同）触发 StreamdownBlock memo 失效。
 * 通过深度比较插件列表，仅在内容真正变化时更新引用。
 */

import { useRef } from 'react'
import type { Pluggable, PluggableList } from 'unified'

// ===== Deep equality for plugins =====

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isDeepEqualValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!isDeepEqualValue(a[i], b[i])) return false
    }
    return true
  }

  if (!isRecord(a) || !isRecord(b)) return false

  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false

  for (const key of keysA) {
    if (!isDeepEqualValue(a[key], b[key])) return false
  }

  return true
}

const isSamePlugin = (prevPlugin: Pluggable, nextPlugin: Pluggable): boolean => {
  const prevTuple = Array.isArray(prevPlugin) ? prevPlugin : [prevPlugin]
  const nextTuple = Array.isArray(nextPlugin) ? nextPlugin : [nextPlugin]

  if (prevTuple.length !== nextTuple.length) return false
  if (prevTuple[0] !== nextTuple[0]) return false

  return isDeepEqualValue(prevTuple.slice(1), nextTuple.slice(1))
}

export const isSamePlugins = (
  prevPlugins?: PluggableList | null,
  nextPlugins?: PluggableList | null,
): boolean => {
  if (prevPlugins === nextPlugins) return true
  if (!prevPlugins || !nextPlugins) return !prevPlugins && !nextPlugins
  if (prevPlugins.length !== nextPlugins.length) return false

  for (let i = 0; i < prevPlugins.length; i++) {
    if (!isSamePlugin(prevPlugins[i]!, nextPlugins[i]!)) return false
  }

  return true
}

// ===== Hook =====

export const useStablePlugins = (plugins: PluggableList): PluggableList => {
  const stableRef = useRef<PluggableList>(plugins)

  if (!isSamePlugins(stableRef.current, plugins)) {
    stableRef.current = plugins
  }

  return stableRef.current
}
