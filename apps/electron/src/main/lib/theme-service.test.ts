import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ThemeDefinition } from '@kila/shared'
import { DEFAULT_THEME_ID, createKilaThemeFile } from '@kila/shared'
import {
  createCustomTheme,
  deleteCustomTheme,
  importCustomThemeFile,
  listThemeCatalog,
  resolveTheme,
  serializeCustomTheme,
  updateCustomTheme,
} from './theme-service'
import { getSettings, repairStoredThemeId, updateSettings } from './settings-service'

let configDir = ''

const theme: ThemeDefinition = {
  id: 'custom:test-ocean',
  name: '测试海洋',
  description: '用于主题仓库测试',
  colors: {
    base: 'oklch(0.97 0.01 220)',
    ink: 'oklch(0.21 0.02 235)',
    accent: 'oklch(0.57 0.13 210)',
    positive: 'oklch(0.58 0.12 150)',
    caution: 'oklch(0.72 0.14 75)',
    critical: 'oklch(0.58 0.18 25)',
    notice: 'oklch(0.59 0.12 245)',
  },
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'kila-theme-test-'))
  process.env.KILA_CONFIG_DIR = configDir
})

afterEach(() => {
  delete process.env.KILA_CONFIG_DIR
  rmSync(configDir, { recursive: true, force: true })
})

describe('theme service', () => {
  test('creates, resolves, updates, exports and deletes custom themes', () => {
    const created = createCustomTheme(theme)
    expect(created.theme.theme.id).toBe(theme.id)
    expect(resolveTheme(theme.id).name).toBe(theme.name)

    const updated = updateCustomTheme(theme.id, { ...theme, name: '更新后的海洋' })
    expect(updated.theme.theme.name).toBe('更新后的海洋')
    expect(JSON.parse(serializeCustomTheme(theme.id)).schemaVersion).toBe(1)

    const catalog = deleteCustomTheme(theme.id)
    expect(catalog.themes.some((item) => item.theme.id === theme.id)).toBe(false)
    expect(resolveTheme(theme.id).id).toBe('porcelain')
  })

  test('imports a versioned theme and rejects duplicate ids', () => {
    const sourcePath = join(configDir, 'source.kila-theme.json')
    writeFileSync(sourcePath, JSON.stringify(createKilaThemeFile(theme)), 'utf-8')
    expect(importCustomThemeFile(sourcePath).theme.theme.id).toBe(theme.id)
    expect(() => importCustomThemeFile(sourcePath)).toThrow('主题已存在')
  })

  test('isolates invalid files instead of breaking the catalog', () => {
    createCustomTheme(theme)
    const badPath = join(configDir, 'themes', 'broken.kila-theme.json')
    writeFileSync(badPath, '{broken', 'utf-8')
    const catalog = listThemeCatalog()
    expect(catalog.themes.some((item) => item.theme.id === theme.id)).toBe(true)
    expect(catalog.issues).toEqual([{ fileName: 'broken.kila-theme.json', message: '主题文件不是有效的 JSON' }])
  })

  test('persists a versioned file without arbitrary CSS', () => {
    createCustomTheme(theme)
    const raw = readFileSync(join(configDir, 'themes', 'test-ocean.kila-theme.json'), 'utf-8')
    expect(raw).toContain('"schemaVersion": 1')
    expect(raw).not.toContain('<style>')
  })

  test('keeps an existing custom theme in settings and normalizes a missing theme', () => {
    createCustomTheme(theme)

    updateSettings({ themeId: theme.id })
    expect(getSettings().themeId).toBe(theme.id)

    deleteCustomTheme(theme.id)
    expect(getSettings().themeId).toBe(DEFAULT_THEME_ID)

    const stale = JSON.parse(readFileSync(join(configDir, 'settings.json'), 'utf-8')) as { themeId: string }
    expect(stale.themeId).toBe(theme.id)

    expect(repairStoredThemeId()?.themeId).toBe(DEFAULT_THEME_ID)
    const persisted = JSON.parse(readFileSync(join(configDir, 'settings.json'), 'utf-8')) as { themeId: string }
    expect(persisted.themeId).toBe(DEFAULT_THEME_ID)
    expect(repairStoredThemeId()).toBeNull()
  })
})
