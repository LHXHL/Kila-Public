import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { BridgeConfig } from '@kila/shared'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { SettingsCard } from '../primitives/SettingsCard'
import { SettingsInput } from '../primitives/SettingsInput'
import { SettingsRow } from '../primitives/SettingsRow'
import { SettingsSecretInput } from '../primitives/SettingsSecretInput'
import { SettingsSection } from '../primitives/SettingsSection'
import { BridgeDefaultModelField } from './BridgeDefaultModelField'
import { BridgeAllowlistNotice } from './BridgeAllowlistNotice'

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
  const { t } = useTranslation()

  return (
    <SettingsSection
      title={t('settingsBridge.common.channel.discord')}
      description={t('settingsBridge.discord.description')}
      action={(
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void onTest('discord', config)} disabled={saving || testing}>
            {testing ? t('settingsBridge.common.testing') : t('settingsBridge.common.test')}
          </Button>
          <Button onClick={() => void onSave(config)} disabled={saving || testing}>
            {saving ? t('settingsBridge.common.saving') : t('settingsBridge.common.save')}
          </Button>
        </div>
      )}
    >
      <SettingsCard>
        <SettingsRow label={t('settingsBridge.discord.enableLabel')}>
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
        <SettingsRow label={t('settingsBridge.discord.requireMentionLabel')}>
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
          label={t('settingsBridge.common.botToken')}
          description={t('settingsBridge.common.botTokenDescription')}
          value={tokenDraft}
          onChange={onTokenDraftChange}
          placeholder={t('settingsBridge.discord.botTokenPlaceholder')}
          hasSavedValue={hasSavedToken}
          onReveal={onRevealToken}
        />
        <BridgeDefaultModelField
          description={t('settingsBridge.common.channelDefaultModelDescription')}
          value={config.discord.defaultSession}
          onChange={(value) => onChange({
            ...config,
            discord: {
              ...config.discord,
              defaultSession: value,
            },
          })}
        />
        <BridgeAllowlistNotice allowedCount={config.discord.allowedUserIds.length} />
        <SettingsInput
          label={t('settingsBridge.common.allowedUserIdsLabel')}
          description={t('settingsBridge.discord.allowedUserIdsDescription')}
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
          label={t('settingsBridge.discord.allowedGuildIdsLabel')}
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
          label={t('settingsBridge.discord.allowedChannelIdsLabel')}
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
          label={t('settingsBridge.common.maxInboundFileBytesLabel')}
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
