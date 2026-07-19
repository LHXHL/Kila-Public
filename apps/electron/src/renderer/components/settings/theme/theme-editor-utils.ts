import { formatOklch, hexToOklch, oklchToHex, parseOklch } from '@kila/shared'
import type { ThemeDefinition } from '@kila/shared'

export const THEME_COLOR_FIELDS = [
  ['base', '背景基色'],
  ['ink', '正文颜色'],
  ['accent', '品牌强调'],
  ['positive', '成功状态'],
  ['caution', '警告状态'],
  ['critical', '危险状态'],
  ['notice', '信息状态'],
] as const

export function createCustomThemeId(name: string, existingIds: ReadonlySet<string>): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56) || 'theme'
  let candidate = `custom:${base}`
  let suffix = 2
  while (existingIds.has(candidate)) {
    candidate = `custom:${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

export function cloneAsCustomTheme(
  source: ThemeDefinition,
  name: string,
  existingIds: ReadonlySet<string>,
): ThemeDefinition {
  return {
    ...source,
    id: createCustomThemeId(name, existingIds),
    name,
    description: source.description,
    colors: { ...source.colors },
    ...(source.dark ? { dark: { colors: { ...source.dark.colors } } } : {}),
  }
}

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i

/** 将主题内部颜色转换为编辑器使用的 #RRGGBB。 */
export function themeColorValueToHex(value: string): string {
  if (!value) return ''
  if (HEX_COLOR_PATTERN.test(value.trim())) return value.trim().toUpperCase()
  try {
    return oklchToHex(parseOklch(value)).toUpperCase()
  } catch {
    // 保留未完成的输入，让表单校验负责提示，而不是吞掉用户正在输入的内容。
    return value.toUpperCase()
  }
}

/** 将合法的 #RRGGBB 转为内部 OKLCH；非法或未完成输入返回 null。 */
export function hexColorInputToOklch(value: string): string | null {
  const normalized = value.trim()
  if (!HEX_COLOR_PATTERN.test(normalized)) return null
  return formatOklch(hexToOklch(normalized))
}

/** HEX 输入统一使用大写；完整的六位裸值会自动补上 #。 */
export function normalizeHexColorInput(value: string): string {
  const normalized = value.trim().toUpperCase()
  return /^[0-9A-F]{6}$/.test(normalized) ? `#${normalized}` : normalized
}

/** 系统颜色选择器固定返回 #RRGGBB，直接转换为内部 OKLCH。 */
export function colorPickerValueToOklch(hex: string): string {
  return hexColorInputToOklch(hex) ?? ''
}
