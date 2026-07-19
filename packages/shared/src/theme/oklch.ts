import type { OklabColor, OklchColor } from './theme-types'

const OKLCH_PATTERN = /^oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+(-?[0-9.]+)(?:\s*\/\s*[0-9.]+)?\s*\)$/i

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function clampHue(value: number): number {
  const normalized = value % 360
  return normalized < 0 ? normalized + 360 : normalized
}

export function clampColor(color: OklchColor): OklchColor {
  return {
    l: clamp(color.l, 0, 1),
    c: clamp(color.c, 0, 0.4),
    h: clampHue(color.h),
  }
}

export function parseOklch(input: string): OklchColor {
  const match = input.trim().match(OKLCH_PATTERN)
  if (!match) {
    throw new Error(`Invalid OKLCH color: ${input}`)
  }

  return clampColor({
    l: Number(match[1]),
    c: Number(match[2]),
    h: Number(match[3]),
  })
}

export function shiftL(color: OklchColor, delta: number): OklchColor {
  return clampColor({ ...color, l: color.l + delta })
}

export function scaleC(color: OklchColor, factor: number): OklchColor {
  return clampColor({ ...color, c: color.c * factor })
}

export function setL(color: OklchColor, l: number): OklchColor {
  return clampColor({ ...color, l })
}

export function setC(color: OklchColor, c: number): OklchColor {
  return clampColor({ ...color, c })
}

export function oklchToOklab(color: OklchColor): OklabColor {
  const radians = (color.h * Math.PI) / 180
  return {
    l: color.l,
    a: Math.cos(radians) * color.c,
    b: Math.sin(radians) * color.c,
  }
}

export function oklabToOklch(color: OklabColor): OklchColor {
  const c = Math.sqrt(color.a * color.a + color.b * color.b)
  const h = clampHue((Math.atan2(color.b, color.a) * 180) / Math.PI)
  return clampColor({ l: color.l, c, h })
}

export function mix(a: OklchColor, b: OklchColor, ratio: number): OklchColor {
  const t = clamp(ratio, 0, 1)
  const labA = oklchToOklab(a)
  const labB = oklchToOklab(b)
  return oklabToOklch({
    l: labA.l + (labB.l - labA.l) * t,
    a: labA.a + (labB.a - labA.a) * t,
    b: labA.b + (labB.b - labA.b) * t,
  })
}

function linearToSrgb(value: number): number {
  if (value <= 0.0031308) return 12.92 * value
  return 1.055 * Math.pow(value, 1 / 2.4) - 0.055
}

function srgbToLinear(value: number): number {
  if (value <= 0.04045) return value / 12.92
  return Math.pow((value + 0.055) / 1.055, 2.4)
}

export function oklchToRgb(color: OklchColor): { r: number; g: number; b: number } {
  const lab = oklchToOklab(color)

  const l_ = lab.l + 0.3963377774 * lab.a + 0.2158037573 * lab.b
  const m_ = lab.l - 0.1055613458 * lab.a - 0.0638541728 * lab.b
  const s_ = lab.l - 0.0894841775 * lab.a - 1.291485548 * lab.b

  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_

  const rLinear = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const gLinear = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const bLinear = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s

  return {
    r: clamp(linearToSrgb(rLinear), 0, 1),
    g: clamp(linearToSrgb(gLinear), 0, 1),
    b: clamp(linearToSrgb(bLinear), 0, 1),
  }
}

export function getRelativeLuminance(color: OklchColor): number {
  const rgb = oklchToRgb(color)
  const r = srgbToLinear(rgb.r)
  const g = srgbToLinear(rgb.g)
  const b = srgbToLinear(rgb.b)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function getContrastRatio(fg: OklchColor, bg: OklchColor): number {
  const fgLum = getRelativeLuminance(fg)
  const bgLum = getRelativeLuminance(bg)
  const lighter = Math.max(fgLum, bgLum)
  const darker = Math.min(fgLum, bgLum)
  return (lighter + 0.05) / (darker + 0.05)
}

export function toHsl(color: OklchColor): { h: number; s: number; l: number } {
  const { r, g, b } = oklchToRgb(color)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2

  if (max === min) {
    return { h: 0, s: 0, l: lightness }
  }

  const delta = max - min
  const saturation = lightness > 0.5
    ? delta / (2 - max - min)
    : delta / (max + min)

  let hue = 0
  switch (max) {
    case r:
      hue = (g - b) / delta + (g < b ? 6 : 0)
      break
    case g:
      hue = (b - r) / delta + 2
      break
    default:
      hue = (r - g) / delta + 4
      break
  }

  return { h: hue * 60, s: saturation, l: lightness }
}

function formatPercent(value: number): string {
  const percent = Math.round(value * 1000) / 10
  return Number.isInteger(percent) ? `${percent.toFixed(0)}%` : `${percent.toFixed(1)}%`
}

function formatHue(value: number): string {
  const rounded = Math.round(clampHue(value) * 10) / 10
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)}` : `${rounded.toFixed(1)}`
}

export function formatHslTriplet(color: OklchColor): string {
  const hsl = toHsl(color)
  return `${formatHue(hsl.h)} ${formatPercent(hsl.s)} ${formatPercent(hsl.l)}`
}

export function rgbToOklch(rgb: { r: number; g: number; b: number }): OklchColor {
  const r = srgbToLinear(clamp(rgb.r, 0, 1))
  const g = srgbToLinear(clamp(rgb.g, 0, 1))
  const b = srgbToLinear(clamp(rgb.b, 0, 1))

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)

  return oklabToOklch({
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  })
}

export function hexToOklch(input: string): OklchColor {
  const normalized = input.trim().replace(/^#/, '')
  if (!/^[0-9a-f]{6}$/i.test(normalized)) throw new Error(`Invalid HEX color: ${input}`)
  return rgbToOklch({
    r: Number.parseInt(normalized.slice(0, 2), 16) / 255,
    g: Number.parseInt(normalized.slice(2, 4), 16) / 255,
    b: Number.parseInt(normalized.slice(4, 6), 16) / 255,
  })
}

export function oklchToHex(color: OklchColor): string {
  const rgb = oklchToRgb(color)
  const channel = (value: number): string => Math.round(clamp(value, 0, 1) * 255).toString(16).padStart(2, '0')
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`
}

export function formatOklch(color: OklchColor): string {
  const l = Math.round(clamp(color.l, 0, 1) * 1000) / 1000
  const c = Math.round(clamp(color.c, 0, 0.4) * 1000) / 1000
  const h = Math.round(clampHue(color.h) * 10) / 10
  return `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)})`
}
