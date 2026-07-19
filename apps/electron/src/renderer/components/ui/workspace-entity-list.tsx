import * as React from 'react'
import { cn } from '@/lib/utils'

export function WorkspaceEntityList({
  className,
  children,
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div className={cn('space-y-1', className)}>
      {children}
    </div>
  )
}

export function WorkspaceEntityGroupHeader({
  className,
  children,
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div className={cn('flex items-center justify-between px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80', className)}>
      {children}
    </div>
  )
}
