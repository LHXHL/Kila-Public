import { describe, expect, test } from 'bun:test'
import { BUILTIN_THEMES } from './builtin-themes'
import { deriveThemeColorMap } from './theme-derive'
import { THEME_VAR_NAMES } from './theme-types'
import { isContrastPassing } from './theme-validate'

describe('theme derive contract', () => {
  for (const theme of BUILTIN_THEMES) {
    for (const mode of ['light', 'dark'] as const) {
      test(`${theme.id} ${mode} derives the full token contract`, () => {
        const colors = deriveThemeColorMap(theme, mode)

        expect(Object.keys(colors).sort()).toEqual([...THEME_VAR_NAMES].sort())

        for (const name of THEME_VAR_NAMES) {
          expect(colors[name]).toBeDefined()
        }
      })

      test(`${theme.id} ${mode} keeps core contrast guards passing`, () => {
        const colors = deriveThemeColorMap(theme, mode)

        expect(isContrastPassing(colors['--foreground'], colors['--background'], 4.5)).toBe(true)
        expect(isContrastPassing(colors['--muted-foreground'], colors['--background'], 3.0)).toBe(true)
        expect(isContrastPassing(colors['--card-foreground'], colors['--card'], 4.5)).toBe(true)
        expect(isContrastPassing(colors['--popover-foreground'], colors['--popover'], 4.5)).toBe(true)
        expect(isContrastPassing(colors['--primary-foreground'], colors['--primary'], 4.5)).toBe(true)
        expect(isContrastPassing(colors['--brand-soft-foreground'], colors['--brand-soft'], 4.5)).toBe(true)
        expect(isContrastPassing(colors['--status-danger-foreground'], colors['--status-danger-soft'], 4.5)).toBe(true)
        expect(isContrastPassing(colors['--kila-user-bubble-foreground'], colors['--kila-user-bubble'], 4.5)).toBe(true)
      })
    }
  }
})
