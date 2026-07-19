import { app, BrowserWindow, shell } from 'electron'
import type { WebContents } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { SETTINGS_IPC_CHANNELS, type OpenSessionInMainWindowInput, type SettingsTab } from '../../types'
import { getSessionMeta } from './session-manager'

let mainWindowRef: BrowserWindow | null = null
let settingsWindowRef: BrowserWindow | null = null
let foregroundSessionId: string | null = null

function getIconPath(): string | undefined {
  const resourcesDir = join(__dirname, 'resources')

  const iconPath = process.platform === 'darwin'
    ? join(resourcesDir, 'icon.icns')
    : process.platform === 'win32'
      ? join(resourcesDir, 'icon.ico')
      : join(resourcesDir, 'icon.png')

  return existsSync(iconPath) ? iconPath : undefined
}

function focusWindow(win: BrowserWindow): void {
  if (win.isMinimized()) {
    win.restore()
  }
  win.show()
  win.focus()
}

function buildSettingsUrl(tab?: SettingsTab): string {
  const query = new URLSearchParams({
    window: 'settings',
  })

  if (tab) {
    query.set('tab', tab)
  }

  return query.toString()
}

function sendSettingsNavigate(tab: SettingsTab): void {
  if (!settingsWindowRef || settingsWindowRef.isDestroyed()) return

  const dispatch = (): void => {
    settingsWindowRef?.webContents.send(SETTINGS_IPC_CHANNELS.NAVIGATE, tab)
  }

  if (settingsWindowRef.webContents.isLoading()) {
    settingsWindowRef.webContents.once('did-finish-load', dispatch)
    return
  }

  dispatch()
}

function sendOpenSessionToMainWindow(input: OpenSessionInMainWindowInput): void {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return

  const dispatch = (): void => {
    mainWindowRef?.webContents.send(SETTINGS_IPC_CHANNELS.ON_OPEN_SESSION_IN_MAIN_WINDOW, input)
  }

  if (mainWindowRef.webContents.isLoading()) {
    mainWindowRef.webContents.once('did-finish-load', dispatch)
  } else {
    dispatch()
  }

  focusWindow(mainWindowRef)
}

function createSettingsWindow(initialTab?: SettingsTab): BrowserWindow {
  const icon = getIconPath()
  const win = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 880,
    minHeight: 620,
    title: '设置',
    icon,
    show: false,
    autoHideMenuBar: process.platform !== 'darwin',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const isDev = !app.isPackaged
  if (isDev) {
    win.loadURL(`http://localhost:5173/?${buildSettingsUrl(initialTab)}`)
  } else {
    win.loadFile(join(__dirname, 'renderer', 'index.html'), {
      query: {
        window: 'settings',
        ...(initialTab ? { tab: initialTab } : {}),
      },
    })
  }

  win.webContents.on('will-navigate', (event, url) => {
    if (isDev && url.startsWith('http://localhost:')) return
    event.preventDefault()
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  win.once('ready-to-show', () => {
    focusWindow(win)
  })

  win.on('closed', () => {
    if (settingsWindowRef === win) {
      settingsWindowRef = null
    }
  })

  return win
}

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win
}

export function getMainWindowWebContents(): WebContents | null {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) {
    return null
  }

  return mainWindowRef.webContents
}

export function openSettingsWindow(tab?: SettingsTab): BrowserWindow {
  if (!settingsWindowRef || settingsWindowRef.isDestroyed()) {
    settingsWindowRef = createSettingsWindow(tab)
    return settingsWindowRef
  }

  focusWindow(settingsWindowRef)

  if (tab) {
    sendSettingsNavigate(tab)
  }

  return settingsWindowRef
}

export function setForegroundSession(sessionId: string | null): void {
  foregroundSessionId = sessionId
}

export function getForegroundSession() {
  if (!foregroundSessionId) return null
  return getSessionMeta(foregroundSessionId) ?? null
}

export function openSessionInMainWindow(input: OpenSessionInMainWindowInput): void {
  sendOpenSessionToMainWindow(input)
}
