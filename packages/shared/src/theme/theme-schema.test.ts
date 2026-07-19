import { describe, expect, test } from 'bun:test'
import { BUILTIN_THEMES } from './builtin-themes'
import {
  createKilaThemeFile,
  isCustomThemeId,
  validateKilaThemeFile,
  validateThemeDefinition,
} from './theme-schema'

const validTheme = {
  id: 'custom:midnight-ocean',
  name: '午夜海洋',
  description: '深蓝背景与青色强调色',
  author: 'Tester',
  accentSurfaces: 'neutral',
  colors: {
    base: 'oklch(0.975 0.010 220)',
    ink: 'oklch(0.210 0.020 235)',
    accent: 'oklch(0.570 0.130 210)',
    positive: 'oklch(0.580 0.120 150)',
    caution: 'oklch(0.720 0.140 75)',
    critical: 'oklch(0.580 0.180 25)',
    notice: 'oklch(0.590 0.120 245)',
  },
  dark: {
    colors: {
      base: 'oklch(0.170 0.020 230)',
      ink: 'oklch(0.930 0.010 220)',
      accent: 'oklch(0.720 0.120 210)',
    },
  },
} satisfies import('./theme-types').ThemeDefinition

describe('theme file schema', () => {
  test('accepts a versioned custom theme file', () => {
    const result = validateKilaThemeFile(createKilaThemeFile(validTheme))
    expect(result.valid).toBe(true)
    expect(result.theme?.id).toBe(validTheme.id)
    expect(result.theme?.accentSurfaces).toBe('neutral')
  })

  test('rejects arbitrary CSS-like values and out-of-range OKLCH', () => {
    const result = validateThemeDefinition({
      ...validTheme,
      colors: { ...validTheme.colors, accent: 'url(https://example.com/a.css)' },
    })
    expect(result.valid).toBe(false)
    expect(result.issues.some((issue) => issue.path === 'theme.colors.accent')).toBe(true)

    const outOfRange = validateThemeDefinition({
      ...validTheme,
      colors: { ...validTheme.colors, accent: 'oklch(2 0.8 720)' },
    })
    expect(outOfRange.valid).toBe(false)
  })

  test('rejects unknown fields and unsupported schema versions', () => {
    const result = validateKilaThemeFile({ schemaVersion: 2, theme: validTheme, css: ':root{}' })
    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('unsupported_version')
    expect(result.issues.map((issue) => issue.code)).toContain('unknown_field')
  })

  test('allows partial dark overrides', () => {
    const result = validateThemeDefinition(validTheme)
    expect(result.valid).toBe(true)
    expect(result.theme?.dark?.colors.accent).toBe(validTheme.dark.colors.accent)
  })

  test('custom ids cannot collide with builtin ids', () => {
    expect(isCustomThemeId(validTheme.id)).toBe(true)
    for (const theme of BUILTIN_THEMES) expect(isCustomThemeId(theme.id)).toBe(false)
  })
})
