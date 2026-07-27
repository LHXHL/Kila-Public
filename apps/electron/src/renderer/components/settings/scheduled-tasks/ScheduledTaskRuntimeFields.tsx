/**
 * ScheduledTaskRuntimeFields - 定时任务的运行时上下文配置
 *
 * 模型、thinking 等级、历史轮数、附加目录、启用工具和权限模式。
 */

import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentToolInfo, KilaPermissionMode, ThinkingLevel } from '@kila/shared'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { SettingsSelect } from '../primitives/SettingsSelect'
import { ModelSelector } from '@/components/composer/ModelSelector'
import { PermissionModeSelector } from '@/components/agent/PermissionModeSelector'
import { FieldGroup } from './editor-primitives'
import { cn } from '@/lib/utils'

/** thinking 等级是产品固定术语，不做翻译 */
const THINKING_OPTIONS: Array<{ value: ThinkingLevel; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
]

interface ScheduledTaskRuntimeFieldsProps {
  tools: AgentToolInfo[]
  modelSelection: { channelId: string; modelId: string } | null
  onModelSelectionChange: (value: { channelId: string; modelId: string }) => void
  thinkingLevel: ThinkingLevel
  onThinkingLevelChange: (value: ThinkingLevel) => void
  historyTurns: string
  onHistoryTurnsChange: (value: string) => void
  additionalDirectories: string
  onAdditionalDirectoriesChange: (value: string) => void
  selectedToolIds: string[]
  onSelectedToolIdsChange: (updater: (prev: string[]) => string[]) => void
  permissionMode: KilaPermissionMode
  onPermissionModeChange: (value: KilaPermissionMode) => void
}

export function ScheduledTaskRuntimeFields({
  tools,
  modelSelection,
  onModelSelectionChange,
  thinkingLevel,
  onThinkingLevelChange,
  historyTurns,
  onHistoryTurnsChange,
  additionalDirectories,
  onAdditionalDirectoriesChange,
  selectedToolIds,
  onSelectedToolIdsChange,
  permissionMode,
  onPermissionModeChange,
}: ScheduledTaskRuntimeFieldsProps): React.ReactElement {
  const { t } = useTranslation()

  return (
    <>
      <FieldGroup label={t('settingsTasks.editor.runtime.modelLabel')}>
        <ModelSelector
          externalSelectedModel={modelSelection}
          onModelSelect={(option) => {
            onModelSelectionChange({ channelId: option.channelId, modelId: option.modelId })
          }}
        />
      </FieldGroup>

      <div className="grid gap-4 md:grid-cols-2">
        <SettingsSelect
          label={t('settingsTasks.editor.runtime.thinkingLabel')}
          value={thinkingLevel}
          onValueChange={(value) => onThinkingLevelChange(value as ThinkingLevel)}
          options={THINKING_OPTIONS}
        />

        <FieldGroup label={t('settingsTasks.editor.runtime.historyTurnsLabel')}>
          <Input value={historyTurns} onChange={(event) => onHistoryTurnsChange(event.target.value)} />
        </FieldGroup>
      </div>

      <FieldGroup
        label={t('settingsTasks.editor.runtime.additionalDirectoriesLabel')}
        description={t('settingsTasks.editor.runtime.additionalDirectoriesDescription')}
      >
        <Textarea
          rows={5}
          value={additionalDirectories}
          onChange={(event) => onAdditionalDirectoriesChange(event.target.value)}
          placeholder={t('settingsTasks.editor.runtime.additionalDirectoriesPlaceholder')}
        />
      </FieldGroup>

      <FieldGroup
        label={t('settingsTasks.editor.runtime.enabledToolsLabel')}
        description={t('settingsTasks.editor.runtime.enabledToolsDescription')}
      >
        <div className="flex flex-wrap gap-2">
          {tools.map((tool) => {
            const active = selectedToolIds.includes(tool.meta.id)
            return (
              <button
                key={tool.meta.id}
                type="button"
                className={cn(
                  'rounded-md border px-2.5 py-1.5 text-xs transition-colors',
                  active
                    ? 'border-[hsl(var(--brand-soft-foreground)/0.18)] bg-brand-soft text-brand-soft-foreground'
                    : 'border-border/60 bg-background/80 text-muted-foreground',
                )}
                onClick={() => {
                  onSelectedToolIdsChange((prev) => (
                    prev.includes(tool.meta.id)
                      ? prev.filter((item) => item !== tool.meta.id)
                      : [...prev, tool.meta.id]
                  ))
                }}
              >
                {tool.meta.name}
              </button>
            )
          })}
        </div>
      </FieldGroup>

      <FieldGroup
        label={t('settingsTasks.editor.runtime.permissionModeLabel')}
        description={t('settingsTasks.editor.runtime.permissionModeDescription')}
      >
        <div className="border-b border-border/45 px-1 py-3 last:border-b-0">
          <PermissionModeSelector value={permissionMode} onChange={onPermissionModeChange} />
          <div className="mt-2 text-xs leading-5 text-muted-foreground">
            {t('settingsTasks.editor.runtime.permissionModeHint')}
          </div>
        </div>
      </FieldGroup>
    </>
  )
}
