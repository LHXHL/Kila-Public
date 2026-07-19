import { clamp, getContrastRatio, setC, setL } from './oklch'
import type { OklchColor } from './theme-types'

function nudgeToward(color: OklchColor, bg: OklchColor, targetL: number, minRatio: number): OklchColor {
  let current = color
  for (let step = 0; step < 120; step += 1) {
    if (getContrastRatio(current, bg) >= minRatio) return current
    const nextL = current.l + (targetL - current.l) * 0.18
    current = setC(setL(current, nextL), current.c * 0.995)
  }
  return current
}

export function ensureContrast(fg: OklchColor, bg: OklchColor, minRatio: number): OklchColor {
  if (getContrastRatio(fg, bg) >= minRatio) return fg

  const lighter = nudgeToward(fg, bg, 1, minRatio)
  const darker = nudgeToward(fg, bg, 0, minRatio)
  const lighterRatio = getContrastRatio(lighter, bg)
  const darkerRatio = getContrastRatio(darker, bg)

  const lighterDelta = Math.abs(lighter.l - fg.l)
  const darkerDelta = Math.abs(darker.l - fg.l)

  if (lighterRatio >= minRatio && darkerRatio >= minRatio) {
    return lighterDelta <= darkerDelta ? lighter : darker
  }
  if (lighterRatio >= minRatio) return lighter
  if (darkerRatio >= minRatio) return darker
  return lighterRatio >= darkerRatio ? lighter : darker
}

export function pickOnColor(
  bg: OklchColor,
  darkText: OklchColor,
  lightText: OklchColor,
  minRatio: number,
): OklchColor {
  const preferred = getContrastRatio(darkText, bg) >= getContrastRatio(lightText, bg)
    ? darkText
    : lightText
  const fallback = preferred === darkText ? lightText : darkText

  const preferredAdjusted = ensureContrast(preferred, bg, minRatio)
  if (getContrastRatio(preferredAdjusted, bg) >= minRatio) {
    return preferredAdjusted
  }

  return ensureContrast(fallback, bg, minRatio)
}

export function isContrastPassing(fg: OklchColor, bg: OklchColor, minRatio: number): boolean {
  return getContrastRatio(fg, bg) >= clamp(minRatio, 1, 21)
}
