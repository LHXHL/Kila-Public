import { existsSync, lstatSync, readFileSync, readdirSync, statSync, unlinkSync, watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { basename, join } from 'node:path'
import {
  BUILTIN_THEMES,
  DEFAULT_THEME_ID,
  MAX_THEME_FILE_BYTES,
  createKilaThemeFile,
  formatThemeValidationIssues,
  getBuiltinTheme,
  isBuiltinThemeId,
  isCustomThemeId,
  validateKilaThemeFile,
  validateThemeDefinition,
} from '@kila/shared'
import type {
  ThemeCatalog,
  ThemeDefinition,
  ThemeLoadIssue,
  ThemeMutationResult,
  ThemeRecord,
} from '@kila/shared'
import { getThemesDir } from './config-paths'
import { createLogger } from './logger'
import { writeTextAtomic } from './safe-json-file'

const log = createLogger('主题')
const THEME_FILE_SUFFIX = '.kila-theme.json'

function customThemeFileName(themeId: string): string {
  if (!isCustomThemeId(themeId)) throw new Error('自定义主题 ID 必须使用 custom: 前缀')
  return `${themeId.slice('custom:'.length)}${THEME_FILE_SUFFIX}`
}

function customThemePath(themeId: string): string {
  return join(getThemesDir(), customThemeFileName(themeId))
}

function assertCustomTheme(theme: ThemeDefinition): ThemeDefinition {
  const result = validateThemeDefinition(theme)
  if (!result.valid || !result.theme) {
    throw new Error(`主题校验失败：\n${formatThemeValidationIssues(result.issues)}`)
  }
  if (!isCustomThemeId(result.theme.id)) {
    throw new Error('自定义主题 ID 必须使用 custom: 前缀，并且只能包含小写字母、数字、下划线和连字符')
  }
  if (isBuiltinThemeId(result.theme.id)) throw new Error('不能覆盖内置主题')
  return result.theme
}

function readThemeFile(filePath: string): ThemeDefinition {
  const fileStat = statSync(filePath)
  if (fileStat.size > MAX_THEME_FILE_BYTES) throw new Error(`主题文件不能超过 ${MAX_THEME_FILE_BYTES / 1024} KB`)
  const raw = readFileSync(filePath, 'utf-8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('主题文件不是有效的 JSON')
  }
  const result = validateKilaThemeFile(parsed)
  if (!result.valid || !result.theme) {
    throw new Error(formatThemeValidationIssues(result.issues))
  }
  return assertCustomTheme(result.theme)
}

function toBuiltinRecord(theme: ThemeDefinition): ThemeRecord {
  return { source: 'builtin', readonly: true, theme }
}

function toCustomRecord(theme: ThemeDefinition, updatedAt?: number): ThemeRecord {
  return { source: 'custom', readonly: false, theme, ...(updatedAt ? { updatedAt } : {}) }
}

export function listThemeCatalog(): ThemeCatalog {
  const customThemes: ThemeRecord[] = []
  const issues: ThemeLoadIssue[] = []
  const dir = getThemesDir()

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.name.endsWith(THEME_FILE_SUFFIX)) continue
    const filePath = join(dir, entry.name)
    try {
      if (!entry.isFile() || lstatSync(filePath).isSymbolicLink()) {
        throw new Error('主题条目必须是普通文件')
      }
      const theme = readThemeFile(filePath)
      const expectedFileName = customThemeFileName(theme.id)
      if (entry.name !== expectedFileName) {
        throw new Error(`文件名应为 ${expectedFileName}`)
      }
      customThemes.push(toCustomRecord(theme, statSync(filePath).mtimeMs))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      issues.push({ fileName: basename(filePath), message })
      log.error(`[主题] 跳过无效主题 ${entry.name}:`, error)
    }
  }

  customThemes.sort((a, b) => a.theme.name.localeCompare(b.theme.name, 'zh-CN'))
  return {
    themes: [...BUILTIN_THEMES.map(toBuiltinRecord), ...customThemes],
    issues,
  }
}

