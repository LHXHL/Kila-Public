import * as React from 'react'
import { cn } from '@/lib/utils'

export type EntityMetadataTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export interface EntityMetadataChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: EntityMetadataTone
}

export function EntityMetadataChip({
  tone = 'neutral',
  className,
  ...props
}: EntityMetadataChipProps): React.ReactElement {
  return (
    <span
      data-tone={tone === 'neutral' ? undefined : tone}
      className={cn('metadata-chip', className)}
      {...props}
    />
  )
}
