import { BrowserWindow, dialog, shell } from 'electron'
import type { OpenDialogOptions } from 'electron'
import { DEFAULT_THEME_ID, THEME_IPC_CHANNELS } from '@kila/shared'
import type { ThemeCatalog, ThemeDefinition, ThemeImportResult, ThemeMutationResult } from '@kila/shared'
import { getThemesDir } from '../lib/config-paths'
import { getSettings, repairStoredThemeId, updateSettings } from '../lib/settings-service'
import {
  createCustomTheme,
  deleteCustomTheme,
  getCustomThemeExportFileName,
  importCustomThemeFile,
  listThemeCatalog,
  serializeCustomTheme,
  updateCustomTheme,
  watchThemeCatalog,
} from '../lib/theme-service'
import { writeTextAtomic } from '../lib/safe-json-file'
import { SETTINGS_IPC_CHANNELS } from '../../types'
import { handle } from './shared'

function broadcastCatalog(catalog: ThemeCatalog): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(THEME_IPC_CHANNELS.ON_CHANGED, catalog)
  }
}

function broadcastSettings(): void {
  const settings = getSettings()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(SETTINGS_IPC_CHANNELS.ON_SETTINGS_CHANGED, settings)
  }
}

export function registerThemeHandlers(): void {
  watchThemeCatalog((catalog) => {
    broadcastCatalog(catalog)

    // 仅在当前主题被外部删除或损坏时修复设置，避免普通编辑触发无意义的写盘。
    if (repairStoredThemeId()) broadcastSettings()
  })

  handle(THEME_IPC_CHANNELS.LIST, async (): Promise<ThemeCatalog> => listThemeCatalog())

  handle(THEME_IPC_CHANNELS.CREATE, async (_, theme: ThemeDefinition): Promise<ThemeMutationResult> => {
    const result = createCustomTheme(theme)
    broadcastCatalog(result.catalog)
    return result
  })

  handle(THEME_IPC_CHANNELS.UPDATE, async (_, themeId: string, theme: ThemeDefinition): Promise<ThemeMutationResult> => {
    const result = updateCustomTheme(themeId, theme)
    broadcastCatalog(result.catalog)
    return result
  })

  handle(THEME_IPC_CHANNELS.DELETE, async (_, themeId: string): Promise<ThemeCatalog> => {
    if (getSettings().themeId === themeId) {
      updateSettings({ themeId: DEFAULT_THEME_ID })
      broadcastSettings()
    }
    const catalog = deleteCustomTheme(themeId)
    broadcastCatalog(catalog)
    return catalog
  })

  handle(THEME_IPC_CHANNELS.IMPORT, async (event): Promise<ThemeImportResult> => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    const options: OpenDialogOptions = {
      title: '导入 Kila 主题',
      properties: ['openFile'],
      filters: [{ name: 'Kila 主题', extensions: ['json'] }],
    }
    const selection = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    if (selection.canceled || selection.filePaths.length === 0) return { canceled: true }
    const result = importCustomThemeFile(selection.filePaths[0]!)
    broadcastCatalog(result.catalog)
    return { canceled: false, result }
  })

  handle(THEME_IPC_CHANNELS.EXPORT, async (event, themeId: string): Promise<boolean> => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    const options = {
      title: '导出 Kila 主题',
      defaultPath: getCustomThemeExportFileName(themeId),
      filters: [{ name: 'Kila 主题', extensions: ['json'] }],
    }
    const selection = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options)
    if (selection.canceled || !selection.filePath) return false
    writeTextAtomic(selection.filePath, serializeCustomTheme(themeId))
    return true
  })

  handle(THEME_IPC_CHANNELS.OPEN_DIRECTORY, async (): Promise<void> => {
    const error = await shell.openPath(getThemesDir())
    if (error) throw new Error(`打开主题目录失败: ${error}`)
  })
}
