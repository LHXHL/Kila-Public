import { app, BrowserWindow, Menu, screen, shell, systemPreferences, dialog, session } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'

// 注册 external 依赖的解析路径（打包后从 extraResources/ext-modules/node_modules/ 按需加载）
// extraResources 不走 ASAR，直接放在 Resources/ 目录下，require() 可正常解析
const extModulesDir = app.isPackaged
  ? join(process.resourcesPath, 'ext-modules', 'node_modules')
  : join(__dirname, 'ext-modules', 'node_modules')
if (existsSync(extModulesDir)) {
  module.paths.unshift(extModulesDir)
}

// 清理本地环境中的 ANTHROPIC_* 变量，防止干扰应用的认证流程
// Electron 桌面应用通过渠道系统管理 API Key，不应受终端环境变量影响
// 注意：此操作必须在 initializeRuntime()（loadShellEnv）之前执行
for (const key of Object.keys(process.env)) {
  if (key.startsWith('ANTHROPIC_')) {
    delete process.env[key]
  }
}

import { createApplicationMenu } from './menu'
import { registerIpcHandlers } from './ipc/index'
import { createTray, destroyTray } from './tray'
import { initializeRuntime } from './lib/runtime-init'
import { setMainWindow } from './lib/settings-window-manager'
import { loadWindowState, saveWindowState } from './lib/window-state'
import { bootstrapUnifiedSessions } from './lib/session-manager'
import { stopAllAgents } from './lib/agent-service'
import { initAutoUpdater, cleanupUpdater } from './lib/updater/auto-updater'
import { startWorkspaceWatcher, stopWorkspaceWatcher } from './lib/workspace-watcher'
import { startAgentToolsWatcher, stopAgentToolsWatcher } from './lib/agent-tools-watcher'
import { getIsQuitting, setQuitting } from './lib/app-lifecycle'
import { bridgeManager } from './lib/im-bridge/bridge-manager'
import { runSessionProjectAcceptance } from './lib/session-project-acceptance'
import { scheduledTaskManager } from './lib/scheduled-task-singleton'
import { startCliBridgeServer, stopCliBridgeServer } from './lib/cli-bridge/server'
import { ensureBundledCliInstalled } from './lib/cli-installer'
import { memoryProviderManager } from './lib/memory/provider-manager'
import { mcpServerManager } from './lib/mcp-server-manager'
import { syncBuiltinSkillsToGlobalAgent } from './lib/global-agent-config-manager'
import { registerGlobalShortcuts, unregisterGlobalShortcuts } from './lib/global-shortcut-service'
import { createQuickTaskWindow, destroyQuickTaskWindow, toggleQuickTaskWindow } from './lib/quick-task-window'
import { warmSessionSearchIndex } from './lib/session-search-index'
import { openSessionInMainWindow, openSettingsWindow } from './lib/settings-window-manager'
import { getSessionMeta } from './lib/session-manager'
import { createChannel } from './lib/channel-manager'
import { inferApiTypeFromProvider, type ChannelCreateInput } from '@kila/shared'
import { stopFeishuMirrorSleepBlocker, syncFeishuMirrorSleepBlocker } from './lib/im-bridge/feishu-sleep-blocker'
import { SETTINGS_TABS, type SettingsTab } from '../types'
import { parseKilaDeepLink, type ProviderInstallDeepLink } from './lib/deep-link-policy'
import {
  hardenWebPreviewPreferences,
  isAllowedWebPreviewAttachment,
  isAllowedWebPreviewUrl,
  WEB_PREVIEW_PARTITION,
} from './lib/web-preview-security'

let mainWindow: BrowserWindow | null = null
const pendingDeepLinks: string[] = []

function registerDeepLinkProtocol(): void {
  if (app.isDefaultProtocolClient('kila')) return
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('kila', process.execPath, [process.argv[1]!])
    return
  }
  app.setAsDefaultProtocolClient('kila')
}

