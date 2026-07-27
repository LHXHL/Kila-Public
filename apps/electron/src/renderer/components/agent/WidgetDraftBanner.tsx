import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { WidgetDraftIntent } from '@kila/shared'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface WidgetDraftBannerProps {
  proposal: WidgetDraftIntent
  className?: string
  onSend: () => void
  onEdit: () => void
  onCancel: () => void
}

function getProposalPreview(proposal: WidgetDraftIntent): string {
  const label = proposal.label?.trim()
  if (label) return label
  return proposal.prompt.length > 72
    ? `${proposal.prompt.slice(0, 72)}…`
    : proposal.prompt
}

export function WidgetDraftBanner({
  proposal,
  className,
  onSend,
  onEdit,
  onCancel,
}: WidgetDraftBannerProps): React.ReactElement {
  const { t } = useTranslation()
  return (
    <div className={cn('mb-2', className)}>
      <div className="flex items-start gap-3 rounded-xl border border-primary/15 bg-primary/5 px-4 py-3">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary/75" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">{t('agent.widget.draftTitle')}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {getProposalPreview(proposal)}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" size="sm" onClick={onSend}>{t('composer.send')}</Button>
          <Button type="button" size="sm" variant="outline" onClick={onEdit}>{t('common.edit')}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>{t('common.cancel')}</Button>
        </div>
      </div>
    </div>
  )
}
