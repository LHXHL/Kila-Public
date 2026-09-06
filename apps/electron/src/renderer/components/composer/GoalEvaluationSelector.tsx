import type { GoalExecutionMode } from '@kila/shared'
import { Check, ChevronDown, Circle, CircleCheck, SlidersHorizontal, Sparkles, Target, X } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { ToolbarHoverPopover } from './ToolbarHoverPopover'

interface GoalEvaluationSelectorProps {
  value: GoalExecutionMode
  onChange: (value: GoalExecutionMode) => void
  customPrompt?: string
  onCustomPromptChange?: (value: string) => void
  buttonClassName?: string
  iconClassName?: string
  disabled?: boolean
}

const MANUAL_MODES: Exclude<GoalExecutionMode, 'auto'>[] = [
  'definite',
  'exploratory',
  'incremental',
]

export function GoalEvaluationSelector({
  value,
  onChange,
  customPrompt = '',
  onCustomPromptChange,
  buttonClassName,
  iconClassName,
  disabled = false,
}: GoalEvaluationSelectorProps): React.ReactElement {
  const { t } = useTranslation()
  const [manualExpanded, setManualExpanded] = React.useState(value !== 'auto')
  const [draftPrompt, setDraftPrompt] = React.useState(customPrompt)

  React.useEffect(() => {
    setDraftPrompt(customPrompt)
  }, [customPrompt])

  React.useEffect(() => {
    if (value !== 'auto') setManualExpanded(true)
  }, [value])

  const selectMode = React.useCallback((mode: GoalExecutionMode, close: () => void) => {
    onChange(mode)
    close()
  }, [onChange])

  const commitPrompt = React.useCallback(() => {
    onCustomPromptChange?.(draftPrompt)
  }, [draftPrompt, onCustomPromptChange])

  const hasCustomPrompt = Boolean(customPrompt.trim())

  return (
    <ToolbarHoverPopover
      disabled={disabled}
      align="start"
      contentClassName="max-h-[min(70vh,38rem)] w-[min(22rem,calc(100vw-1.5rem))] overflow-y-auto p-0"
      trigger={({ open, triggerProps }) => (
        <Button
          {...triggerProps}
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('agent.goalEvaluation.title')}
          disabled={disabled}
          className={cn(
            buttonClassName ?? 'size-[30px] rounded-lg',
            (value !== 'auto' || hasCustomPrompt)
              ? 'bg-brand-soft text-brand-soft-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            open && value === 'auto' && 'bg-muted/50',
          )}
        >
          <Target className={cn(iconClassName ?? 'size-5')} />
        </Button>
      )}
    >
      {({ close }) => (
        <div className="p-3.5">
          <div className="mb-2.5 px-1">
            <div className="text-sm font-semibold text-foreground">
              {t('agent.goalEvaluation.title')}
            </div>
            <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {t('agent.goalEvaluation.description')}
            </div>
          </div>

          <div role="radiogroup" aria-label={t('agent.goalEvaluation.title')} className="space-y-1.5">
            <ModeButton
              selected={value === 'auto'}
              icon={<Sparkles className="size-4" />}
              label={t('agent.goalEvaluation.auto.label')}
              description={t('agent.goalEvaluation.auto.description')}
              onClick={() => selectMode('auto', close)}
            />

            <div className="border-t border-border/60 pt-1.5">
              <button
                type="button"
                aria-expanded={manualExpanded}
                className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted/60"
                onClick={() => setManualExpanded((current) => !current)}
              >
                <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  {t('agent.goalEvaluation.manual.label')}
                </span>
                <ChevronDown className={cn(
                  'size-4 shrink-0 text-muted-foreground transition-transform',
                  manualExpanded && 'rotate-180',
                )} />
              </button>

              {manualExpanded && (
                <div className="mt-1 space-y-1" role="group" aria-label={t('agent.goalEvaluation.manual.label')}>
                  {MANUAL_MODES.map((mode) => (
                    <ModeButton
                      key={mode}
                      compact
                      selected={value === mode}
                      label={t(`agent.goalEvaluation.modes.${mode}.label`)}
                      description={t(`agent.goalEvaluation.modes.${mode}.description`)}
                      onClick={() => selectMode(mode, close)}
                    />
                  ))}
                </div>
              )}
            </div>

            {onCustomPromptChange && (
              <div className="mt-3 border-t border-border/60 pt-3">
                <div className="mb-1.5 px-1 text-xs font-medium text-foreground">
                  {t('agent.goalEvaluation.custom.title')}
                </div>
                <Textarea
                  value={draftPrompt}
                  onChange={(event) => setDraftPrompt(event.target.value)}
                  onBlur={commitPrompt}
                  placeholder={t('agent.goalEvaluation.custom.placeholder')}
                  aria-label={t('agent.goalEvaluation.custom.title')}
                  className="min-h-20 resize-y text-xs leading-5"
                  maxLength={4000}
                />
                <div className="mt-1.5 flex items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground">
                  <span>{t('agent.goalEvaluation.custom.hint')}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    {draftPrompt.trim() && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6 rounded-md"
                        aria-label={t('agent.goalEvaluation.custom.clear')}
                        onClick={() => {
                          setDraftPrompt('')
                          onCustomPromptChange('')
                        }}
                      >
                        <X className="size-3.5" />
                      </Button>
                    )}
                    <Check className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </ToolbarHoverPopover>
  )
}

function ModeButton({
  selected,
  label,
  description,
  icon,
  compact = false,
  onClick,
}: {
  selected: boolean
  label: string
  description: string
  icon?: React.ReactNode
  compact?: boolean
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-lg border text-left transition-colors',
        compact ? 'px-2.5 py-2' : 'px-3 py-2.5',
        selected
          ? 'border-primary/60 bg-brand-soft text-brand-soft-foreground'
          : 'border-transparent text-foreground hover:border-border hover:bg-muted/45',
      )}
      onClick={onClick}
    >
      <span className={cn('mt-0.5 shrink-0', selected ? 'text-primary' : 'text-muted-foreground')}>
        {icon ?? (selected ? <CircleCheck className="size-4" /> : <Circle className="size-4" />)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium leading-5">{label}</span>
        <span className="block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}
