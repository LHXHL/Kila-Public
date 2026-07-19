import { describe, expect, test } from 'bun:test'
import { getBuiltinTheme } from './builtin-themes'
import { deriveThemeColorMap } from './theme-derive'
import { isContrastPassing } from './theme-validate'
import { getContrastRatio, oklchToHex, parseOklch } from './oklch'

describe('built-in Codex theme', () => {
  const codex = getBuiltinTheme('codex')

  test('preserves the supplied light preset colors', () => {
    expect(oklchToHex(parseOklch(codex.colors.base))).toBe('#ffffff')
    expect(oklchToHex(parseOklch(codex.colors.ink))).toBe('#0d0d0d')
    expect(oklchToHex(parseOklch(codex.colors.accent))).toBe('#0269cc')
    expect(oklchToHex(parseOklch(codex.colors.positive))).toBe('#00a240')
    expect(oklchToHex(parseOklch(codex.colors.critical))).toBe('#e02e2a')
    expect(oklchToHex(parseOklch(codex.colors.notice))).toBe('#751ed9')
  })

  test('preserves the supplied dark preset colors', () => {
    const dark = codex.dark?.colors

    expect(dark).toBeDefined()
    expect(oklchToHex(parseOklch(dark!.base!))).toBe('#111111')
    expect(oklchToHex(parseOklch(dark!.ink!))).toBe('#fcfcfc')
    expect(oklchToHex(parseOklch(dark!.accent!))).toBe('#0269cc')
    expect(oklchToHex(parseOklch(dark!.positive!))).toBe('#00a240')
    expect(oklchToHex(parseOklch(dark!.critical!))).toBe('#e02e2a')
    expect(oklchToHex(parseOklch(dark!.notice!))).toBe('#b06dff')
  })

  test('keeps broad surfaces and message bubbles neutral instead of reusing the blue accent', () => {
    for (const mode of ['light', 'dark'] as const) {
      const colors = deriveThemeColorMap(codex, mode)
      const softSurface = colors['--brand-soft']
      const softSurfaceHover = colors['--brand-soft-hover']
      const bubble = colors['--kila-user-bubble']
      const bubbleForeground = colors['--kila-user-bubble-foreground']

      expect(softSurface.c).toBeLessThan(0.01)
      expect(softSurfaceHover.c).toBeLessThan(0.01)
      expect(bubble.c).toBeLessThan(0.01)
      expect(oklchToHex(softSurface)).not.toBe(oklchToHex(colors['--primary']))
      expect(oklchToHex(bubble)).not.toBe(oklchToHex(colors['--primary']))
      expect(isContrastPassing(bubbleForeground, bubble, 4.5)).toBe(true)
      expect(getContrastRatio(bubbleForeground, bubble)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