function handleDeepLink(rawUrl: string): void {
  const deepLink = parseKilaDeepLink(rawUrl)
  if (!deepLink) return

  if (deepLink.kind === 'session') {
    const sessionMeta = getSessionMeta(deepLink.sessionId)
    if (!sessionMeta) return
    showAndFocusMainWindow()
    openSessionInMainWindow({
      sessionId: sessionMeta.id,
      title: sessionMeta.title,
    })
    return
  }

  if (deepLink.kind === 'settings') {
    const requestedTab = deepLink.requestedTab as SettingsTab
    const tab = SETTINGS_TABS.includes(requestedTab) ? requestedTab : 'general'
    openSettingsWindow(tab)
    return
  }

  void handleProviderInstallDeepLink(deepLink)
}

/**
 * 处理 kila://provider/install 一键导入。
 * 所有字段已经过 deep-link-policy 的协议、长度与标识符约束。
 */
async function handleProviderInstallDeepLink(inputLink: ProviderInstallDeepLink): Promise<void> {
  const models = inputLink.models.map((id) => ({ id, name: id, enabled: true }))
  const apiKeyHint = inputLink.apiKey
    ? `\nAPI Key: ${inputLink.apiKey.slice(0, 6)}···（已自动填入）`
    : '\nAPI Key: 留空（导入后手动填写）'

  const result = await dialog.showMessageBox({
    type: 'question',
    title: '导入供应商',
    message: '即将导入供应商配置',
    detail: [
      `名称：${inputLink.name}`,
      `Provider ID：${inputLink.provider}`,
      inputLink.apiType ? `协议：${inputLink.apiType}` : '协议：按 provider 自动反推',
      inputLink.baseUrl ? `Base URL：${inputLink.baseUrl}` : 'Base URL：未提供',
      models.length > 0 ? `模型：${models.length} 个` : '模型：未指定',
      apiKeyHint,
      '',
      '确认后会写入 ~/.kila/channels.json 并打开供应商设置页。',
    ].join('\n'),
    buttons: ['取消', '确认导入'],
    defaultId: 1,
    cancelId: 0,
  })

  if (result.response !== 1) return

  const input: ChannelCreateInput = {
    name: inputLink.name,
    provider: inputLink.provider,
    apiType: inputLink.apiType ?? inferApiTypeFromProvider(inputLink.provider),
    capabilityProviderId: inputLink.provider,
    baseUrl: inputLink.baseUrl || 'https://api.example.com',
    apiKey: inputLink.apiKey,
    models,
    enabled: true,
  }

  try {
    createChannel(input)
    showAndFocusMainWindow()
    openSettingsWindow('channels')
  } catch (error) {
    // 不记录原始 deep link，避免 API Key 泄露到日志。
    console.error('[DeepLink] provider/install 创建失败:', error)
    dialog.showErrorBox('导入失败', error instanceof Error ? error.message : String(error))
  }
}

function drainPendingDeepLinks(): void {
  while (pendingDeepLinks.length > 0) {
    const url = pendingDeepLinks.shift()
    if (url) handleDeepLink(url)
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const url = argv.find((item) => item.startsWith('kila://'))
    if (url) handleDeepLink(url)
    else showAndFocusMainWindow()
  })
}

app.on('open-url', (event, url) => {
  event.preventDefault()
  if (app.isReady()) handleDeepLink(url)
  else pendingDeepLinks.push(url)
})

/**
 * 检查窗口是否在可用显示器范围内
 * 处理外接显示器断开后窗口位于不可见区域的情况
 */
