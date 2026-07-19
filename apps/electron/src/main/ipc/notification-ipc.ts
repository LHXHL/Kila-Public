import { BrowserWindow } from 'electron'
import {
  NOTIFICATION_IPC_CHANNELS,
  type CreateKilaNotificationInput,
  type KilaNotificationRecord,
  type ListKilaNotificationsInput,
} from '@kila/shared'
import { handle } from './shared'
import {
  clearNotifications,
  createNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../lib/notification-service'

function broadcastChanged(): void {
  const notifications = listNotifications()
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(NOTIFICATION_IPC_CHANNELS.ON_CHANGED, notifications)
  }
}

function broadcastCreated(notification: KilaNotificationRecord): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(NOTIFICATION_IPC_CHANNELS.ON_CREATED, notification)
  }
  broadcastChanged()
}

export function registerNotificationHandlers(): void {
  handle(
    NOTIFICATION_IPC_CHANNELS.LIST,
    async (_, input?: ListKilaNotificationsInput): Promise<KilaNotificationRecord[]> => {
      return listNotifications(input)
    },
  )

  handle(
    NOTIFICATION_IPC_CHANNELS.CREATE,
    async (_, input: CreateKilaNotificationInput): Promise<KilaNotificationRecord | null> => {
      const notification = createNotification(input)
      if (notification) broadcastCreated(notification)
      return notification
    },
  )

  handle(
    NOTIFICATION_IPC_CHANNELS.MARK_READ,
    async (_, notificationId: string): Promise<KilaNotificationRecord[]> => {
      const notifications = markNotificationRead(notificationId)
      broadcastChanged()
      return notifications
    },
  )

  handle(
    NOTIFICATION_IPC_CHANNELS.MARK_ALL_READ,
    async (): Promise<KilaNotificationRecord[]> => {
      const notifications = markAllNotificationsRead()
      broadcastChanged()
      return notifications
    },
  )

  handle(
    NOTIFICATION_IPC_CHANNELS.CLEAR,
    async (): Promise<void> => {
      clearNotifications()
      broadcastChanged()
    },
  )
}
