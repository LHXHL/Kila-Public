/**
 * 设置 IPC 处理器
 *
 * 用户档案、应用设置、主题、窗口管理、环境检测、代理配置
 */

import { nativeTheme, BrowserWindow, Notification as ElectronNotification } from 'electron'
import { IPC_CHANNELS, ENVIRONMENT_IPC_CHANNELS, PROXY_IPC_CHANNELS, INSTALLER_IPC_CHANNELS } from '@kila/shared'
import type { EnvironmentCheckResult, InstallerDownloadRequest, InstallerDownloadResult, InstallerManifest, ProxyConfig, SystemProxyDetectResult, SessionMeta } from '@kila/shared'
import type { UserProfile, AppSettings, DesktopNotificationInput, OpenSessionInMainWindowInput, SettingsTab } from '../../types'
import { USER_PROFILE_IPC_CHANNELS, SETTINGS_IPC_CHANNELS } from '../../types'
import { handle, handleUntyped } from './shared'
import { getUserProfile, updateUserProfile } from '../lib/user-profile-service'
import { getSettings, updateSettings } from '../lib/settings-service'
import { getSystemFonts } from '../lib/font-service'
import { getForegroundSession, openSessionInMainWindow, openSettingsWindow, setForegroundSession } from '../lib/settings-window-manager'
import { getSessionMeta } from '../lib/session-manager'
import { checkEnvironment } from '../lib/environment-checker'
import { getProxySettings, saveProxySettings } from '../lib/proxy-settings-service'
import { getInstallerManifest, findInstallerSource } from '../lib/installer-manifest'
import { downloadInstaller, cancelInstallerDownload, launchInstaller } from '../lib/installer-downloader'
import { reinitializeRuntime } from '../lib/runtime-init'
import { detectSystemProxy } from '../lib/system-proxy-detector'
import {
  assertOptionalString,
  validateDesktopNotificationInput,
  validateOpenSessionInMainWindowInput,
  validateSettingsTab,
} from './validation'


import { createLogger } from '../lib/logger'
const log = createLogger('设置')

function focusAnyWindow(): void {
  const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
  if (!win) return

  if (win.isMinimized()) {
    win.restore()
  }

  win.show()
  win.focus()
}

function focusNotificationTarget(input: DesktopNotificationInput): void {
  if (input.sessionId) {
    const session = getSessionMeta(input.sessionId)
    if (session) {
      openSessionInMainWindow({
        sessionId: session.id,
        title: session.title,
      })
      return
    }
  }

  focusAnyWindow()
}

