import { Tray, Menu, app, nativeImage, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'


import { createLogger } from './lib/logger'
const log = createLogger('系统托盘')

let tray: Tray | null = null

/**
 * 获取托盘图标路径
 * 使用彩色 logo（文件名不含 Template 避免 macOS 自动单色化）
 */
function getTrayIconPath(): string {
  const resourcesDir = join(__dirname, 'resources/kila-logos')
  return join(resourcesDir, 'iconTray.png')
}

/** 显示主窗口 */
function showMainWindow(): void {
  const windows = BrowserWindow.getAllWindows()
  if (windows.length === 0) return
  const mainWindow = windows[0]!
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()
}

/**
 * 创建系统托盘图标和菜单
 */
export function createTray(): Tray | null {
  const iconPath = getTrayIconPath()

  if (!existsSync(iconPath)) {
    log.warn('Tray icon not found at:', iconPath)
    return null
  }

  try {
    const image = nativeImage.createFromPath(iconPath)

    // macOS: 使用彩色图标（非 Template），直接展示 logo 原色
    // 不再调用 setTemplateImage(true)

    tray = new Tray(image)

    // 设置 tooltip
    tray.setToolTip('Kila')

    // 创建右键菜单
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示 Kila',
        click: () => showMainWindow()
      },
      {
        type: 'separator'
      },
      {
        label: '退出 Kila',
        click: () => {
          app.quit()
        }
      }
    ])

    tray.setContextMenu(contextMenu)

    // 点击行为：始终弹出菜单（与右键一致）
    tray.on('click', () => {
      tray?.popUpContextMenu()
    })

    log.info('System tray created')
    return tray
  } catch (error) {
    log.error('Failed to create system tray:', error)
    return null
  }
}

/**
 * 销毁系统托盘
 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}

/**
 * 获取当前托盘实例
 */
export function getTray(): Tray | null {
  return tray
}
