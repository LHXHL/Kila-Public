/**
 * 渲染进程入口
 *
 * 挂载 React 应用，初始化主题系统。
 */

import React, { useEffect, useRef } from 'react'
import ReactDOM from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import { useAtom, useSetAtom, useAtomValue, useStore } from 'jotai'
import App from './App'
import {
  themeModeAtom,
  themeIdAtom,
  systemIsDarkAtom,
  resolvedThemeAtom,
  themeStyleTextAtom,
  themeCatalogAtom,
  applyThemeToDOM,
  applyThemeVarsToDOM,
  initializeTheme,
} from './atoms/theme'
import {
  fontFamilyAtom,
  fontSizeAtom,
  applyFontToDOM,
} from './atoms/font-atoms'
import {
  agentChannelIdAtom,
  agentModelIdAtom,
  agentPendingPromptAtom,
  workspaceCapabilitiesVersionAtom,
  workspaceFilesVersionAtom,
  agentThinkingLevelAtom,
  agentMaxBudgetUsdAtom,
  agentMaxTurnsAtom,
} from './atoms/agent-atoms'
import { updateStatusAtom, initializeUpdater } from './atoms/updater'
import {
  notificationsEnabledAtom,
  notificationPreferencesAtom,
  initializeNotifications,
} from './atoms/notifications'
import { userProfileAtom } from './atoms/user-profile'
import { localeAtom, loadLocaleFromSettings } from './atoms/locale-atom'
import './lib/i18n'
import { useGlobalSessionListeners } from './hooks/useGlobalSessionListeners'
import { agentToolsAtom } from './atoms/agent-tool-atoms'
import { sessionQuickSuggestionsAtom } from './atoms/agent-ui-atoms'
import { currentSessionAtom, currentSessionIdAtom, sessionsAtom } from './atoms/session-atoms'
import { tabsAtom, splitLayoutAtom, openTab } from './atoms/tab-atoms'
import { Toaster } from './components/ui/sonner'
import { toast } from 'sonner'
import { diffCapabilities, resolveThinkingLevel } from '@kila/shared'
import type { WorkspaceCapabilities } from '@kila/shared'
import { showCapabilityChangeToasts } from './lib/capabilities-toast'
const UpdateDialog = React.lazy(() => import('./components/settings/UpdateDialog').then(m => ({ default: m.UpdateDialog })))
import type { OpenSessionInMainWindowInput } from '../types'
import './styles/globals.css'
import 'katex/dist/katex.min.css'

/**
 * 主题初始化组件
 *
 * 负责从主进程加载主题设置、监听系统主题变化、
 * 并将最终主题同步到 DOM。
 */
function ThemeInitializer(): null {
  const setThemeMode = useSetAtom(themeModeAtom)
  const setThemeId = useSetAtom(themeIdAtom)
  const setSystemIsDark = useSetAtom(systemIsDarkAtom)
  const setThemeCatalog = useSetAtom(themeCatalogAtom)
  const resolvedTheme = useAtomValue(resolvedThemeAtom)
  const themeStyleText = useAtomValue(themeStyleTextAtom)
  const setFontFamily = useSetAtom(fontFamilyAtom)
  const setFontSize = useSetAtom(fontSizeAtom)
  const fontFamily = useAtomValue(fontFamilyAtom)
  const fontSize = useAtomValue(fontSizeAtom)

  // 初始化：从主进程加载设置 + 订阅系统主题变化
  useEffect(() => {
    let isMounted = true
    let cleanup: (() => void) | undefined

    initializeTheme(setThemeMode, setThemeId, setSystemIsDark, setThemeCatalog, setFontFamily, setFontSize).then((fn) => {
      if (isMounted) {
        cleanup = fn
      } else {
        // 组件已卸载（StrictMode 场景），立即清理监听器
        fn()
      }
    })

    return () => {
      isMounted = false
      cleanup?.()
    }
  }, [setThemeMode, setThemeId, setSystemIsDark, setThemeCatalog, setFontFamily, setFontSize])

  // 响应式应用主题到 DOM
  useEffect(() => {
    applyThemeToDOM(resolvedTheme)
  }, [resolvedTheme])

  useEffect(() => {
    applyThemeVarsToDOM(themeStyleText)
  }, [themeStyleText])

  // 响应式应用字体到 DOM
  useEffect(() => {
    applyFontToDOM(fontFamily, fontSize)
  }, [fontFamily, fontSize])

  return null
}

