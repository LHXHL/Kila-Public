import type * as React from 'react'
import { cn } from '@/lib/utils'

export interface WorkspaceEntityRowProps {
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  metadata?: React.ReactNode
  trailing?: React.ReactNode
  actions?: React.ReactNode
  selected?: boolean
  disabled?: boolean
  compact?: boolean
  overlayActions?: boolean
  className?: string
  contentClassName?: string
  onClick?: () => void
  tabIndex?: number
}

export function WorkspaceEntityRow({
  icon,
  title,
  description,
  metadata,
  trailing,
  actions,
  selected = false,
  disabled = false,
  compact = false,
  overlayActions = false,
  className,
  contentClassName,
  onClick,
  tabIndex,
}: WorkspaceEntityRowProps): React.ReactElement {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={tabIndex ?? (onClick && !disabled ? 0 : undefined)}
      data-selected={selected ? 'true' : undefined}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      onKeyDown={(event) => {
        if (!onClick || disabled) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
      className={cn(
        'interactive-row group relative flex w-full min-w-0 items-start text-left titlebar-no-drag',
        compact ? 'gap-2 px-2 py-1.5' : 'gap-2.5 px-3 py-2.5',
        onClick && 'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        disabled && 'opacity-55',
        className,
      )}
    >
      {icon && (
        <div className={cn(
          'mt-0.5 flex shrink-0 items-center justify-center border border-border/45 bg-background/65 text-muted-foreground',
          compact ? 'size-6 rounded-md' : 'size-8 rounded-lg',
        )}
        >
          {icon}
        </div>
      )}

      <div className={cn('min-w-0 flex-1', contentClassName)}>
        <div className="flex min-w-0 items-center gap-2">
          <div className={cn(
            'min-w-0 flex-1 truncate font-medium text-foreground',
            compact ? 'text-[12.5px] leading-4' : 'text-[13px] leading-5',
          )}
          >
            {title}
          </div>
          {metadata && (
            <div className="flex min-w-0 shrink items-center gap-1 overflow-hidden">
              {metadata}
            </div>
          )}
        </div>
        {description && (
          <div className={cn(
            'min-w-0 truncate text-muted-foreground',
            compact ? 'mt-0.5 text-[11px] leading-4' : 'mt-0.5 text-[11.5px] leading-5',
          )}
          >
            {description}
          </div>
        )}
      </div>

      {trailing && (
        <div className={cn('flex shrink-0 items-center gap-1', compact ? 'mt-0' : 'mt-0.5')}>
          {trailing}
        </div>
      )}

      {actions && (
        <div
          className={cn(
            'hover-reveal-actions flex items-center gap-0.5',
            overlayActions && 'absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-lg bg-muted/95 backdrop-blur-sm',
            !overlayActions && (compact ? 'mt-0' : 'mt-0.5'),
          )}
          onClick={(event) => event.stopPropagation()}
        >
          {actions}
        </div>
      )}
    </div>
  )
}
