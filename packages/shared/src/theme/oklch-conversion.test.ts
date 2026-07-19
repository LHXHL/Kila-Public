import { describe, expect, test } from 'bun:test'
import { formatOklch, hexToOklch, oklchToHex, parseOklch } from './oklch'

describe('theme color conversion', () => {
  test('converts common HEX colors into valid OKLCH strings', () => {
    expect(formatOklch(hexToOklch('#ffffff'))).toBe('oklch(1.000 0.000 89.9)')
    expect(formatOklch(hexToOklch('#000000'))).toBe('oklch(0.000 0.000 0.0)')
  })

  test('keeps OKLCH to HEX conversion stable enough for a color picker', () => {
    const source = parseOklch('oklch(0.57 0.13 210)')
    const hex = oklchToHex(source)
    expect(hex).toMatch(/^#[0-9a-f]{6}$/)
    const roundTrip = hexToOklch(hex)
    expect(Math.abs(roundTrip.l - source.l)).toBeLessThan(0.02)
  })
})