function ensureWindowOnScreen(win: BrowserWindow): void {
  const bounds = win.getBounds()
  const displays = screen.getAllDisplays()
  // 检查窗口中心点是否在任一显示器范围内
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  const isOnScreen = displays.some((display) => {
    const { x, y, width, height } = display.workArea
    return centerX >= x && centerX <= x + width && centerY >= y && centerY <= y + height
  })
  if (!isOnScreen) {
    // 窗口不在任何屏幕内，移动到主显示器居中位置
    const primary = screen.getPrimaryDisplay()
    const { x, y, width, height } = primary.workArea
    win.setBounds({
      x: x + Math.round((width - bounds.width) / 2),
      y: y + Math.round((height - bounds.height) / 2),
      width: bounds.width,
      height: bounds.height,
    })
    console.log('[窗口] 窗口已重新定位到主显示器')
  }
}

/** 显示并聚焦主窗口，确保窗口在可见区域；若窗口已销毁则重新创建 */
function showAndFocusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  ensureWindowOnScreen(mainWindow)
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()
}

/**
 * Get the appropriate app icon path for the current platform
 */
function getIconPath(): string {
  // resources 在 build:resources 阶段被复制到 dist/ 下，与 main.cjs 同级
  const resourcesDir = join(__dirname, 'resources')

  if (process.platform === 'darwin') {
    return join(resourcesDir, 'icon.icns')
  } else if (process.platform === 'win32') {
    return join(resourcesDir, 'icon.ico')
  } else {
    return join(resourcesDir, 'icon.png')
  }
}

function configureWebPreviewSecurity(): void {
  const previewSession = session.fromPartition(WEB_PREVIEW_PARTITION)
  previewSession.setPermissionCheckHandler(() => false)
  previewSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  previewSession.on('will-download', (event) => event.preventDefault())

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      if (!isAllowedWebPreviewAttachment(params.partition, params.src)) {
        event.preventDefault()
        return
      }
      hardenWebPreviewPreferences(webPreferences)
    })

    if (contents.getType() !== 'webview') return

    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, url) => {
      if (!isAllowedWebPreviewUrl(url)) event.preventDefault()
    })
    contents.on('will-redirect', (event, url) => {
      if (!isAllowedWebPreviewUrl(url)) event.preventDefault()
    })
  })
}

