export type KilaNotificationLevel = 'info' | 'success' | 'warning' | 'error'
export type KilaNotificationCategory = 'agent' | 'permission' | 'system' | 'usage' | 'update' | 'bridge'

export interface KilaNotificationRecord {
  id: string
  title: string
  body?: string
  level: KilaNotificationLevel
  category: KilaNotificationCategory
  sessionId?: string
  createdAt: number
  readAt?: number
}

export interface CreateKilaNotificationInput {
  title: string
  body?: string
  level?: KilaNotificationLevel
  category?: KilaNotificationCategory
  sessionId?: string
  createdAt?: number
}

export interface ListKilaNotificationsInput {
  limit?: number
  includeRead?: boolean
}

export interface KilaNotificationPreference {
  enabled: boolean
}

export type KilaNotificationPreferenceMap = Partial<Record<KilaNotificationCategory, KilaNotificationPreference>>

export const NOTIFICATION_IPC_CHANNELS = {
  LIST: 'notification:list',
  CREATE: 'notification:create',
  MARK_READ: 'notification:mark-read',
  MARK_ALL_READ: 'notification:mark-all-read',
  CLEAR: 'notification:clear',
  ON_CREATED: 'notification:created',
  ON_CHANGED: 'notification:changed',
} as const
