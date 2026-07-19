/**
 * 主题状态原子
 *
 * 管理应用主题模式（浅色/深色/跟随系统）与配色主题。
 * - themeModeAtom: 用户选择的主题模式，持久化到 ~/.kila/settings.json
 * - themeIdAtom: 用户选择的配色主题 ID
 * - systemIsDarkAtom: 系统当前是否为深色模式
 * - resolvedThemeAtom: 派生的最终主题（light | dark）
 *
 * 使用 localStorage 缓存主题模式、主题 ID 和上一帧 CSS 文本，避免页面加载时闪烁。
 */

import { atom } from 'jotai'
import { DEFAULT_THEME_ID, buildThemeStyleText, deriveThemeVars, getBuiltinTheme } from '@kila/shared'
import type { ThemeMode } from '../../types'
import { DEFAULT_FONT_SIZE } from './font-atoms'

/** localStorage 缓存键 */
const THEME_CACHE_KEY = 'kila-theme-mode'
const THEME_ID_CACHE_KEY = 'kila-theme-id'
const THEME_BOOTSTRAP_STYLE_KEY = 'kila-theme-bootstrap-css'

/**
 * 从 localStorage 读取缓存的主题模式
 */
function getCachedThemeMode(): ThemeMode {
  try {
    const cached = localStorage.getItem(THEME_CACHE_KEY)
    if (cached === 'light' || cached === 'dark' || cached === 'system') {
      return cached
    }
  } catch {
    // localStorage 不可用时忽略
  }
  return 'light'
}

function getCachedThemeId(): string {
  try {
    return getBuiltinTheme(localStorage.getItem(THEME_ID_CACHE_KEY)).id
  } catch {
    return DEFAULT_THEME_ID
  }
}

/**
 * 缓存主题模式到 localStorage
 */
function cacheThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_CACHE_KEY, mode)
  } catch {
    // localStorage 不可用时忽略
  }
}

function cacheThemeId(themeId: string): void {
  try {
    localStorage.setItem(THEME_ID_CACHE_KEY, themeId)
  } catch {
    // localStorage 不可用时忽略
  }
}

function cacheThemeBootstrapStyle(styleText: string): void {
  try {
    localStorage.setItem(THEME_BOOTSTRAP_STYLE_KEY, styleText)
  } catch {
    // localStorage 不可用时忽略
  }
}

/** 用户选择的主题模式 */
export const themeModeAtom = atom<ThemeMode>(getCachedThemeMode())

/** 用户选择的配色主题 */
export const themeIdAtom = atom<string>(getCachedThemeId())

/** 系统当前是否为深色模式 */
export const systemIsDarkAtom = atom<boolean>(true)

/** 派生：最终解析的主题（light | dark） */
export const resolvedThemeAtom = atom<'light' | 'dark'>((get) => {
  const mode = get(themeModeAtom)
  if (mode === 'system') {
    return get(systemIsDarkAtom) ? 'dark' : 'light'
  }
  return mode
})

/** 当前选中的主题定义 */
export const themeDefinitionAtom = atom((get) => getBuiltinTheme(get(themeIdAtom)))

/** 当前主题导出的 CSS 变量 */
export const themeCSSVarsAtom = atom((get) => {
  return deriveThemeVars(get(themeDefinitionAtom), get(resolvedThemeAtom))
})

/** 当前主题样式文本 */
export const themeStyleTextAtom = atom((get) => buildThemeStyleText(get(themeCSSVarsAtom)))

/**
 * 应用主题到 DOM
 *
 * 在 <html> 元素上切换 dark 类名，同步 Tailwind CSS 暗色模式。
 */
export function applyThemeToDOM(resolvedTheme: 'light' | 'dark'): void {
  document.documentElement.classList.toggle('dark', resolvedTheme === 'dark')
}

export function applyThemeVarsToDOM(styleText: string): void {
  const id = 'kila-theme'
  let styleEl = document.getElementById(id) as HTMLStyleElement | null

  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = id
    document.head.appendChild(styleEl)
  }

  // 确保主题样式节点始终位于 <head> 末尾，避免被后续注入的开发态样式覆盖。
  if (styleEl.parentElement === document.head && document.head.lastElementChild !== styleEl) {
    document.head.appendChild(styleEl)
  }

  if (styleEl.textContent === styleText) return

  styleEl.textContent = styleText
  cacheThemeBootstrapStyle(styleText)
}

/**
 * 初始化主题系统
 *
 * 从主进程加载设置，监听系统主题与设置变化。
 * 返回清理函数。
 */
export async function initializeTheme(
  setThemeMode: (mode: ThemeMode) => void,
  setThemeId: (themeId: string) => void,
  setSystemIsDark: (isDark: boolean) => void,
  setFontFamily?: (family: string) => void,
  setFontSize?: (size: number) => void,
): Promise<() => void> {
  // 从主进程加载持久化设置
  const settings = await window.electronAPI.getSettings()
  setThemeMode(settings.themeMode)
  setThemeId(settings.themeId)
  cacheThemeMode(settings.themeMode)
  cacheThemeId(settings.themeId)
  setFontFamily?.(settings.fontFamily ?? '')
  setFontSize?.(settings.fontSize ?? DEFAULT_FONT_SIZE)

  // 获取系统主题
  const isDark = await window.electronAPI.getSystemTheme()
  setSystemIsDark(isDark)

  const cleanupSettings = window.electronAPI.onSettingsChanged((settings) => {
    setThemeMode(settings.themeMode)
    setThemeId(settings.themeId)
    cacheThemeMode(settings.themeMode)
    cacheThemeId(settings.themeId)
    setFontFamily?.(settings.fontFamily ?? '')
    setFontSize?.(settings.fontSize ?? DEFAULT_FONT_SIZE)
  })

  // 监听系统主题变化
  const cleanupSystemTheme = window.electronAPI.onSystemThemeChanged((newIsDark) => {
    setSystemIsDark(newIsDark)
  })

  return () => {
    cleanupSettings()
    cleanupSystemTheme()
  }
}

/**
 * 更新主题模式并持久化
 *
 * 同时更新 localStorage 缓存和主进程配置文件。
 */
export async function updateThemeMode(mode: ThemeMode): Promise<void> {
  cacheThemeMode(mode)
  await window.electronAPI.updateSettings({ themeMode: mode })
}

export async function updateThemeId(themeId: string): Promise<void> {
  const resolved = getBuiltinTheme(themeId).id
  cacheThemeId(resolved)
  await window.electronAPI.updateSettings({ themeId: resolved })
}
