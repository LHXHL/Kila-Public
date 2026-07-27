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
  const { t } = useTranslation()

  return (
    <SettingsSection
      title={t('settingsBridge.common.channel.telegram')}
      description={t('settingsBridge.telegram.description')}
      action={(
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void onTest('telegram', config)} disabled={saving || testing}>
            {testing ? t('settingsBridge.common.testing') : t('settingsBridge.common.test')}
          </Button>
          <Button onClick={() => void onSave(config)} disabled={saving || testing}>
            {saving ? t('settingsBridge.common.saving') : t('settingsBridge.common.save')}
          </Button>
        </div>
      )}
    >
      <SettingsCard>
        <SettingsRow label={t('settingsBridge.telegram.enableLabel')}>
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
          label={t('settingsBridge.common.botToken')}
          description={t('settingsBridge.common.botTokenDescription')}
          value={tokenDraft}
          onChange={onTokenDraftChange}
          placeholder="123456:AA..."
          hasSavedValue={hasSavedToken}
          onReveal={onRevealToken}
        />
        <BridgeDefaultModelField
          description={t('settingsBridge.common.channelDefaultModelDescription')}
          value={config.telegram.defaultSession}
          onChange={(value) => onChange({
            ...config,
            telegram: {
              ...config.telegram,
              defaultSession: value,
            },
          })}
        />
        <BridgeAllowlistNotice allowedCount={config.telegram.allowedUserIds.length} />
        <SettingsInput
          label={t('settingsBridge.common.allowedUserIdsLabel')}
          description={t('settingsBridge.telegram.allowedUserIdsDescription')}
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
          label={t('settingsBridge.common.maxInboundFileBytesLabel')}
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