/**
 * Agent 设置初始化组件
 *
 * 从主进程加载 Agent 渠道/模型设置并写入 atoms。
 */
function AgentSettingsInitializer(): null {
  const setAgentChannelId = useSetAtom(agentChannelIdAtom)
  const setAgentModelId = useSetAtom(agentModelIdAtom)
  const bumpCapabilities = useSetAtom(workspaceCapabilitiesVersionAtom)
  const bumpFiles = useSetAtom(workspaceFilesVersionAtom)
  const setThinkingLevel = useSetAtom(agentThinkingLevelAtom)
  const setMaxBudget = useSetAtom(agentMaxBudgetUsdAtom)
  const setMaxTurns = useSetAtom(agentMaxTurnsAtom)

  // 读取当前会话信息（用于能力变化 diff）
  const currentSession = useAtomValue(currentSessionAtom)

  // 缓存上一次会话项目能力（用于 diff 检测变化）
  const prevCapabilitiesRef = useRef<WorkspaceCapabilities | null>(null)
  // 初次加载标记 — 应用启动或切换会话项目时不显示 toast
  const suppressToastRef = useRef(true)

  useEffect(() => {
    // 加载设置
    window.electronAPI.getSettings().then((settings) => {
      if (settings.agentChannelId) {
        setAgentChannelId(settings.agentChannelId)
      }
      if (settings.agentModelId) {
        setAgentModelId(settings.agentModelId)
      }
      setThinkingLevel(resolveThinkingLevel({
        thinkingLevel: settings.agentThinkingLevel,
        thinking: settings.agentThinking,
        effort: settings.agentEffort,
      }))
      if (settings.agentMaxBudgetUsd != null) {
        setMaxBudget(settings.agentMaxBudgetUsd)
      }
      if (settings.agentMaxTurns != null) {
        setMaxTurns(settings.agentMaxTurns)
      }
    }).catch(console.error)
  }, [setAgentChannelId, setAgentModelId, setThinkingLevel, setMaxBudget, setMaxTurns])

  // 启动时重置全局能力缓存，预加载基线
  useEffect(() => {
    suppressToastRef.current = true
    prevCapabilitiesRef.current = null

    window.electronAPI
      .getGlobalAgentCapabilities()
      .then((caps) => {
        prevCapabilitiesRef.current = caps
        suppressToastRef.current = false
      })
      .catch(console.error)
  }, [])

  // 订阅主进程文件监听推送
  useEffect(() => {
    const unsubCapabilities = window.electronAPI.onCapabilitiesChanged(() => {
      window.electronAPI
        .getGlobalAgentCapabilities()
        .then((newCaps) => {
          const prevCaps = prevCapabilitiesRef.current
          if (prevCaps && !suppressToastRef.current) {
            const changes = diffCapabilities(prevCaps, newCaps)
            showCapabilityChangeToasts(changes)
          }
          prevCapabilitiesRef.current = newCaps
          suppressToastRef.current = false
        })
        .catch(console.error)

      bumpCapabilities((v) => v + 1)
    })
    const unsubFiles = window.electronAPI.onWorkspaceFilesChanged(() => {
      bumpFiles((v) => v + 1)
    })

    return () => {
      unsubCapabilities()
      unsubFiles()
    }
  }, [bumpCapabilities, bumpFiles])

  return null
}

/**
 * 自动更新初始化组件
 *
 * 订阅主进程推送的更新状态变化事件。
 */
function UpdaterInitializer(): null {
  const setUpdateStatus = useSetAtom(updateStatusAtom)

  useEffect(() => {
    const cleanup = initializeUpdater((status) => {
      setUpdateStatus(status)
    })
    return cleanup
  }, [setUpdateStatus])

  return null
}

/**
 * 通知初始化组件
 *
 * 从主进程加载桌面通知开关与分类偏好设置。
 */
function NotificationsInitializer(): null {
  const setEnabled = useSetAtom(notificationsEnabledAtom)
  const setPrefs = useSetAtom(notificationPreferencesAtom)

  useEffect(() => {
    let isMounted = true
    let cleanup: (() => void) | undefined

    initializeNotifications(setEnabled, setPrefs).then((fn) => {
      if (isMounted) {
        cleanup = fn
      } else {
        fn()
      }
    })

    return () => {
      isMounted = false
      cleanup?.()
    }
  }, [setEnabled, setPrefs])

  return null
}

/**
 * 用户档案初始化组件（含跨窗口同步）
 */