export function registerSettingsHandlers(): void {
  // ===== 用户档案 =====

  handle(
    USER_PROFILE_IPC_CHANNELS.GET,
    async (): Promise<UserProfile> => {
      return getUserProfile()
    }
  )

  handle(
    USER_PROFILE_IPC_CHANNELS.UPDATE,
    async (_, updates: Partial<UserProfile>): Promise<UserProfile> => {
      const updated = updateUserProfile(updates)

      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send(USER_PROFILE_IPC_CHANNELS.ON_CHANGED, updated)
      })

      return updated
    }
  )

  // ===== 应用设置 =====

  handle(
    SETTINGS_IPC_CHANNELS.GET,
    async (): Promise<AppSettings> => {
      return getSettings()
    }
  )

  handle(
    SETTINGS_IPC_CHANNELS.UPDATE,
    async (_, updates: Partial<AppSettings>): Promise<AppSettings> => {
      const updated = updateSettings(updates)

      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send(SETTINGS_IPC_CHANNELS.ON_SETTINGS_CHANGED, updated)
      })

      return updated
    }
  )

  handleUntyped(
    SETTINGS_IPC_CHANNELS.SHOW_DESKTOP_NOTIFICATION,
    async (_, input: DesktopNotificationInput): Promise<boolean> => {
      try {
        const safeInput = validateDesktopNotificationInput(input)
        if (!ElectronNotification.isSupported()) {
          log.error('[通知] 系统不支持桌面通知')
          return false
        }

        const notification = new ElectronNotification({
          title: safeInput.title,
          body: safeInput.body,
          silent: false,
        })

        notification.on('click', () => {
          focusNotificationTarget(safeInput)
        })

        notification.show()
        return true
      } catch (error) {
        log.error('[通知] 发送桌面通知失败:', error)
        return false
      }
    }
  )

  // 获取系统字体列表
  handle(
    'font:list-system',
    async (): Promise<string[]> => {
      return getSystemFonts()
    }
  )

  // 获取系统主题
  handle(
    SETTINGS_IPC_CHANNELS.GET_SYSTEM_THEME,
    async (): Promise<boolean> => {
      return nativeTheme.shouldUseDarkColors
    }
  )

  // 打开设置窗口（类型不匹配 IpcContract，使用原生 ipcMain.handle）
  handleUntyped(
    SETTINGS_IPC_CHANNELS.OPEN_WINDOW,
    async (_, tab?: SettingsTab): Promise<void> => {
      openSettingsWindow(validateSettingsTab(tab))
    }
  )

  handle(
    SETTINGS_IPC_CHANNELS.GET_FOREGROUND_SESSION,
    async (): Promise<SessionMeta | null> => {
      return getForegroundSession()
    }
  )

  handle(
    SETTINGS_IPC_CHANNELS.SET_FOREGROUND_SESSION,
    async (_, sessionId: string | null): Promise<void> => {
      setForegroundSession(sessionId === null ? null : assertOptionalString(sessionId, 'sessionId', 128) ?? null)
    }
  )

  // 打开 session 到主窗口（类型不匹配 IpcContract，使用原生 ipcMain.handle）
  handleUntyped(
    SETTINGS_IPC_CHANNELS.OPEN_SESSION_IN_MAIN_WINDOW,
    async (_, input: OpenSessionInMainWindowInput): Promise<void> => {
      openSessionInMainWindow(validateOpenSessionInMainWindowInput(input))
    }
  )

  // 监听系统主题变化
  nativeTheme.on('updated', () => {
    const isDark = nativeTheme.shouldUseDarkColors
    log.info(`[设置] 系统主题变化: ${isDark ? '深色' : '浅色'}`)
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send(SETTINGS_IPC_CHANNELS.ON_SYSTEM_THEME_CHANGED, isDark)
    })
  })

  // ===== 环境检测 =====

  handle(
    ENVIRONMENT_IPC_CHANNELS.CHECK,
    async (): Promise<EnvironmentCheckResult> => {
      const result = await checkEnvironment()
      await updateSettings({
        lastEnvironmentCheck: result,
      })
      return result
    }
  )

  // ===== 安装器 =====

  handle(
    INSTALLER_IPC_CHANNELS.FETCH_MANIFEST,
    async (): Promise<InstallerManifest> => {
      return getInstallerManifest()
    }
  )

  handle(
    INSTALLER_IPC_CHANNELS.DOWNLOAD,
    async (event, req: InstallerDownloadRequest): Promise<InstallerDownloadResult> => {
      const manifest = getInstallerManifest()
      const arch = req.arch ?? 'x64'
      const source = findInstallerSource(manifest, req.id, arch)
      if (!source) throw new Error(`安装包未找到: ${req.id} (${arch})`)
      const key = `${req.id}:${arch}`
      const sender = BrowserWindow.fromWebContents(event.sender)
      if (!sender) throw new Error('无法获取发送窗口')
      return downloadInstaller(source, key, sender)
    }
  )

  handle(
    INSTALLER_IPC_CHANNELS.CANCEL,
    async (_, key: string): Promise<boolean> => {
      return cancelInstallerDownload(key)
    }
  )

  handle(
    INSTALLER_IPC_CHANNELS.LAUNCH,
    async (_, filePath: string): Promise<void> => {
      await launchInstaller(filePath)
    }
  )

  handle(
    INSTALLER_IPC_CHANNELS.REINIT_RUNTIME,
    async () => {
      return reinitializeRuntime()
    }
  )

  // ===== 代理配置 =====

  handle(
    PROXY_IPC_CHANNELS.GET_SETTINGS,
    async (): Promise<ProxyConfig> => {
      return getProxySettings()
    }
  )

  handle(
    PROXY_IPC_CHANNELS.UPDATE_SETTINGS,
    async (_, config: ProxyConfig): Promise<void> => {
      await saveProxySettings(config)
    }
  )

  handle(
    PROXY_IPC_CHANNELS.DETECT_SYSTEM,
    async (): Promise<SystemProxyDetectResult> => {
      return detectSystemProxy()
    }
  )
}
