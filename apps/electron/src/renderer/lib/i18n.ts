/**
 * i18n 初始化配置
 *
 * 使用 i18next + react-i18next 管理中英双语。
 *
 * 语言文件按**领域**拆分到 `locales/{lang}/{domain}.json`，每个文件内部仍以领域名
 * 作为顶层键，初始化时合并成单一 translation 资源。因此组件里的调用形式不变，
 * 依旧是扁平点号路径（`t('settings.general.basicInfo')`），只是源文件不再是
 * 一个巨型 JSON —— 多人/多任务并行补翻译时不会互相冲突。
 *
 * 新增领域时：在 zh-CN 与 en 下各加一个同名文件，并在下方 import 列表登记。
 * 两种语言的 key 必须完全一致，由 `scripts/check-i18n.ts` 在 CI 中校验。
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { DEFAULT_LOCALE } from '../../types'

import zhAgent from '../locales/zh-CN/agent.json'
import zhCommon from '../locales/zh-CN/common.json'
import zhComposer from '../locales/zh-CN/composer.json'
import zhFileBrowser from '../locales/zh-CN/fileBrowser.json'
import zhSession from '../locales/zh-CN/session.json'
import zhSettings from '../locales/zh-CN/settings.json'
import zhSettingsBridge from '../locales/zh-CN/settingsBridge.json'
import zhSettingsTasks from '../locales/zh-CN/settingsTasks.json'
import zhShell from '../locales/zh-CN/shell.json'
import zhSidebar from '../locales/zh-CN/sidebar.json'
import zhTabs from '../locales/zh-CN/tabs.json'
import zhTools from '../locales/zh-CN/tools.json'

import enAgent from '../locales/en/agent.json'
import enCommon from '../locales/en/common.json'
import enComposer from '../locales/en/composer.json'
import enFileBrowser from '../locales/en/fileBrowser.json'
import enSession from '../locales/en/session.json'
import enSettings from '../locales/en/settings.json'
import enSettingsBridge from '../locales/en/settingsBridge.json'
import enSettingsTasks from '../locales/en/settingsTasks.json'
import enShell from '../locales/en/shell.json'
import enSidebar from '../locales/en/sidebar.json'
import enTabs from '../locales/en/tabs.json'
import enTools from '../locales/en/tools.json'

const LOCALE_CACHE_KEY = 'kila-locale'

/** 获取缓存的语言（同步，用于初始化，避免首帧闪烁） */
export function getCachedLocale(): string {
  try {
    return localStorage.getItem(LOCALE_CACHE_KEY) ?? DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

const zhCN = {
  ...zhAgent,
  ...zhCommon,
  ...zhComposer,
  ...zhFileBrowser,
  ...zhSession,
  ...zhSettings,
  ...zhSettingsBridge,
  ...zhSettingsTasks,
  ...zhShell,
  ...zhSidebar,
  ...zhTabs,
  ...zhTools,
}

const en = {
  ...enAgent,
  ...enCommon,
  ...enComposer,
  ...enFileBrowser,
  ...enSession,
  ...enSettings,
  ...enSettingsBridge,
  ...enSettingsTasks,
  ...enShell,
  ...enSidebar,
  ...enTabs,
  ...enTools,
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      'zh-CN': { translation: zhCN },
      en: { translation: en },
    },
    lng: getCachedLocale(),
    fallbackLng: DEFAULT_LOCALE,
    interpolation: {
      escapeValue: false,
    },
  })

export default i18n
