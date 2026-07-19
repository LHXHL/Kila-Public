import * as React from 'react'
import { useAtomValue } from 'jotai'
import { FolderOpen, Clock3 } from 'lucide-react'
import { sessionsAtom } from '@/atoms/session-atoms'
import { Button } from '@/components/ui/button'

interface SessionHeaderProps {
  sessionId: string
  messageCount: number
}

export function SessionHeader({ sessionId, messageCount }: SessionHeaderProps): React.ReactElement | null {
  const sessions = useAtomValue(sessionsAtom)
  const session = sessions.find((item) => item.id === sessionId) ?? null

  if (!session) return null

  const projectLabel = session.project.name.trim() || session.project.path
  const messageLabel = `${messageCount} 条消息`

  return (
    <div className="relative z-[var(--kila-z-panel)] flex h-8 shrink-0 items-center justify-center bg-transparent px-4 titlebar-drag-region">
      <div
        className="flex min-w-0 max-w-full items-center justify-center gap-2 text-[11px] text-foreground/42 titlebar-no-drag"
        title={session.project.path}
      >
        <span className="shrink-0 font-medium text-foreground/52">
          {messageLabel}
        </span>
        <span className="shrink-0 text-foreground/14">·</span>
        <div className="flex min-w-0 items-center gap-1.5">
          <FolderOpen className="size-3 shrink-0 text-primary/48" />
          <span className="truncate font-medium text-foreground/44">
            {projectLabel}
          </span>
        </div>
        <span className="shrink-0 text-foreground/14">·</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 rounded-lg px-2 text-[11px] text-foreground/44 hover:bg-muted/45 hover:text-foreground/72"
          onClick={() => { void window.electronAPI.openSettingsWindow('scheduled-tasks') }}
        >
          <Clock3 className="size-3" />
          定时任务
        </Button>
      </div>
    </div>
  )
}
