/**
 * 桌面通知状态管理
 *
 * 管理通知开关状态，提供发送桌面通知的工具函数。
 * 实际通知通过 main process 的 Electron Notification 发送。
 *
 * 注：站内通知中心（铃铛 + 列表 + JSONL 持久化）已移除。
 */

import { atom } from 'jotai'
import type { KilaNotificationPreferenceMap } from '@kila/shared'

/** 桌面通知是否启用 */
export const notificationsEnabledAtom = atom<boolean>(true)

/** 通知分类偏好（保留给设置页与未来的桌面通知分类过滤） */
export const notificationPreferencesAtom = atom<KilaNotificationPreferenceMap>({})

/**
 * 从主进程加载通知设置
 */
export async function initializeNotifications(
  setEnabled: (enabled: boolean) => void,
  setPreferences?: (prefs: KilaNotificationPreferenceMap) => void,
): Promise<() => void> {
  try {
    const settings = await window.electronAPI.getSettings()
    setEnabled(settings.notificationsEnabled ?? true)
    if (setPreferences) {
      setPreferences(settings.notificationPreferences ?? {})
    }
  } catch (error) {
    console.error('[通知] 初始化失败:', error)
  }

  return window.electronAPI.onSettingsChanged((settings) => {
    setEnabled(settings.notificationsEnabled ?? true)
    if (setPreferences) {
      setPreferences(settings.notificationPreferences ?? {})
    }
  })
}

/**
 * 更新通知开关并持久化
 */
export async function updateNotificationsEnabled(enabled: boolean): Promise<void> {
  try {
    await window.electronAPI.updateSettings({ notificationsEnabled: enabled })
  } catch (error) {
    console.error('[通知] 更新设置失败:', error)
  }
}

/**
 * 发送桌面通知
 *
 * 仅在窗口未聚焦、通知已启用且权限已授予时发送。
 * 点击通知会聚焦应用窗口。
 */
export function sendDesktopNotification(
  title: string,
  body: string,
  enabled: boolean,
  options?: {
    force?: boolean
    sessionId?: string
  },
): Promise<boolean> {
  if (!enabled) return Promise.resolve(false)
  if (!options?.force && document.hasFocus()) return Promise.resolve(false)

  return window.electronAPI.showDesktopNotification({ title, body, sessionId: options?.sessionId })
}

/**
 * 更新通知分类偏好并持久化
 */
export async function updateNotificationPreferences(prefs: KilaNotificationPreferenceMap): Promise<void> {
  try {
    await window.electronAPI.updateSettings({ notificationPreferences: prefs })
  } catch (error) {
    console.error('[通知] 更新偏好失败:', error)
  }
}
