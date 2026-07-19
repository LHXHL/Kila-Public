/**
 * 字体状态原子
 *
 * 管理全局字体族名和字体大小。
 * 通过 CSS 变量实时应用到 :root。
 */

import { atom } from 'jotai'

/** 默认字体大小 */
export const DEFAULT_FONT_SIZE = 15

/** 用户选择的字体族名（空串 = 系统默认） */
export const fontFamilyAtom = atom<string>('')

/** 用户选择的字体大小（px） */
export const fontSizeAtom = atom<number>(DEFAULT_FONT_SIZE)

/**
 * 将字体设置应用到 DOM（CSS 变量）
 */
export function applyFontToDOM(fontFamily: string, fontSize: number): void {
  const root = document.documentElement

  if (fontFamily) {
    root.style.setProperty(
      '--kila-font-family',
      `"${fontFamily}", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`,
    )
  } else {
    root.style.removeProperty('--kila-font-family')
  }

  // 直接设置根元素 font-size，Tailwind 的 rem 单位会自动缩放
  root.style.fontSize = `${fontSize}px`
}