function createWindow(): void {
  const iconPath = getIconPath()
  const iconExists = existsSync(iconPath)

  if (!iconExists) {
    console.warn('App icon not found at:', iconPath)
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    icon: iconExists ? iconPath : undefined,
    show: false, // Don't show until ready
    fullscreenable: false, // macOS: 绿色按钮 zoom 而非全屏
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: false, // Native-feel: 禁用拼写检查红线
      backgroundThrottling: false, // Native-feel: 防止隐藏窗口 rAF 节流
    },
    titleBarStyle: 'hiddenInset', // macOS style
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined, // macOS glass effect
    visualEffectState: process.platform === 'darwin' ? 'active' : undefined,
    // Windows 11 Mica 材质
    ...(process.platform === 'win32' ? { backgroundMaterial: 'mica' as const } : {}),
  })
  setMainWindow(mainWindow)

  // Load the renderer
  const isDev = !app.isPackaged
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, 'renderer', 'index.html'))
  }

  // 恢复窗口状态（大小/位置/最大化）
  const savedState = loadWindowState()
  if (savedState.isMaximized) {
    mainWindow.maximize()
  } else {
    mainWindow.setBounds({
      x: savedState.x,
      y: savedState.y,
      width: savedState.width,
      height: savedState.height,
    })
  }

  // 窗口就绪后显示（延迟 50ms 让 WebKit 完成首帧渲染，避免 macOS 白色闪烁）
  mainWindow.once('ready-to-show', () => {
    setTimeout(() => {
      mainWindow?.show()
    }, 50)
  })

  // 持久化窗口状态（节流写入）
  let windowStateTimer: ReturnType<typeof setTimeout> | null = null
  const persistWindowState = (): void => {
    if (windowStateTimer) clearTimeout(windowStateTimer)
    windowStateTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      const isMaximized = mainWindow.isMaximized()
      const bounds = isMaximized ? loadWindowState() : mainWindow.getBounds()
      saveWindowState({ ...bounds, isMaximized })
    }, 500)
  }
  mainWindow.on('resize', persistWindowState)
  mainWindow.on('move', persistWindowState)
  mainWindow.on('maximize', persistWindowState)
  mainWindow.on('unmaximize', persistWindowState)

  // Native-feel: 拦截右键菜单，阻止 WebKit 默认菜单
  mainWindow.webContents.on('context-menu', (event) => {
    event.preventDefault()
  })

  // Native-feel: 注入系统强调色 CSS 变量（用于 Switch/Checkbox 等交互元素）
  mainWindow.webContents.once('did-finish-load', () => {
    try {
      if (process.platform === 'darwin') {
        const accent = systemPreferences.getAccentColor()
        if (accent) {
          const r = parseInt(accent.slice(0, 2), 16)
          const g = parseInt(accent.slice(2, 4), 16)
          const b = parseInt(accent.slice(4, 6), 16)
          mainWindow?.webContents.insertCSS(
            `:root { --system-accent-r: ${r}; --system-accent-g: ${g}; --system-accent-b: ${b}; --system-accent: rgb(${r}, ${g}, ${b}); }`
          )
        }
      }
    } catch (error) {
      console.warn('[Native-feel] 获取系统强调色失败:', error)
    }
  })

  // 拦截页面内导航，外部链接用系统浏览器打开，防止 Electron 窗口被覆盖
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // 允许开发模式下的 Vite HMR 热重载
    if (isDev && url.startsWith('http://localhost:')) return
    event.preventDefault()
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
  })

  // 拦截 window.open / target="_blank" 链接
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // Native-feel: 渲染进程崩溃时记录日志并自动恢复
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Kila] 渲染进程异常退出:', details.reason, details.exitCode)
    // 如果窗口还在，尝试重新加载
    if (mainWindow && !mainWindow.isDestroyed()) {
      setTimeout(() => {
        if (isDev) {
          mainWindow?.loadURL('http://localhost:5173')
        } else {
          mainWindow?.loadFile(join(__dirname, 'renderer', 'index.html'))
        }
      }, 500)
    }
  })

  // macOS: 点击关闭按钮时隐藏窗口+应用，而不是退出
  // 同时隐藏应用（类似 Cmd+H），确保点击 Dock 图标时 macOS 能正确触发 activate 事件
  if (process.platform === 'darwin') {
    mainWindow.on('close', (event) => {
      if (!getIsQuitting()) {
        event.preventDefault()
        mainWindow?.hide()
        app.hide()
      }
    })
  }

  mainWindow.on('closed', () => {
    setMainWindow(null)
    mainWindow = null
  })

  // 自动授予通知权限，确保桌面通知正常工作
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      if (permission === 'notifications') {
        callback(true)
      } else {
        callback(false)
      }
    }
  )
}