export function resolveTheme(themeId?: string | null): ThemeDefinition {
  if (themeId && isBuiltinThemeId(themeId)) return getBuiltinTheme(themeId)
  if (themeId && isCustomThemeId(themeId)) {
    const filePath = customThemePath(themeId)
    if (existsSync(filePath)) {
      try {
        return readThemeFile(filePath)
      } catch (error) {
        log.error(`[主题] 解析当前主题失败，回退默认主题: ${themeId}`, error)
      }
    }
  }
  return getBuiltinTheme(DEFAULT_THEME_ID)
}

function saveCustomTheme(theme: ThemeDefinition): ThemeRecord {
  const filePath = customThemePath(theme.id)
  writeTextAtomic(filePath, `${JSON.stringify(createKilaThemeFile(theme), null, 2)}\n`)
  return toCustomRecord(theme, statSync(filePath).mtimeMs)
}

export function createCustomTheme(input: ThemeDefinition): ThemeMutationResult {
  const theme = assertCustomTheme(input)
  const filePath = customThemePath(theme.id)
  if (existsSync(filePath)) throw new Error(`主题已存在: ${theme.id}`)
  const record = saveCustomTheme(theme)
  return { theme: record, catalog: listThemeCatalog() }
}

export function updateCustomTheme(themeId: string, input: ThemeDefinition): ThemeMutationResult {
  if (!isCustomThemeId(themeId)) throw new Error('只能修改自定义主题')
  const currentPath = customThemePath(themeId)
  if (!existsSync(currentPath)) throw new Error(`主题不存在: ${themeId}`)
  const theme = assertCustomTheme(input)
  if (theme.id !== themeId) throw new Error('更新主题时不能修改主题 ID')
  const record = saveCustomTheme(theme)
  return { theme: record, catalog: listThemeCatalog() }
}

export function deleteCustomTheme(themeId: string): ThemeCatalog {
  if (!isCustomThemeId(themeId)) throw new Error('只能删除自定义主题')
  const filePath = customThemePath(themeId)
  if (!existsSync(filePath)) throw new Error(`主题不存在: ${themeId}`)
  unlinkSync(filePath)
  return listThemeCatalog()
}

export function importCustomThemeFile(filePath: string): ThemeMutationResult {
  const theme = readThemeFile(filePath)
  const targetPath = customThemePath(theme.id)
  if (existsSync(targetPath)) throw new Error(`主题已存在: ${theme.id}`)
  const record = saveCustomTheme(theme)
  return { theme: record, catalog: listThemeCatalog() }
}

export function serializeCustomTheme(themeId: string): string {
  if (!isCustomThemeId(themeId)) throw new Error('只能导出自定义主题')
  const filePath = customThemePath(themeId)
  if (!existsSync(filePath)) throw new Error(`主题不存在: ${themeId}`)
  const theme = readThemeFile(filePath)
  return `${JSON.stringify(createKilaThemeFile(theme), null, 2)}\n`
}

export function getCustomThemeExportFileName(themeId: string): string {
  return customThemeFileName(themeId)
}


let themeWatcher: FSWatcher | null = null
let themeWatchTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 监听用户直接修改 ~/.kila/themes 的变化。
 * 同一进程只建立一个 watcher，并通过去抖避免编辑器的临时写入产生事件风暴。
 */
export function watchThemeCatalog(onChanged: (catalog: ThemeCatalog) => void): () => void {
  if (themeWatcher) return () => {}
  themeWatcher = watch(getThemesDir(), { persistent: false }, () => {
    if (themeWatchTimer) clearTimeout(themeWatchTimer)
    themeWatchTimer = setTimeout(() => {
      themeWatchTimer = null
      onChanged(listThemeCatalog())
    }, 150)
  })
  themeWatcher.on('error', (error) => log.error('[主题] 目录监听失败:', error))

  return () => {
    if (themeWatchTimer) clearTimeout(themeWatchTimer)
    themeWatchTimer = null
    themeWatcher?.close()
    themeWatcher = null
  }
}
