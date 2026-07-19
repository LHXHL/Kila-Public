/**
 * TabBarItem — 单个标签页 UI
 *
 * 显示：类型图标 + 标题 + 流式指示器 + 关闭按钮
 * 支持：点击聚焦、中键关闭、拖拽重排
 */

import * as React from 'react'
import { Bot, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TabType } from '@/atoms/tab-atoms'

export interface TabBarItemProps {
  id: string
  type: TabType
  title: string
  isActive: boolean
  isStreaming: boolean
  onActivate: () => void
  onClose: () => void
  onMiddleClick: () => void
  onMoveLeft: () => void
  onMoveRight: () => void
  /** 拖拽相关 */
  onDragStart: (e: React.PointerEvent) => void
}

export function TabBarItem({
  id,
  type: _type,
  title,
  isActive,
  isStreaming,
  onActivate,
  onClose,
  onMiddleClick,
  onMoveLeft,
  onMoveRight,
  onDragStart,
}: TabBarItemProps): React.ReactElement {
  const handleMouseDown = (e: React.MouseEvent): void => {
    // 中键点击关闭
    if (e.button === 1) {
      e.preventDefault()
      onMiddleClick()
    }
  }

  const handleCloseClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    onClose()
  }

  const Icon = Bot

  return (
    <div
      role="tab"
      aria-selected={isActive}
      aria-label={title}
      data-tab-id={id}
      tabIndex={isActive ? 0 : -1}
      className={cn(
        'group relative flex h-8 min-w-[112px] max-w-[220px] shrink-0 items-center gap-1.5 px-3',
        'select-none rounded-lg border text-xs transition-colors',
        isActive
          ? 'border-primary/25 bg-card text-foreground'
          : 'border-transparent text-muted-foreground/70 hover:border-border/55 hover:bg-muted/35 hover:text-foreground/82',
      )}
      onClick={onActivate}
      onMouseDown={handleMouseDown}
      onPointerDown={onDragStart}
      onKeyDown={(event) => {
        if (event.altKey && event.key === 'ArrowLeft') {
          event.preventDefault()
          onMoveLeft()
        } else if (event.altKey && event.key === 'ArrowRight') {
          event.preventDefault()
          onMoveRight()
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onActivate()
        }
      }}
    >
      {/* 类型图标 */}
      <Icon className="size-3 shrink-0" />

      {/* 标题 */}
      <span className="flex-1 min-w-0 truncate text-left">{title}</span>

      {/* 流式指示器 */}
      {isStreaming && (
        <span
          className={cn(
            'size-1.5 rounded-full shrink-0',
            'bg-primary/70'
          )}
        />
      )}

      {/* 关闭按钮 */}
      <button
        type="button"
        aria-label={`关闭 ${title}`}
        tabIndex={isActive ? 0 : -1}
        className={cn(
          'size-4 rounded-sm flex items-center justify-center shrink-0',
          'opacity-0 group-hover:opacity-100 hover:bg-muted-foreground/20 transition-opacity',
          isActive && 'opacity-60',
        )}
        onClick={handleCloseClick}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <X className="size-2.5" />
      </button>
    </div>
  )
}
