import { BUILTIN_THEMES } from './builtin-themes'
import type { ThemeCoreColors, ThemeDefinition } from './theme-types'

export const KILA_THEME_SCHEMA_VERSION = 1 as const
export const MAX_THEME_FILE_BYTES = 64 * 1024
export const MAX_THEME_ID_LENGTH = 80
export const MAX_THEME_NAME_LENGTH = 80
export const MAX_THEME_DESCRIPTION_LENGTH = 300
export const MAX_THEME_AUTHOR_LENGTH = 80

const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9:_-]{0,79}$/
const CUSTOM_THEME_ID_PATTERN = /^custom:[a-z0-9][a-z0-9_-]{0,72}$/
const STRICT_OKLCH_PATTERN = /^oklch\(\s*(0(?:\.\d+)?|1(?:\.0+)?)\s+(0(?:\.\d+)?|0\.[0-3]\d*|0\.4(?:0+)?)\s+(0(?:\.\d+)?|[1-9]\d?(?:\.\d+)?|[12]\d\d(?:\.\d+)?|3[0-5]\d(?:\.\d+)?|360(?:\.0+)?)\s*\)$/i
const CORE_COLOR_KEYS = ['base', 'ink', 'accent', 'positive', 'caution', 'critical', 'notice'] as const
const BUILTIN_THEME_IDS = new Set(BUILTIN_THEMES.map((theme) => theme.id))

export interface KilaThemeFileV1 {
  schemaVersion: typeof KILA_THEME_SCHEMA_VERSION
  theme: ThemeDefinition
}

export type ThemeSource = 'builtin' | 'custom'

export interface ThemeRecord {
  source: ThemeSource
  readonly: boolean
  theme: ThemeDefinition
  updatedAt?: number
}

export interface ThemeValidationIssue {
  path: string
  code: string
  message: string
}

export interface ThemeValidationResult {
  valid: boolean
  issues: ThemeValidationIssue[]
  theme?: ThemeDefinition
}

export interface ThemeLoadIssue {
  fileName: string
  message: string
}

export interface ThemeCatalog {
  themes: ThemeRecord[]
  issues: ThemeLoadIssue[]
}

export interface ThemeMutationResult {
  theme: ThemeRecord
  catalog: ThemeCatalog
}

export interface ThemeImportResult {
  canceled: boolean
  result?: ThemeMutationResult
}

export const THEME_IPC_CHANNELS = {
  LIST: 'theme:list',
  CREATE: 'theme:create',
  UPDATE: 'theme:update',
  DELETE: 'theme:delete',
  IMPORT: 'theme:import',
  EXPORT: 'theme:export',
  OPEN_DIRECTORY: 'theme:open-directory',
  ON_CHANGED: 'theme:changed',
} as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function addUnknownKeyIssues(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
  issues: ThemeValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      issues.push({ path: `${path}.${key}`, code: 'unknown_field', message: `不支持字段 ${key}` })
    }
  }
}

function readBoundedString(
  value: unknown,
  path: string,
  maxLength: number,
  issues: ThemeValidationIssue[],
  options: { optional?: boolean } = {},
): string | undefined {
  if (value === undefined && options.optional) return undefined
  if (typeof value !== 'string') {
    issues.push({ path, code: 'invalid_type', message: '必须是字符串' })
    return undefined
  }
  const normalized = value.trim()
  if (!normalized) {
    issues.push({ path, code: 'empty_string', message: '不能为空' })
    return undefined
  }
  if (normalized.length > maxLength) {
    issues.push({ path, code: 'too_long', message: `长度不能超过 ${maxLength} 个字符` })
    return undefined
  }
  return normalized
}

function readColor(
  value: unknown,
  path: string,
  issues: ThemeValidationIssue[],
  optional = false,
): string | undefined {
  if (value === undefined && optional) return undefined
  if (typeof value !== 'string' || !STRICT_OKLCH_PATTERN.test(value.trim())) {
    issues.push({
      path,
      code: 'invalid_oklch',
      message: '必须是 oklch(L C H)，其中 L 为 0–1、C 为 0–0.4、H 为 0–360',
    })
    return undefined
  }
  return value.trim().toLowerCase()
}

