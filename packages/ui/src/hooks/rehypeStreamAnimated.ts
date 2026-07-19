/**
 * rehypeStreamAnimated — 字符级 fade-in rehype 插件
 *
 * 对标 LobeHub lobe-ui：
 * https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/plugins/rehypeStreamAnimated.ts
 *
 * 遍历 HAST 树，给 p/h1-h6/li 中的文本字符包 <span class="stream-char">，
 * 跳过 pre/code/table/svg 和 .katex 元素。
 *
 * 每个字符根据 births[] 数组计算 animation-delay：
 * - 已完成 fade → stream-char-revealed（animation: none）
 * - 尚未开始 → 正 delay
 * - 正在 fade 中 → 负 delay（利用 CSS animation 的负 delay 机制跳到动画中间）
 */

import type { Element, ElementContent, Root } from 'hast'
import { visit, type BuildVisitor } from 'unist-util-visit'

export interface StreamAnimatedOptions {
  births?: number[]
  fadeDuration?: number
  nowMs?: number
  revealed?: boolean
}

const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'])
const SKIP_TAGS = new Set(['pre', 'code', 'table', 'svg'])

function hasClass(node: Element, cls: string): boolean {
  const cn = node.properties?.className
  if (Array.isArray(cn)) return cn.some((c) => String(c).includes(cls))
  if (typeof cn === 'string') return cn.includes(cls)
  return false
}

export const rehypeStreamAnimated = (options: StreamAnimatedOptions = {}) => {
  const { births, fadeDuration = 150, nowMs, revealed = false } = options
  const hasBirths = !revealed && Array.isArray(births) && typeof nowMs === 'number'

  return (tree: Root) => {
    let globalCharIndex = 0

    const shouldSkip = (node: Element): boolean =>
      SKIP_TAGS.has(node.tagName) || hasClass(node, 'katex')

    const wrapText = (node: Element): void => {
      const newChildren: ElementContent[] = []
      for (const child of node.children) {
        if (child.type === 'text') {
          for (const char of child.value) {
            let className = 'stream-char'
            let delay: number | undefined

            if (revealed) {
              className = 'stream-char stream-char-revealed'
            } else if (hasBirths) {
              const birthTs = births![globalCharIndex]
              if (birthTs === undefined) {
                className = 'stream-char stream-char-revealed'
              } else {
                const elapsed = (nowMs as number) - birthTs
                if (elapsed >= fadeDuration) {
                  className = 'stream-char stream-char-revealed'
                } else {
                  // Negative delay = already elapsed ms into the fade.
                  // Positive delay = not started yet (staggered within same commit).
                  delay = -elapsed
                }
              }
            }

            const properties: Record<string, string | number | boolean | (string | number)[] | null | undefined> = { className }
            if (delay !== undefined && delay !== 0) {
              properties.style = `animation-delay:${delay}ms`
            }
            newChildren.push({
              children: [{ type: 'text', value: char }],
              properties,
              tagName: 'span',
              type: 'element',
            })
            globalCharIndex++
          }
        } else if (child.type === 'element') {
          if (!shouldSkip(child)) {
            wrapText(child)
          }
          newChildren.push(child)
        } else {
          newChildren.push(child)
        }
      }
      node.children = newChildren
    }

    visit(tree, 'element', ((node: Element) => {
      if (shouldSkip(node)) return 'skip'
      if (BLOCK_TAGS.has(node.tagName)) {
        wrapText(node)
        return 'skip'
      }
    }) as BuildVisitor<Root, 'element'>)
  }
}
