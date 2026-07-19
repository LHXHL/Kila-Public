import * as React from 'react'
import { MessageSquarePlus } from 'lucide-react'

interface FollowUpChipsProps {
  suggestion: string | null
  onUse: (text: string) => void
}

export function FollowUpChips({
  suggestion,
  onUse,
}: FollowUpChipsProps): React.ReactElement | null {
  const text = suggestion?.trim()
  if (!text) return null

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <button
        type="button"
        className="kila-headline-pop inline-flex max-w-full items-center gap-1.5 rounded-lg bg-muted/45 px-2.5 py-1.5 text-left text-[13px] text-foreground/82 shadow-sm transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onUse(text)}
      >
        <MessageSquarePlus className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="line-clamp-2">{text}</span>
      </button>
    </div>
  )
}
