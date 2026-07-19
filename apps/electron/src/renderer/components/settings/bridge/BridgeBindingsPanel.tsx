import * as React from 'react'
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

const CHANNEL_LABELS: Record<BridgeBinding['channelType'], string> = {
  telegram: 'Telegram',
  discord: 'Discord',
  feishu: '飞书',
  wechat: '微信',
}

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
  return (
    <SettingsSection
      title="绑定管理"
      description="远程聊天入口到 Kila 会话的绑定关系。"
    >
      <div className="space-y-3">
        {bindings.length === 0 && (
          <SettingsCard>
            <div className="px-4 py-3 text-sm text-muted-foreground">
              当前还没有任何远程渠道绑定。
            </div>
          </SettingsCard>
        )}

        {bindings.map((binding) => (
          <SettingsCard key={binding.endpointKey} divided={false}>
            <div className="flex items-center justify-between px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{binding.displayName ?? binding.endpointKey}</div>
                <div className="text-xs text-muted-foreground">
                  {CHANNEL_LABELS[binding.channelType]} · 入口 {binding.endpointKey}
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
                  <SelectValue placeholder="选择会话" />
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
                  {binding.projectPath ?? '未绑定工作目录'}
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
                  {binding.projectPath ? '更换' : '绑定'}
                </Button>
              </div>
            </div>
          </SettingsCard>
        ))}
      </div>
    </SettingsSection>
  )
}
