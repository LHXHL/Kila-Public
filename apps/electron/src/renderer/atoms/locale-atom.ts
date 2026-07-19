/**
 * Locale Atom - 应用语言状态
 *
 * 管理当前界面语言，切换时同步到 i18next 并持久化。
 */

import { atom } from 'jotai'
import i18n from '../lib/i18n'
import { DEFAULT_LOCALE } from '../../types'
import type { AppLocale } from '../../types'

const LOCALE_CACHE_KEY = 'kila-locale'

/** 当前语言 */
export const localeAtom = atom<AppLocale>(DEFAULT_LOCALE)

/** 切换语言并持久化 */
export async function changeLocale(
  locale: AppLocale,
  setLocale: (locale: AppLocale) => void,
): Promise<void> {
  setLocale(locale)
  await i18n.changeLanguage(locale)
  try {
    localStorage.setItem(LOCALE_CACHE_KEY, locale)
  } catch {
    // localStorage 不可用时忽略
  }
  await window.electronAPI.updateSettings({ locale })
}

/** 从设置加载语言 */
export async function loadLocaleFromSettings(
  setLocale: (locale: AppLocale) => void,
): Promise<void> {
  try {
    const settings = await window.electronAPI.getSettings()
    const locale = (settings.locale as AppLocale | undefined) ?? DEFAULT_LOCALE
    setLocale(locale)
    await i18n.changeLanguage(locale)
  } catch (error) {
    console.error('[LocaleAtom] 加载语言设置失败:', error)
  }
}
