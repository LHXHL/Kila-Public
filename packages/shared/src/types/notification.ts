/**
 * 通知偏好类型
 *
 * 站内通知中心已移除，这里仅保留桌面通知分类偏好（用于 settings.json 持久化）。
 */

export type KilaNotificationCategory = 'agent' | 'permission' | 'system' | 'usage' | 'update' | 'bridge'

export interface KilaNotificationPreference {
  enabled: boolean
}

export type KilaNotificationPreferenceMap = Partial<Record<KilaNotificationCategory, KilaNotificationPreference>>
