import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ModelSelector } from '@/components/composer/ModelSelector'
import type { ModelOption } from '@kila/shared'
import { LABEL_CLASS, DESCRIPTION_CLASS } from '../primitives/SettingsUIConstants'
import { cn } from '@/lib/utils'

interface BridgeDefaultModelFieldProps {
  label?: string
  description: string
  value?: {
    channelId?: string
    modelId?: string
  }
  onChange: (value: { channelId?: string; modelId?: string }) => void
  clearLabel?: string
}

export function BridgeDefaultModelField({
  label,
  description,
  value,
  onChange,
  clearLabel,
}: BridgeDefaultModelFieldProps): React.ReactElement {
  const { t } = useTranslation()
  const selectedModel = value?.channelId && value?.modelId
    ? { channelId: value.channelId, modelId: value.modelId }
    : null

  const handleSelect = React.useCallback((option: ModelOption): void => {
    onChange({
      channelId: option.channelId,
      modelId: option.modelId,
    })
  }, [onChange])

  const hasSelection = Boolean(selectedModel)

  return (
    <div className="px-4 py-3 space-y-2">
      <div>
        <div className={LABEL_CLASS}>{label ?? t('settingsBridge.common.defaultModel')}</div>
        <div className={cn(DESCRIPTION_CLASS, 'mt-0.5')}>{description}</div>
      </div>

      <div className="flex items-center gap-2">
        <div className="min-w-0">
          <ModelSelector
            externalSelectedModel={selectedModel}
            onModelSelect={handleSelect}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange({ channelId: undefined, modelId: undefined })}
          disabled={!hasSelection}
        >
          {clearLabel ?? t('settingsBridge.common.clearOverride')}
        </Button>
      </div>
    </div>
  )
}
