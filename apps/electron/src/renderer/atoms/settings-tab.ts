/**
 * Settings Tab Atom - 设置标签页状态
 *
 * 管理设置面板中当前激活的标签页：
 * - general: 通用设置
 * - channels: 渠道配置
 * - proxy: 代理配置
 * - appearance: 外观设置
 * - about: 关于
 */

import { atom } from 'jotai'
import { DEFAULT_SETTINGS_TAB } from '../../types/settings'
import type { SettingsTab } from '../../types/settings'

export type { SettingsTab } from '../../types/settings'

/** 当前设置标签页（不持久化，每次打开设置默认显示通用） */
export const settingsTabAtom = atom<SettingsTab>(DEFAULT_SETTINGS_TAB)

/** 当前设置页是否存在需要显式保存的草稿。 */
export const settingsDirtyAtom = atom(false)
