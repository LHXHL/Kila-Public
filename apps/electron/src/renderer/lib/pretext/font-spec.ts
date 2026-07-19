export interface ElementFontSpec {
  font: string
  lineHeightPx: number
}

function parsePx(value: string): number | null {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function getElementFontSpec(element: Element | null): ElementFontSpec | null {
  if (!element || typeof window === 'undefined') return null

  const styles = window.getComputedStyle(element)
  const fontSizePx = parsePx(styles.fontSize)
  const fontFamily = styles.fontFamily.trim()
  if (!fontSizePx || !fontFamily) return null

  const lineHeightPx = parsePx(styles.lineHeight) ?? Number((fontSizePx * 1.6).toFixed(2))
  const parts = [
    styles.fontStyle !== 'normal' ? styles.fontStyle : '',
    styles.fontVariant !== 'normal' ? styles.fontVariant : '',
    styles.fontWeight || '',
    styles.fontStretch && styles.fontStretch !== 'normal' ? styles.fontStretch : '',
    styles.fontSize,
    fontFamily,
  ].filter(Boolean)

  if (parts.length < 2) return null

  return {
    font: parts.join(' ').replace(/\s+/g, ' ').trim(),
    lineHeightPx,
  }
}
