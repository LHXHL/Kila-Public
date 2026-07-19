/**
 * i18n 初始化配置
 *
 * 使用 i18next + react-i18next 管理多语言。
 * 语言文件按命名空间拆分，默认使用 common 命名空间。
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zhCN from '../locales/zh-CN.json'
import en from '../locales/en.json'
import { DEFAULT_LOCALE } from '../../types'

const LOCALE_CACHE_KEY = 'kila-locale'

/** 获取缓存的语言（同步，用于初始化） */
export function getCachedLocale(): string {
  try {
    return localStorage.getItem(LOCALE_CACHE_KEY) ?? DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      'zh-CN': { translation: zhCN },
      'en': { translation: en },
    },
    lng: getCachedLocale(),
    fallbackLng: 'zh-CN',
    interpolation: {
      escapeValue: false,
    },
  })

export default i18n
