import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { BridgeBinding } from '@kila/shared'
import { FolderOpen, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SettingsCard } from '../primitives/SettingsCard'
import { SettingsSection } from '../primitives/SettingsSection'
import { getBridgeChannelLabel } from './bridge-labels'

export function BridgeBindingsPanel({
  bindings,
  sessions,
  onUpdate,
  onUpdateProjectPath,
  onRemove,
}: {
  bindings: BridgeBinding[]
  sessions: Array<{ id: string; title: string }>
  onUpdate: (binding: BridgeBinding) => Promise<void>
  onUpdateProjectPath: (endpointKey: string, projectPath: string) => Promise<void>
  onRemove: (endpointKey: string) => Promise<void>
}): React.ReactElement {
  const { t } = useTranslation()

  return (
    <SettingsSection
      title={t('settingsBridge.bindings.title')}
      description={t('settingsBridge.bindings.description')}
    >
      <div className="space-y-3">
        {bindings.length === 0 && (
          <SettingsCard>
            <div className="px-4 py-3 text-sm text-muted-foreground">
              {t('settingsBridge.bindings.empty')}
            </div>
          </SettingsCard>
        )}

        {bindings.map((binding) => (
          <SettingsCard key={binding.endpointKey} divided={false}>
            <div className="flex items-center justify-between px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{binding.displayName ?? binding.endpointKey}</div>
                <div className="text-xs text-muted-foreground">
                  {t('settingsBridge.bindings.endpointMeta', {
                    channel: getBridgeChannelLabel(t, binding.channelType),
                    endpoint: binding.endpointKey,
                  })}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void onRemove(binding.endpointKey)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            <div className="space-y-2 px-4 pb-4">
              <Select
                value={binding.sessionId}
                onValueChange={(sessionId) => void onUpdate({ ...binding, sessionId })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('settingsBridge.bindings.selectSession')} />
                </SelectTrigger>
                <SelectContent>
                  {sessions.map((session) => (
                    <SelectItem key={session.id} value={session.id}>
                      {session.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <div className="text-xs text-muted-foreground min-w-0 flex-1 truncate">
                  {binding.projectPath ?? t('settingsBridge.bindings.noProjectPath')}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={async () => {
                    const result = await window.electronAPI.openFolderDialog()
                    if (result) {
                      await onUpdateProjectPath(binding.endpointKey, result.path)
                    }
                  }}
                >
                  <FolderOpen className="mr-1 size-3.5" />
                  {binding.projectPath
                    ? t('settingsBridge.bindings.changeFolder')
                    : t('settingsBridge.bindings.bindFolder')}
                </Button>
              </div>
            </div>
          </SettingsCard>
        ))}
      </div>
    </SettingsSection>
  )
}
