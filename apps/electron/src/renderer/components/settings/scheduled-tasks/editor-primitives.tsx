/**
 * 定时任务编辑器的排版原语
 *
 * 编辑器被拆成多块后，字段组和分节卡片需要共用同一套间距与层级。
 */

import type * as React from 'react'
import { Label } from '@/components/ui/label'

export function FieldGroup({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="space-y-2.5">
      <div>
        <Label className="text-sm font-medium text-foreground">{label}</Label>
        {description && (
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  )
}

export function SectionCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section className="border-t border-border/50 pt-5 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}
