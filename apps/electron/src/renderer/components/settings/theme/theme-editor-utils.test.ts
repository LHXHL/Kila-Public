import { describe, expect, test } from 'bun:test'
import { getBuiltinTheme } from '@kila/shared'
import {
  cloneAsCustomTheme,
  colorPickerValueToOklch,
  createCustomThemeId,
  hexColorInputToOklch,
  normalizeHexColorInput,
  themeColorValueToHex,
} from './theme-editor-utils'

describe('theme editor behavior', () => {
  test('creates a namespaced unique id for user themes', () => {
    const ids = new Set(['custom:theme', 'custom:theme-2'])
    expect(createCustomThemeId('Theme', ids)).toBe('custom:theme-3')
    expect(createCustomThemeId('中文主题', new Set())).toBe('custom:theme')
  })

  test('copies builtin theme data without mutating the source', () => {
    const builtin = getBuiltinTheme('graphite')
    const copy = cloneAsCustomTheme(builtin, '柔石墨副本', new Set())
    expect(copy.id).toStartWith('custom:')
    expect(copy.colors).not.toBe(builtin.colors)
    copy.colors.base = 'oklch(0.500 0.100 100)'
    expect(builtin.colors.base).not.toBe(copy.colors.base)
  })

  test('converts the native color picker value to strict OKLCH', () => {
    expect(colorPickerValueToOklch('#336699')).toMatch(/^oklch\(0\.\d{3} 0\.\d{3} \d+\.\d\)$/)
  })

  test('presents internal OKLCH colors as uppercase HEX values', () => {
    const internal = colorPickerValueToOklch('#CC7D5E')
    expect(themeColorValueToHex(internal)).toBe('#CC7D5E')
  })

  test('accepts complete HEX input and preserves incomplete input for validation', () => {
    expect(normalizeHexColorInput('cc7d5e')).toBe('#CC7D5E')
    expect(hexColorInputToOklch('#CC7D5E')).toMatch(/^oklch\(/)
    expect(hexColorInputToOklch('#CC7')).toBeNull()
    expect(themeColorValueToHex('#cc7')).toBe('#CC7')
  })
})