function readColors(
  value: unknown,
  path: string,
  issues: ThemeValidationIssue[],
  partial: boolean,
): Partial<ThemeCoreColors> | undefined {
  if (!isPlainObject(value)) {
    issues.push({ path, code: 'invalid_type', message: '必须是颜色对象' })
    return undefined
  }
  addUnknownKeyIssues(value, CORE_COLOR_KEYS, path, issues)
  const colors: Partial<ThemeCoreColors> = {}
  for (const key of CORE_COLOR_KEYS) {
    const color = readColor(value[key], `${path}.${key}`, issues, partial)
    if (color !== undefined) colors[key] = color
  }
  return colors
}

export function isThemeId(value: unknown): value is string {
  return typeof value === 'string' && THEME_ID_PATTERN.test(value)
}

export function isCustomThemeId(value: unknown): value is string {
  return typeof value === 'string' && CUSTOM_THEME_ID_PATTERN.test(value)
}

export function isBuiltinThemeId(value: unknown): value is string {
  return typeof value === 'string' && BUILTIN_THEME_IDS.has(value)
}

export function validateThemeDefinition(input: unknown): ThemeValidationResult {
  const issues: ThemeValidationIssue[] = []
  if (!isPlainObject(input)) {
    return { valid: false, issues: [{ path: 'theme', code: 'invalid_type', message: '主题必须是对象' }] }
  }

  addUnknownKeyIssues(input, ['id', 'name', 'description', 'author', 'accentSurfaces', 'colors', 'dark'], 'theme', issues)
  const id = readBoundedString(input.id, 'theme.id', MAX_THEME_ID_LENGTH, issues)
  if (id && !isThemeId(id)) {
    issues.push({ path: 'theme.id', code: 'invalid_id', message: 'ID 只能包含小写字母、数字、冒号、下划线和连字符' })
  }
  const name = readBoundedString(input.name, 'theme.name', MAX_THEME_NAME_LENGTH, issues)
  const description = readBoundedString(input.description, 'theme.description', MAX_THEME_DESCRIPTION_LENGTH, issues)
  const author = readBoundedString(input.author, 'theme.author', MAX_THEME_AUTHOR_LENGTH, issues, { optional: true })
  const accentSurfaces = input.accentSurfaces
  if (accentSurfaces !== undefined && accentSurfaces !== 'tinted' && accentSurfaces !== 'neutral') {
    issues.push({ path: 'theme.accentSurfaces', code: 'invalid_value', message: '只能是 tinted 或 neutral' })
  }
  const colors = readColors(input.colors, 'theme.colors', issues, false)

  let dark: ThemeDefinition['dark']
  if (input.dark !== undefined) {
    if (!isPlainObject(input.dark)) {
      issues.push({ path: 'theme.dark', code: 'invalid_type', message: '必须是对象' })
    } else {
      addUnknownKeyIssues(input.dark, ['colors'], 'theme.dark', issues)
      const darkColors = readColors(input.dark.colors, 'theme.dark.colors', issues, true)
      if (darkColors) dark = { colors: darkColors }
    }
  }

  if (issues.length > 0 || !id || !name || !description || !colors) {
    return { valid: false, issues }
  }

  return {
    valid: true,
    issues: [],
    theme: {
      id,
      name,
      description,
      ...(author ? { author } : {}),
      ...(accentSurfaces === 'tinted' || accentSurfaces === 'neutral' ? { accentSurfaces } : {}),
      colors: colors as ThemeCoreColors,
      ...(dark ? { dark } : {}),
    },
  }
}

export function validateKilaThemeFile(input: unknown): ThemeValidationResult {
  if (!isPlainObject(input)) {
    return { valid: false, issues: [{ path: '$', code: 'invalid_type', message: '主题文件必须是 JSON 对象' }] }
  }
  const issues: ThemeValidationIssue[] = []
  addUnknownKeyIssues(input, ['schemaVersion', 'theme'], '$', issues)
  if (input.schemaVersion !== KILA_THEME_SCHEMA_VERSION) {
    issues.push({ path: 'schemaVersion', code: 'unsupported_version', message: '仅支持 schemaVersion 1' })
  }
  const themeResult = validateThemeDefinition(input.theme)
  issues.push(...themeResult.issues)
  return {
    valid: issues.length === 0,
    issues,
    ...(issues.length === 0 && themeResult.theme ? { theme: themeResult.theme } : {}),
  }
}

export function createKilaThemeFile(theme: ThemeDefinition): KilaThemeFileV1 {
  return { schemaVersion: KILA_THEME_SCHEMA_VERSION, theme }
}

export function formatThemeValidationIssues(issues: ThemeValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n')
}
