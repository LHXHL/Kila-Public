import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { CircleAlert, MessageSquareText, ShieldAlert } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { AskUserRequest, PermissionRequest, SessionMeta } from '@kila/shared'
import { sessionsAtom, currentSessionIdAtom } from '@/atoms/session-atoms'
import {
  allPendingAskUserRequestsAtom,
  allPendingPermissionRequestsAtom,
  totalPendingRequestsAtom,
} from '@/atoms/agent-permission-atoms'
import {
  tabsAtom,
  splitLayoutAtom,
  openTab,
} from '@/atoms/tab-atoms'

interface GlobalPendingRequestsButtonProps {
  collapsed?: boolean
}

interface PendingDisplayItem {
  requestId: string
  kind: 'permission' | 'ask_user'
  label: string
}

interface PendingDisplayGroup {
  sessionId: string
  title: string
  items: PendingDisplayItem[]
}

function buildPendingGroups(params: {
  sessions: SessionMeta[]
  permissionMap: Map<string, readonly PermissionRequest[]>
  askUserMap: Map<string, readonly AskUserRequest[]>
}): PendingDisplayGroup[] {
  const titleMap = new Map(params.sessions.map((session) => [session.id, session.title]))
  const groups = new Map<string, PendingDisplayGroup>()

  const ensureGroup = (sessionId: string): PendingDisplayGroup => {
    const existing = groups.get(sessionId)
    if (existing) return existing
    const group: PendingDisplayGroup = {
      sessionId,
      title: titleMap.get(sessionId) ?? `会话 ${sessionId.slice(0, 8)}`,
      items: [],
    }
    groups.set(sessionId, group)
    return group
  }

  for (const [sessionId, requests] of params.permissionMap) {
    const group = ensureGroup(sessionId)
    for (const request of requests) {
      group.items.push({
        requestId: request.requestId,
        kind: 'permission',
        label: request.toolName ? `权限 · ${request.toolName}` : '权限请求',
      })
    }
  }

  for (const [sessionId, requests] of params.askUserMap) {
    const group = ensureGroup(sessionId)
    for (const request of requests) {
      group.items.push({
        requestId: request.requestId,
        kind: 'ask_user',
        label: request.questions[0]?.header
          ? `提问 · ${request.questions[0].header}`
          : `提问 · ${request.questions[0]?.question ?? '需要输入'}`,
      })
    }
  }

  return Array.from(groups.values()).sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
}

export function GlobalPendingRequestsButton({
  collapsed = false,
}: GlobalPendingRequestsButtonProps): React.ReactElement | null {
  const total = useAtomValue(totalPendingRequestsAtom)
  const sessions = useAtomValue(sessionsAtom)
  const permissionMap = useAtomValue(allPendingPermissionRequestsAtom)
  const askUserMap = useAtomValue(allPendingAskUserRequestsAtom)
  const [tabs, setTabs] = useAtom(tabsAtom)
  const [layout, setLayout] = useAtom(splitLayoutAtom)
  const setCurrentSessionId = useSetAtom(currentSessionIdAtom)
  const [open, setOpen] = React.useState(false)

  const groups = React.useMemo(() => buildPendingGroups({
    sessions,
    permissionMap,
    askUserMap,
  }), [askUserMap, permissionMap, sessions])

  if (total <= 0 || groups.length === 0) return null

  const focusSession = (group: PendingDisplayGroup): void => {
    const result = openTab(tabs, layout, {
      type: 'agent',
      sessionId: group.sessionId,
      title: group.title,
    })
    setTabs(result.tabs)
    setLayout(result.layout)
    setCurrentSessionId(group.sessionId)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'titlebar-no-drag transition-colors',
            collapsed
              ? 'relative rounded-2xl p-2 text-foreground/70 hover:bg-background hover:text-foreground'
              : 'flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-[13px] text-foreground/70 hover:bg-background hover:text-foreground',
          )}
          aria-label={`待处理请求 ${total}`}
        >
          <div className="relative">
            <CircleAlert size={collapsed ? 18 : 16} />
            <span className={cn(
              'absolute -right-1.5 -top-1.5 flex min-w-4 items-center justify-center rounded-full bg-[hsl(var(--status-warning))] px-1 text-[10px] font-medium text-white',
              collapsed ? 'h-4' : 'h-4',
            )}>
              {total}
            </span>
          </div>
          {!collapsed && (
            <>
              <span>待处理请求</span>
              <span className="ml-auto text-xs text-muted-foreground">({total})</span>
            </>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align={collapsed ? 'start' : 'end'}
        side={collapsed ? 'right' : 'top'}
        className="w-80 p-3"
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">待处理请求</div>
              <div className="text-xs text-muted-foreground">点击可跳转到对应会话</div>
            </div>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {total}
            </span>
          </div>

          <div className="space-y-2">
            {groups.map((group) => (
              <button
                key={group.sessionId}
                type="button"
                onClick={() => focusSession(group)}
                className="flex w-full flex-col gap-2 rounded-xl border border-border/70 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
              >
                <div className="truncate text-sm font-medium text-foreground">
                  {group.title}
                </div>
                <div className="space-y-1">
                  {group.items.map((item) => (
                    <div key={item.requestId} className="flex items-center gap-2 text-xs text-muted-foreground">
                      {item.kind === 'permission'
                        ? <ShieldAlert className="size-3.5 shrink-0 text-[hsl(var(--status-warning))]" />
                        : <MessageSquareText className="size-3.5 shrink-0 text-primary/70" />}
                      <span className="truncate">{item.label}</span>
                    </div>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
