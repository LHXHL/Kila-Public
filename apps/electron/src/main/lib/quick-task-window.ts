import { app, BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'

const WINDOW_WIDTH = 680
const WINDOW_HEIGHT = 410

let quickTaskWindow: BrowserWindow | null = null
let allowBlurHide = true

function resolveWindowPosition(): { x: number; y: number } {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { x, y, width } = display.workArea
  return {
    x: Math.round(x + (width - WINDOW_WIDTH) / 2),
    y: Math.round(y + 72),
  }
}

function loadQuickTaskRenderer(win: BrowserWindow): void {
  if (!app.isPackaged) {
    void win.loadURL('http://localhost:5173/?window=quick-task')
    return
  }
  void win.loadFile(join(__dirname, 'renderer', 'index.html'), {
    query: { window: 'quick-task' },
  })
}

export function createQuickTaskWindow(): BrowserWindow {
  if (quickTaskWindow && !quickTaskWindow.isDestroyed()) return quickTaskWindow

  const position = resolveWindowPosition()
  const win = new BrowserWindow({
    ...position,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 560,
    minHeight: 320,
    show: false,
    frame: false,
    transparent: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  quickTaskWindow = win
  loadQuickTaskRenderer(win)

  win.on('blur', () => {
    if (allowBlurHide && !win.webContents.isDevToolsOpened()) win.hide()
  })
  win.on('closed', () => {
    if (quickTaskWindow === win) quickTaskWindow = null
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!app.isPackaged && url.startsWith('http://localhost:')) return
    event.preventDefault()
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  return win
}

export function showQuickTaskWindow(): void {
  const win = createQuickTaskWindow()
  const position = resolveWindowPosition()
  win.setPosition(position.x, position.y, false)
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.webContents.send('quick-task:focus')
}

export function hideQuickTaskWindow(): void {
  if (quickTaskWindow && !quickTaskWindow.isDestroyed()) quickTaskWindow.hide()
}

export function toggleQuickTaskWindow(): void {
  if (quickTaskWindow && !quickTaskWindow.isDestroyed() && quickTaskWindow.isVisible()) {
    hideQuickTaskWindow()
    return
  }
  showQuickTaskWindow()
}

/** 文件/目录对话框期间暂时关闭失焦隐藏，避免窗口意外消失。 */
export async function withQuickTaskBlurGuard<T>(action: () => Promise<T>): Promise<T> {
  allowBlurHide = false
  try {
    return await action()
  } finally {
    allowBlurHide = true
  }
}

export function destroyQuickTaskWindow(): void {
  if (!quickTaskWindow || quickTaskWindow.isDestroyed()) return
  quickTaskWindow.destroy()
  quickTaskWindow = null
}