app.whenReady().then(async () => {
  registerDeepLinkProtocol()
  configureWebPreviewSecurity()

  // 初始化运行时环境（Shell 环境 + Bun + Git 检测）
  // 必须在其他初始化之前执行，确保环境变量正确加载
  await initializeRuntime()

  ensureBundledCliInstalled().catch((error) => {
    console.error('[CLI Installer] 安装 kila wrapper 失败:', error)
  })

  // 同步内置 / Alma Skills 到全局 Agent Skills 真相源
  syncBuiltinSkillsToGlobalAgent()

  // 单一 Session 首启清理：旧 chat / agent 存储直接丢弃
  bootstrapUnifiedSessions()
  // 初始化全局 MCP 服务器长连接
  mcpServerManager.initialize().catch((error) => {
    console.error('[MCP] 初始化失败，将在首次使用时重试:', error)
  })
  try {
    await memoryProviderManager.initialize()
  } catch (error) {
    console.error('[Memory] 初始化失败，将在首次使用时重试:', error)
  }

  if (process.env.KILA_RUN_ACCEPTANCE === 'session-project') {
    try {
      const report = await runSessionProjectAcceptance()
      console.log(JSON.stringify({ ok: true, report }, null, 2))
      app.exit(0)
      return
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack : undefined
      console.error(JSON.stringify({ ok: false, error: message, stack }, null, 2))
      app.exit(1)
      return
    }
  }

  // Create application menu
  const menu = createApplicationMenu()
  Menu.setApplicationMenu(menu)

  // Register IPC handlers
  registerIpcHandlers()
  const searchWarmupTimer = setTimeout(() => {
    warmSessionSearchIndex()
  }, 3_000)
  if (typeof searchWarmupTimer.unref === 'function') {
    searchWarmupTimer.unref()
  }

  startCliBridgeServer().catch((error) => {
    console.error('[CLI Bridge] 启动失败:', error)
  })

  // Set dock icon on macOS (required for dev mode, bundled apps use Info.plist)
  if (process.platform === 'darwin' && app.dock) {
    const dockIconPath = join(__dirname, 'resources/icon.png')
    if (existsSync(dockIconPath)) {
      app.dock.setIcon(dockIconPath)
    }
  }

  // Create system tray icon
  createTray()

  // Create main window (will be shown when ready)
  createWindow()
  // 预创建快速任务窗口，保证快捷键呼出低延迟。
  createQuickTaskWindow()
  drainPendingDeepLinks()
  const launchDeepLink = process.argv.find((item) => item.startsWith('kila://'))
  if (launchDeepLink) handleDeepLink(launchDeepLink)
  registerGlobalShortcuts({
    showMainWindow: showAndFocusMainWindow,
    toggleQuickTask: toggleQuickTaskWindow,
  })

  // 启动文件监听（全局 Agent 配置变化 + session project 文件自动刷新）
  if (mainWindow) {
    startWorkspaceWatcher(mainWindow)
  }

  // 启动 Agent 工具配置文件监听（Agent 创建工具后自动通知渲染进程）
  startAgentToolsWatcher()

  // 生产环境下初始化自动更新
  if (app.isPackaged && mainWindow) {
    initAutoUpdater(mainWindow)
  }


  const bridgeConfig = bridgeManager.getConfig()
  syncFeishuMirrorSleepBlocker()
  if (bridgeConfig.enabled && bridgeConfig.autoStart) {
    bridgeManager.start().catch((err) => {
      console.error('[IM Bridge] 自动启动失败:', err)
    })
  }

  scheduledTaskManager.start().catch((error) => {
    console.error('[ScheduledTask] 启动失败:', error)
  })

  app.on('activate', () => {
    // 直接检查 mainWindow 引用，避免 getAllWindows() 包含 DevTools 等其他窗口导致误判
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
    } else {
      // 窗口已存在但可能被隐藏（macOS 关闭按钮 = hide），重新显示
      showAndFocusMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // 非 macOS：关闭所有窗口时退出应用
  // macOS：保持应用运行（可通过 tray 或 Dock 重新打开）
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  // 标记正在退出，让 close 事件不再阻止关闭
  setQuitting()

  // 中止所有活跃的 Agent 子进程
  stopAllAgents()
  scheduledTaskManager.shutdown()
  // 清理更新器定时器
  cleanupUpdater()
  // 停止工作区文件监听
  stopWorkspaceWatcher()
  // 停止 Agent 工具配置文件监听
  stopAgentToolsWatcher()
  // 停止 IM Bridge
  bridgeManager.stop()
  stopFeishuMirrorSleepBlocker()
  // 停止 CLI Bridge
  void stopCliBridgeServer()
  void memoryProviderManager.dispose()
  void mcpServerManager.shutdown()
  unregisterGlobalShortcuts()
  destroyQuickTaskWindow()
  // Clean up system tray before quitting
  destroyTray()
})
