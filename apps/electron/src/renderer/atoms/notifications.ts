/**
 * 桌面通知状态管理
 *
 * 管理通知开关状态，提供发送桌面通知的工具函数。
 * 实际通知通过 main process 的 Electron Notification 发送。
 */

import { atom } from 'jotai'
import type {
  CreateKilaNotificationInput,
  KilaNotificationCategory,
  KilaNotificationLevel,
  KilaNotificationPreferenceMap,
  KilaNotificationRecord,
} from '@kila/shared'

/** 通知是否启用 */
export const notificationsEnabledAtom = atom<boolean>(true)

/** 通知分类偏好 */
export const notificationPreferencesAtom = atom<KilaNotificationPreferenceMap>({})

export type InAppNotificationLevel = KilaNotificationLevel
export type InAppNotificationCategory = KilaNotificationCategory
export type InAppNotification = KilaNotificationRecord
export type CreateInAppNotificationInput = CreateKilaNotificationInput

const MAX_IN_APP_NOTIFICATIONS = 80

export const inAppNotificationsAtom = atom<InAppNotification[]>([])

export const unreadInAppNotificationCountAtom = atom((get) =>
  get(inAppNotificationsAtom).filter((notification) => !notification.readAt).length,
)

export const addInAppNotificationAtom = atom(
  null,
  (get, set, input: CreateInAppNotificationInput) => {
    void window.electronAPI.createNotification(input).catch((error) => {
      console.error('[通知] 持久化失败:', error)
    })

    const optimistic: InAppNotification = {
      id: `optimistic-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: input.title,
      body: input.body,
      level: input.level ?? 'info',
      category: input.category ?? 'system',
      sessionId: input.sessionId,
      createdAt: input.createdAt ?? Date.now(),
    }

    set(inAppNotificationsAtom, [
      optimistic,
      ...get(inAppNotificationsAtom),
    ].slice(0, MAX_IN_APP_NOTIFICATIONS))

    return optimistic
  },
)

export const markInAppNotificationReadAtom = atom(
  null,
  (get, set, notificationId: string) => {
    const now = Date.now()
    set(inAppNotificationsAtom, get(inAppNotificationsAtom).map((notification) => (
      notification.id === notificationId && !notification.readAt
        ? { ...notification, readAt: now }
        : notification
    )))
    if (!notificationId.startsWith('optimistic-')) {
      void window.electronAPI.markNotificationRead(notificationId).catch((error) => {
        console.error('[通知] 标记已读失败:', error)
      })
    }
  },
)

export const markAllInAppNotificationsReadAtom = atom(
  null,
  (get, set) => {
    const now = Date.now()
    set(inAppNotificationsAtom, get(inAppNotificationsAtom).map((notification) => (
      notification.readAt ? notification : { ...notification, readAt: now }
    )))
    void window.electronAPI.markAllNotificationsRead().catch((error) => {
      console.error('[通知] 全部标记已读失败:', error)
    })
  },
)

export const clearInAppNotificationsAtom = atom(
  null,
  (_get, set) => {
    set(inAppNotificationsAtom, [])
    void window.electronAPI.clearNotifications().catch((error) => {
      console.error('[通知] 清空失败:', error)
    })
  },
)

export async function initializeInAppNotifications(
  setNotifications: (notifications: InAppNotification[] | ((prev: InAppNotification[]) => InAppNotification[])) => void,
): Promise<() => void> {
  try {
    setNotifications(await window.electronAPI.listNotifications({ limit: MAX_IN_APP_NOTIFICATIONS }))
  } catch (error) {
    console.error('[通知] 加载站内通知失败:', error)
  }

  const cleanupCreated = window.electronAPI.onNotificationCreated((notification) => {
    setNotifications((prev) => {
      const next = [
        notification,
        ...prev.filter((item) => !item.id.startsWith('optimistic-') && item.id !== notification.id),
      ]
      return next.slice(0, MAX_IN_APP_NOTIFICATIONS)
    })
  })

  const cleanupChanged = window.electronAPI.onNotificationsChanged((notifications) => {
    setNotifications(notifications.slice(0, MAX_IN_APP_NOTIFICATIONS))
  })

  return () => {
    cleanupCreated()
    cleanupChanged()
  }
}

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
