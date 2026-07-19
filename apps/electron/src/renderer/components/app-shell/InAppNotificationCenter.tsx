import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  Bell,
  CheckCheck,
  CircleAlert,
  CircleCheck,
  Clock3,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import {
  clearInAppNotificationsAtom,
  inAppNotificationsAtom,
  markAllInAppNotificationsReadAtom,
  markInAppNotificationReadAtom,
  unreadInAppNotificationCountAtom,
  type InAppNotification,
} from '@/atoms/notifications'
import { currentSessionIdAtom, sessionsAtom } from '@/atoms/session-atoms'
import { tabsAtom, splitLayoutAtom, openTab } from '@/atoms/tab-atoms'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp
  const minute = 60_000
  if (diffMs < minute) return '刚刚'
  if (diffMs < 60 * minute) return `${Math.floor(diffMs / minute)} 分钟前`
  if (diffMs < 24 * 60 * minute) return `${Math.floor(diffMs / (60 * minute))} 小时前`
  return new Date(timestamp).toLocaleDateString()
}

function getNotificationIcon(notification: InAppNotification): React.ReactElement {
  if (notification.category === 'permission') return <ShieldAlert className="size-4" />
  if (notification.level === 'success') return <CircleCheck className="size-4" />
  if (notification.level === 'error') return <CircleAlert className="size-4" />
  return <Clock3 className="size-4" />
}

function getNotificationTone(notification: InAppNotification): string {
  if (notification.level === 'success') return 'bg-[hsl(var(--status-success-soft))] text-[hsl(var(--status-success))]'
  if (notification.level === 'warning') return 'bg-[hsl(var(--status-warning-soft))] text-[hsl(var(--status-warning))]'
  if (notification.level === 'error') return 'bg-[hsl(var(--status-danger-soft))] text-[hsl(var(--status-danger))]'
  return 'bg-muted text-muted-foreground'
}

interface InAppNotificationCenterProps {
  collapsed?: boolean
}

export function InAppNotificationCenter({ collapsed = false }: InAppNotificationCenterProps): React.ReactElement {
  const notifications = useAtomValue(inAppNotificationsAtom)
  const unreadCount = useAtomValue(unreadInAppNotificationCountAtom)
  const sessions = useAtomValue(sessionsAtom)
  const setCurrentSessionId = useSetAtom(currentSessionIdAtom)
  const markRead = useSetAtom(markInAppNotificationReadAtom)
  const markAllRead = useSetAtom(markAllInAppNotificationsReadAtom)
  const clearAll = useSetAtom(clearInAppNotificationsAtom)
  const [tabs, setTabs] = useAtom(tabsAtom)
  const [layout, setLayout] = useAtom(splitLayoutAtom)
  const [open, setOpen] = React.useState(false)

  const handleOpenNotification = React.useCallback((notification: InAppNotification): void => {
    markRead(notification.id)
    if (notification.sessionId) {
      const session = sessions.find((item) => item.id === notification.sessionId)
      const result = openTab(tabs, layout, {
        type: 'agent',
        sessionId: notification.sessionId,
        title: session?.title ?? notification.title,
      })
      setTabs(result.tabs)
      setLayout(result.layout)
      setCurrentSessionId(notification.sessionId)
    }
    setOpen(false)
  }, [layout, markRead, sessions, setCurrentSessionId, setLayout, setTabs, tabs])

  const trigger = (
    <button
      type="button"
      className={cn(
        'titlebar-no-drag relative flex items-center rounded-xl text-foreground/60 transition-colors hover:bg-muted/55 hover:text-foreground',
        collapsed ? 'size-10 justify-center' : 'h-10 w-full gap-2 px-3',
      )}
    >
      <Bell size={collapsed ? 18 : 16} />
      {!collapsed && <span className="text-[13px] font-medium">通知</span>}
      {!collapsed && unreadCount > 0 && (
        <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] leading-none text-primary-foreground">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
      {collapsed && unreadCount > 0 && (
        <span className="absolute right-1.5 top-1.5 min-h-2 min-w-2 rounded-full bg-primary" />
      )}
    </button>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side={collapsed ? 'right' : 'top'}
        align={collapsed ? 'end' : 'start'}
        sideOffset={8}
        className="w-[360px] max-w-[calc(100vw-24px)] overflow-hidden p-0 shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border/60 px-3 py-2.5">
          <div>
            <div className="text-sm font-medium text-foreground">站内通知</div>
            <div className="text-[11px] text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount} 条未读` : '暂无未读'}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => markAllRead()}
              disabled={unreadCount === 0}
            >
              <CheckCheck size={15} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => clearAll()}
              disabled={notifications.length === 0}
            >
              <Trash2 size={15} />
            </Button>
          </div>
        </div>

        <div className="max-h-[420px] overflow-y-auto py-1">
          {notifications.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              暂无通知
            </div>
          ) : (
            notifications.map((notification) => {
              const unread = !notification.readAt
              return (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => handleOpenNotification(notification)}
                  className="flex w-full gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
                >
                  <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg', getNotificationTone(notification))}>
                    {getNotificationIcon(notification)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={cn('min-w-0 flex-1 truncate text-sm', unread ? 'font-medium text-foreground' : 'text-foreground/75')}>
                        {notification.title}
                      </span>
                      {unread && <span className="size-1.5 rounded-full bg-primary" />}
                    </span>
                    {notification.body && (
                      <span className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {notification.body}
                      </span>
                    )}
                    <span className="mt-1 block text-[11px] text-muted-foreground/70">
                      {formatRelativeTime(notification.createdAt)}
                    </span>
                  </span>
                </button>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
