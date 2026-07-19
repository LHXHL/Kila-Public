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

export function DiscordBridgeSettings({
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
  onTest: (channel: 'discord', config: BridgeConfig) => Promise<unknown>
  saving: boolean
  testing: boolean
  hasSavedToken: boolean
  onRevealToken: () => Promise<string>
}): React.ReactElement {
  return (
    <SettingsSection
      title="Discord"
      description="Discord 私聊和服务器/频道白名单入口。"
      action={(
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void onTest('discord', config)} disabled={saving || testing}>
            {testing ? '测试中...' : '测试'}
          </Button>
          <Button onClick={() => void onSave(config)} disabled={saving || testing}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </div>
      )}
    >
      <SettingsCard>
        <SettingsRow label="启用 Discord 远程渠道">
          <Switch
            checked={config.discord.enabled}
            onCheckedChange={(checked) => onChange({
              ...config,
              discord: {
                ...config.discord,
                enabled: checked,
              },
            })}
          />
        </SettingsRow>
        <SettingsRow label="服务器频道要求 @ 提及机器人">
          <Switch
            checked={config.discord.requireMention}
            onCheckedChange={(checked) => onChange({
              ...config,
              discord: {
                ...config.discord,
                requireMention: checked,
              },
            })}
          />
        </SettingsRow>
      </SettingsCard>
      <SettingsCard divided={false}>
        <SettingsSecretInput
          key={config.discord.botToken || 'discord-empty-secret'}
          label="机器人令牌"
          description="留空表示保留当前已保存的令牌。"
          value={tokenDraft}
          onChange={onTokenDraftChange}
          placeholder="Discord 机器人令牌"
          hasSavedValue={hasSavedToken}
          onReveal={onRevealToken}
        />
        <BridgeDefaultModelField
          description="该渠道新会话默认使用的模型；未设置时回退到总览配置。"
          value={config.discord.defaultSession}
          onChange={(value) => onChange({
            ...config,
            discord: {
              ...config.discord,
              defaultSession: value,
            },
          })}
        />
        <SettingsInput
          label="允许的用户 ID"
          value={config.discord.allowedUserIds.join(', ')}
          onChange={(value) => onChange({
            ...config,
            discord: {
              ...config.discord,
              allowedUserIds: value.split(',').map((item) => item.trim()).filter(Boolean),
            },
          })}
          placeholder="2001, 2002"
        />
        <SettingsInput
          label="允许的服务器 ID"
          value={config.discord.allowedGuildIds.join(', ')}
          onChange={(value) => onChange({
            ...config,
            discord: {
              ...config.discord,
              allowedGuildIds: value.split(',').map((item) => item.trim()).filter(Boolean),
            },
          })}
          placeholder="4001, 4002"
        />
        <SettingsInput
          label="允许的频道 ID"
          value={config.discord.allowedChannelIds.join(', ')}
          onChange={(value) => onChange({
            ...config,
            discord: {
              ...config.discord,
              allowedChannelIds: value.split(',').map((item) => item.trim()).filter(Boolean),
            },
          })}
          placeholder="3001, 3002"
        />
        <SettingsInput
          label="最大入站文件大小（字节）"
          value={String(config.discord.maxInboundFileBytes)}
          onChange={(value) => onChange({
            ...config,
            discord: {
              ...config.discord,
              maxInboundFileBytes: Number.parseInt(value, 10) || 0,
            },
          })}
          placeholder="10485760"
        />
      </SettingsCard>
    </SettingsSection>
  )
}
