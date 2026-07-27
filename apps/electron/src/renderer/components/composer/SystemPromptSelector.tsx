import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollText } from 'lucide-react'
import type { CustomSystemPrompt } from '@kila/shared'
import { useSessionSystemPromptPreference } from '@/hooks/useSessionPreferences'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ToolbarHoverPopover } from './ToolbarHoverPopover'

interface SystemPromptSelectorProps {
  buttonClassName?: string
  iconClassName?: string
}

export function SystemPromptSelector({
  buttonClassName,
  iconClassName,
}: SystemPromptSelectorProps = {}): React.ReactElement {
  const { t } = useTranslation()
  const [systemPromptId, setSystemPromptId] = useSessionSystemPromptPreference()
  const [prompts, setPrompts] = React.useState<CustomSystemPrompt[]>([])
  const [loaded, setLoaded] = React.useState(false)

  const loadPrompts = React.useCallback(async () => {
    try {
      const state = await window.electronAPI.getSystemPromptState()
      setPrompts(state.prompts)
      setLoaded(true)
    } catch (error) {
      console.error('[SystemPromptSelector] 加载 prompt 列表失败:', error)
    }
  }, [])

  React.useEffect(() => {
    void loadPrompts()
  }, [loadPrompts])

  const handleOpenChange = React.useCallback((open: boolean) => {
    if (open) void loadPrompts()
  }, [loadPrompts])

  const activePrompt = prompts.find((p) => p.id === systemPromptId)
  const hasOverride = Boolean(systemPromptId)
  const tooltipText = activePrompt ? t('composer.systemPromptLabel', { name: activePrompt.name }) : t('composer.systemPromptDefaultLabel')

  return (
    <ToolbarHoverPopover
      contentClassName="w-64 p-0"
      onOpenChange={handleOpenChange}
      disabled={!loaded || prompts.length === 0}
      trigger={({ open, triggerProps }) => (
        <Button
          {...triggerProps}
          type="button"
          variant="ghost"
          size="icon"
          aria-label={tooltipText}
          className={cn(
            'transition-colors duration-200',
            buttonClassName ?? 'size-[30px] rounded-lg',
            hasOverride
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            open && 'ring-1 ring-border/50',
          )}
        >
          <ScrollText className={cn(iconClassName ?? 'size-5')} />
        </Button>
      )}
    >
      {({ close }) => (
        <div className="space-y-1 p-2">
          <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('composer.systemPrompt')}
          </div>

          <button
            type="button"
            onClick={() => {
              setSystemPromptId(null)
              close()
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition-colors',
              !hasOverride ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50',
            )}
          >
            <span className="min-w-0 flex-1 truncate">{t('common.default')}</span>
          </button>

          {prompts.map((prompt) => {
            const isSelected = prompt.id === systemPromptId
            return (
              <button
                key={prompt.id}
                type="button"
                onClick={() => {
                  setSystemPromptId(prompt.id)
                  close()
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition-colors',
                  isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50',
                )}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{prompt.name}</span>
              </button>
            )
          })}
        </div>
      )}
    </ToolbarHoverPopover>
  )
}