function UserProfileInitializer(): null {
  const setUserProfile = useSetAtom(userProfileAtom)

  useEffect(() => {
    window.electronAPI.getUserProfile()
      .then(setUserProfile)
      .catch((error) => console.error('[UserProfileInitializer] 加载失败:', error))

    const cleanup = window.electronAPI.onUserProfileChanged((profile) => {
      setUserProfile(profile)
    })
    return cleanup
  }, [setUserProfile])

  return null
}

/**
 * 语言初始化组件
 */
function LocaleInitializer(): null {
  const setLocale = useSetAtom(localeAtom)

  useEffect(() => {
    loadLocaleFromSettings(setLocale)
  }, [setLocale])

  return null
}

function SessionListenersInitializer(): null {
  useGlobalSessionListeners()
  return null
}

function MainWindowBridgeInitializer(): null {
  const store = useStore()
  const currentSessionId = useAtomValue(currentSessionIdAtom)

  useEffect(() => {
    void window.electronAPI.setForegroundSession(currentSessionId)

    return () => {
      void window.electronAPI.setForegroundSession(null)
    }
  }, [currentSessionId])

  useEffect(() => {
    return window.electronAPI.onOpenSessionInMainWindow(async (input: OpenSessionInMainWindowInput) => {
      const sessions = await window.electronAPI.listSessions()
      const session = sessions.find((item) => item.id === input.sessionId)

      store.set(sessionsAtom, sessions)

      const tabs = store.get(tabsAtom)
      const layout = store.get(splitLayoutAtom)
      const result = openTab(tabs, layout, {
        type: 'agent',
        sessionId: input.sessionId,
        title: session?.title ?? input.title,
      })

      store.set(tabsAtom, result.tabs)
      store.set(splitLayoutAtom, result.layout)
      store.set(currentSessionIdAtom, input.sessionId)

      if (input.pendingPrompt) {
        store.set(agentPendingPromptAtom, {
          sessionId: input.sessionId,
          message: input.pendingPrompt,
        })
      }
    })
  }, [store])

  return null
}

/**
 * Agent 工具初始化组件
 *
 * 启动时从主进程加载所有工具信息到 atom。
 * 订阅 agent-tools.json 文件变更通知，自动刷新工具列表。
 */
function AgentToolInitializer(): null {
  const { t } = useTranslation()
  const setAgentTools = useSetAtom(agentToolsAtom)

  useEffect(() => {
    window.electronAPI.getAgentTools()
      .then(setAgentTools)
      .catch((err: unknown) => console.error('[AgentToolInitializer] 加载工具列表失败:', err))
  }, [setAgentTools])

  // 订阅自定义工具配置变更
  useEffect(() => {
    const cleanup = window.electronAPI.onCustomToolChanged(() => {
      window.electronAPI.getAgentTools()
        .then((tools) => {
          setAgentTools(tools)
          toast.success(t('shell.agentToolsUpdated'))
        })
        .catch((err: unknown) => console.error('[AgentToolInitializer] 刷新工具列表失败:', err))
    })
    return cleanup
  }, [setAgentTools, t])

  return null
}

/**
 * 启动时后台生成会话快捷建议
 *
 * 应用启动时基于最近会话记忆静默调用 LLM 生成建议，
 * 用户打开新会话时即可直接显示，无需等待。
 */
function SuggestionInitializer(): null {
  const setSuggestions = useSetAtom(sessionQuickSuggestionsAtom)

  useEffect(() => {
    window.electronAPI.generateSuggestions()
      .then((result) => {
        if (result.suggestions.length > 0) {
          setSuggestions(result.suggestions)
        }
      })
      .catch(() => {})
  }, [setSuggestions])

  return null
}

const windowMode = window.electronAPI.getWindowMode()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeInitializer />
    {windowMode !== 'quick-task' && <AgentSettingsInitializer />}
    {windowMode !== 'quick-task' && <NotificationsInitializer />}
    <UserProfileInitializer />
    <LocaleInitializer />
    {windowMode !== 'quick-task' && <AgentToolInitializer />}
    {windowMode !== 'quick-task' && <SuggestionInitializer />}
    {windowMode !== 'quick-task' && <UpdaterInitializer />}
    {windowMode === 'main' && (
      <>
        <SessionListenersInitializer />
        <MainWindowBridgeInitializer />
      </>
    )}
    <App />
    {windowMode === 'main' && (
      <React.Suspense fallback={null}>
        <UpdateDialog />
      </React.Suspense>
    )}
    {windowMode !== 'quick-task' && <Toaster position="top-right" />}
  </React.StrictMode>
)
