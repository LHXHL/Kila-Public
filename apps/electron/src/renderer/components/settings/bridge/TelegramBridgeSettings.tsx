import * as React from 'react'
import type { BridgeConfig } from '@kila/shared'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { SettingsCard } from '../primitives/SettingsCard'
import { SettingsInput } from '../primitives/SettingsInput'
import { SettingsRow } from '../primitives/SettingsRow'
import { SettingsSecretInput } from '../primitives/SettingsSecretInput'
import { SettingsSection } from '../primitives/SettingsSection'
import { BridgeDefaultModelField } from './BridgeDefaultModelField'

export function TelegramBridgeSettings({
  config,
  tokenDraft,
  onTokenDraftChange,
  onChange,
  onSave,
  onTest,
  saving,
  testing,
  hasSavedToken,
  onRevealToken,
}: {
  config: BridgeConfig
  tokenDraft: string
  onTokenDraftChange: (value: string) => void
  onChange: (config: BridgeConfig) => void
  onSave: (config: BridgeConfig) => Promise<void>
  onTest: (channel: 'telegram', config: BridgeConfig) => Promise<unknown>
  saving: boolean
  testing: boolean
  hasSavedToken: boolean
  onRevealToken: () => Promise<string>
}): React.ReactElement {
  return (
    <SettingsSection
      title="Telegram"
      description="Telegram 私聊入口。"
      action={(
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void onTest('telegram', config)} disabled={saving || testing}>
            {testing ? '测试中...' : '测试'}
          </Button>
          <Button onClick={() => void onSave(config)} disabled={saving || testing}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </div>
      )}
    >
      <SettingsCard>
        <SettingsRow label="启用 Telegram 远程渠道">
          <Switch
            checked={config.telegram.enabled}
            onCheckedChange={(checked) => onChange({
              ...config,
              telegram: {
                ...config.telegram,
                enabled: checked,
              },
            })}
          />
        </SettingsRow>
      </SettingsCard>
      <SettingsCard divided={false}>
        <SettingsSecretInput
          key={config.telegram.botToken || 'telegram-empty-secret'}
          label="机器人令牌"
          description="留空表示保留当前已保存的令牌。"
          value={tokenDraft}
          onChange={onTokenDraftChange}
          placeholder="123456:AA..."
          hasSavedValue={hasSavedToken}
          onReveal={onRevealToken}
        />
        <BridgeDefaultModelField
          description="该渠道新会话默认使用的模型；未设置时回退到总览配置。"
          value={config.telegram.defaultSession}
          onChange={(value) => onChange({
            ...config,
            telegram: {
              ...config.telegram,
              defaultSession: value,
            },
          })}
        />
        <SettingsInput
          label="允许的用户 ID"
          description="逗号分隔的 Telegram 用户 ID 白名单。"
          value={config.telegram.allowedUserIds.join(', ')}
          onChange={(value) => onChange({
            ...config,
            telegram: {
              ...config.telegram,
              allowedUserIds: value.split(',').map((item) => item.trim()).filter(Boolean),
            },
          })}
          placeholder="1001, 1002"
        />
        <SettingsInput
          label="最大入站文件大小（字节）"
          value={String(config.telegram.maxInboundFileBytes)}
          onChange={(value) => onChange({
            ...config,
            telegram: {
              ...config.telegram,
              maxInboundFileBytes: Number.parseInt(value, 10) || 0,
            },
          })}
          placeholder="10485760"
        />
      </SettingsCard>
    </SettingsSection>
  )
}
