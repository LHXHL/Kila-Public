import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { BridgeConfig, BridgeStatus } from '@kila/shared'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { SettingsCard } from '../primitives/SettingsCard'
import { SettingsRow } from '../primitives/SettingsRow'
import { SettingsSection } from '../primitives/SettingsSection'
import { BridgeDefaultModelField } from './BridgeDefaultModelField'
import { getBridgeChannelLabel, getBridgeStatusLabel } from './bridge-labels'

function formatTime(t: TFunction, locale: string, timestamp?: number): string {
  if (!timestamp) return t('settingsBridge.general.neverConnected')
  return new Date(timestamp).toLocaleString(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatRetry(t: TFunction, timestamp?: number, attempt?: number): string | null {
  if (!timestamp || !attempt) return null
  const seconds = Math.max(0, Math.ceil((timestamp - Date.now()) / 1000))
  return t('settingsBridge.general.retryHint', { attempt, seconds })
}

export function BridgeGeneralSettings({
  config,
  status,
  onChange,
  onSave,
  saving,
}: {
  config: BridgeConfig
  status: BridgeStatus
  onChange: (config: BridgeConfig) => void
  onSave: (config: BridgeConfig) => Promise<void>
  saving: boolean
}): React.ReactElement {
  const { t, i18n } = useTranslation()
  const [restarting, setRestarting] = React.useState(false)

  const restartBridge = React.useCallback(async (): Promise<void> => {
    setRestarting(true)
    try {
      await window.electronAPI.restartBridge()
    } finally {
      setRestarting(false)
    }
  }, [])

  return (
    <SettingsSection
      title={t('settingsBridge.general.title')}
      description={t('settingsBridge.general.description')}
      action={(
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => { void restartBridge() }} disabled={restarting || saving}>
            {restarting ? t('settingsBridge.general.restarting') : t('settingsBridge.general.restartNow')}
          </Button>
          <Button onClick={() => void onSave(config)} disabled={saving}>
            {saving ? t('settingsBridge.common.saving') : t('settingsBridge.common.save')}
          </Button>
        </div>
      )}
    >
      <SettingsCard>
        <SettingsRow
          label={t('settingsBridge.general.enableLabel')}
          description={t('settingsBridge.general.enableDescription')}
        >
          <Switch
            checked={config.enabled}
            onCheckedChange={(checked) => onChange({ ...config, enabled: checked })}
          />
        </SettingsRow>
        <SettingsRow
          label={t('settingsBridge.general.autoStartLabel')}
          description={t('settingsBridge.general.autoStartDescription')}
        >
          <Switch
            checked={config.autoStart}
            onCheckedChange={(checked) => onChange({ ...config, autoStart: checked })}
          />
        </SettingsRow>
        <SettingsRow
          label={t('settingsBridge.general.runtimeStatusLabel')}
          description={t('settingsBridge.general.runtimeStatusValue', {
            state: status.running
              ? t('settingsBridge.common.running')
              : t('settingsBridge.common.notRunning'),
            count: status.activeBindings,
          })}
        />
      </SettingsCard>

      {status.lifecycle && status.lifecycle.length > 0 && (
        <SettingsCard divided={false}>
          <div className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">{t('settingsBridge.general.lifecycleTitle')}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{t('settingsBridge.general.lifecycleDescription')}</div>
              </div>
              <span className="rounded-md border border-border/60 bg-muted/35 px-2.5 py-1 text-[11px] text-muted-foreground">
                {t('settingsBridge.general.lifecycleHealthy', {
                  healthy: status.lifecycle.filter((item) => item.healthy).length,
                  total: status.lifecycle.length,
                })}
              </span>
            </div>
            <div className="overflow-hidden rounded-xl border border-border/55">
              {status.lifecycle.map((item) => (
                <div key={item.channel} className="grid grid-cols-[minmax(92px,1fr)_92px_92px_minmax(116px,1fr)] items-center gap-3 border-b border-border/45 px-3 py-2.5 text-xs last:border-b-0">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground">{getBridgeChannelLabel(t, item.channel)}</div>
                    {item.errorMessage && (
                      <div className="mt-0.5 truncate text-[11px] text-destructive">{item.errorMessage}</div>
                    )}
                    {formatRetry(t, item.nextRetryAt, item.retryAttempt) && (
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {formatRetry(t, item.nextRetryAt, item.retryAttempt)}
                      </div>
                    )}
                  </div>
                  <span className={cn(
                    'rounded-md px-2 py-1 text-center text-[11px]',
                    item.enabled ? 'bg-status-success-soft text-status-success-foreground' : 'bg-muted/55 text-muted-foreground',
                  )}>
                    {item.enabled
                      ? t('settingsBridge.general.channelEnabled')
                      : t('settingsBridge.general.channelDisabled')}
                  </span>
                  <span className={cn(
                    'rounded-md px-2 py-1 text-center text-[11px]',
                    item.configured ? 'bg-muted/45 text-foreground/75' : 'bg-destructive/10 text-destructive',
                  )}>
                    {item.configured
                      ? t('settingsBridge.general.channelConfigured')
                      : t('settingsBridge.general.channelNotConfigured')}
                  </span>
                  <div className="min-w-0 text-right text-muted-foreground">
                    <div className={cn('truncate', item.status === 'error' && 'text-destructive', item.status === 'connected' && 'text-status-success-foreground')}>
                      {getBridgeStatusLabel(t, item.status)}
                    </div>
                    <div className="mt-0.5 truncate text-[11px]">{formatTime(t, i18n.language, item.lastConnectedAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SettingsCard>
      )}

      <SettingsCard divided={false}>
        <BridgeDefaultModelField
          label={t('settingsBridge.general.fallbackModelLabel')}
          description={t('settingsBridge.general.fallbackModelDescription')}
          value={config.defaultSession}
          onChange={(value) => onChange({
            ...config,
            defaultSession: {
              ...config.defaultSession,
              ...value,
            },
          })}
        />
      </SettingsCard>
    </SettingsSection>
  )
}
