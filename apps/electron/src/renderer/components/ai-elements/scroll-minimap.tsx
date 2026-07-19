/**
 * ScrollMinimap — 消息导航迷你地图
 *
 * 在消息区域右上角显示短横杠代表每条消息的位置，
 * 悬浮时弹出消息预览列表，点击可跳转到对应消息。
 * 必须放在 StickToBottom（Conversation）内部使用。
 */

import * as React from 'react'
import { AlertTriangle } from 'lucide-react'
import { useStickToBottomContext } from 'use-stick-to-bottom'
import { UserAvatar } from '@/components/message/UserAvatar'
import { getModelLogo, isOpenAIModelLogo } from '@/lib/model-logo'
import { cn } from '@/lib/utils'
import { buildScrollMinimapLayout } from './scroll-minimap-layout'

export interface MinimapItem {
  id: string
  role: 'user' | 'assistant' | 'status'
  preview: string
  avatar?: string
  model?: string
  heightPx: number
}

interface ScrollMinimapProps {
  items: MinimapItem[]
}

/** 最少消息数才显示迷你地图 */
const MIN_ITEMS = 4
/** 迷你地图最多渲染的横杠数 */
const MAX_BARS = 20

export function ScrollMinimap({ items }: ScrollMinimapProps): React.ReactElement | null {
  const { scrollRef } = useStickToBottomContext()
  const [hovered, setHovered] = React.useState(false)
  const outlineId = React.useId()
  const [visibleIds, setVisibleIds] = React.useState<Set<string>>(new Set())
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout>>()
  const [canScroll, setCanScroll] = React.useState(false)
  const roleById = React.useMemo(
    () => new Map(items.map((item) => [item.id, item.role])),
    [items],
  )
  const bars = React.useMemo(
    () => buildScrollMinimapLayout({
      items: items.map((item) => ({ id: item.id, heightPx: item.heightPx })),
      maxBars: MAX_BARS,
    }),
    [items],
  )

  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const update = (): void => {
      const { scrollTop, scrollHeight, clientHeight } = el
      setCanScroll(scrollHeight > clientHeight + 10)
      if (scrollHeight <= 0) return

      const nodes = el.querySelectorAll<HTMLElement>('[data-message-id]')
      const ids = new Set<string>()
      for (const node of nodes) {
        const top = node.offsetTop
        const bottom = top + node.offsetHeight
        if (bottom > scrollTop && top < scrollTop + clientHeight) {
          const id = node.getAttribute('data-message-id')
          if (id) ids.add(id)
        }
      }
      setVisibleIds(ids)
    }

    update()
    el.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(el)

    return () => {
      el.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [scrollRef, items])

  const handleMouseEnter = (): void => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    setHovered(true)
  }

  const handleMouseLeave = (): void => {
    closeTimerRef.current = setTimeout(() => setHovered(false), 150)
  }

  React.useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
  }, [])

  const scrollToMessage = React.useCallback((id: string) => {
    const el = scrollRef.current
    if (!el) return
    const target = el.querySelector(`[data-message-id="${id}"]`)
    target?.scrollIntoView({ behavior: 'auto', block: 'center' })
  }, [scrollRef])

  if (items.length < MIN_ITEMS || !canScroll) return null

  const stripHeight = Math.max(12, bars.length * 6)

  return (
    <div
      className="absolute right-0 top-1/2 -translate-y-1/2 z-10 flex items-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocusCapture={handleMouseEnter}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) handleMouseLeave()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setHovered(false)
          ;(event.currentTarget.querySelector('[data-minimap-trigger]') as HTMLElement | null)?.focus()
        }
      }}
    >
      {/* 悬浮弹出面板 */}
      {hovered && (
        <nav id={outlineId} aria-label="会话大纲" className="mr-2 w-[260px] rounded-lg border bg-popover animate-in fade-in-0 zoom-in-95 duration-150">
          <div className="max-h-[30vh] overflow-y-auto scrollbar-none p-2 space-y-0.5">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  'flex items-start gap-2 w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent',
                  visibleIds.has(item.id) && 'bg-accent/50'
                )}
                onClick={() => scrollToMessage(item.id)}
              >
                <ItemIcon item={item} />
                <span className="text-xs text-popover-foreground/80 line-clamp-2 flex-1 min-w-0">
                  {item.preview || '(空消息)'}
                </span>
              </button>
            ))}
          </div>
        </nav>
      )}

      {/* 迷你地图条 — 集中在右上角 */}
      <button
        type="button"
        data-minimap-trigger
        aria-label="打开会话大纲"
        aria-expanded={hovered}
        aria-controls={outlineId}
        className="relative flex-shrink-0 rounded-l-md outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
        style={{ width: 24, height: stripHeight }}
        onClick={() => setHovered((value) => !value)}
      >
        {bars.map((bar) => {
          const isVisible = bar.itemIds.some((id) => visibleIds.has(id))
          const hasUser = bar.itemIds.some((id) => roleById.get(id) === 'user')
          const topPx = bar.topRatio * stripHeight
          const heightPx = Math.max(2, Math.ceil(bar.heightRatio * stripHeight) - 1)
          return (
            <div
              key={bar.key}
              className={cn(
                'absolute left-1 w-[20px] rounded-full transition-colors',
                isVisible
                  ? 'bg-primary/60'
                  : hasUser
                    ? 'bg-muted-foreground/25'
                    : 'bg-muted-foreground/45'
              )}
              style={{ top: `${topPx}px`, height: `${heightPx}px` }}
            />
          )
        })}
      </button>
    </div>
  )
}

function ItemIcon({ item }: { item: MinimapItem }): React.ReactElement {
  if (item.role === 'user' && item.avatar) {
    return <UserAvatar avatar={item.avatar} size={16} className="mt-0.5" />
  }
  if ((item.role === 'assistant') && item.model) {
    return (
      <img
        src={getModelLogo(item.model)}
        alt=""
        className={cn(
          'size-4 shrink-0 mt-0.5 rounded-[20%] object-cover',
          isOpenAIModelLogo(item.model) && 'dark:invert',
        )}
      />
    )
  }
  if (item.role === 'status') {
    return <AlertTriangle className="size-4 shrink-0 mt-0.5 text-destructive" />
  }
  return <div className="size-4 shrink-0 mt-0.5 rounded-[20%] bg-muted" />
}
