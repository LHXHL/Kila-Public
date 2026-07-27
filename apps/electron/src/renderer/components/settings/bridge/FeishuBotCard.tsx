/**
 * FeishuBotCard - 单个飞书机器人配置卡片
 *
 * 负责机器人凭证、默认模型、跳过权限确认开关和运行时启停。
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { toast } from 'sonner'
import type { FeishuBotBridgeStatus, FeishuBotConfig } from '@kila/shared'
import { Loader2, Power, PowerOff, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { SettingsCard } from '../primitives/SettingsCard'
import { SettingsInput } from '../primitives/SettingsInput'
import { SettingsRow } from '../primitives/SettingsRow'
import { SettingsSecretInput } from '../primitives/SettingsSecretInput'
import { BridgeDefaultModelField } from './BridgeDefaultModelField'
import { getStatusToneClasses } from '@/lib/theme/status-tone'

function statusLabel(t: TFunction, status?: FeishuBotBridgeStatus): string {
  if (!status) return t('settingsBridge.common.status.notStarted')
  switch (status.status) {
    case 'connected':
      return t('settingsBridge.common.status.connected')
    case 'connecting':
      return t('settingsBridge.common.status.connecting')
    case 'error':
      return t('settingsBridge.common.status.error')
    default:
      return t('settingsBridge.common.status.disconnected')
  }
}

function statusTone(status?: FeishuBotBridgeStatus): string {
  if (!status) return getStatusToneClasses('neutral').subtleSurface
  if (status.status === 'connected') return getStatusToneClasses('success').subtleSurface
  if (status.status === 'connecting') return getStatusToneClasses('warning').subtleSurface
  if (status.status === 'error') return getStatusToneClasses('danger').subtleSurface
  return getStatusToneClasses('neutral').subtleSurface
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function FeishuBotCard({
  bot,
  status,
  onReload,
}: {
  bot: FeishuBotConfig
  status?: FeishuBotBridgeStatus
  onReload: () => Promise<void>
}): React.ReactElement {
  const { t } = useTranslation()
  const [expanded, setExpanded] = React.useState(!bot.appId)
  const [name, setName] = React.useState(bot.name)
  const [enabled, setEnabled] = React.useState(bot.enabled)
  const [appId, setAppId] = React.useState(bot.appId)
  const [appSecret, setAppSecret] = React.useState('')
  const [autoApprove, setAutoApprove] = React.useState(bot.autoApprove ?? false)
  const [busy, setBusy] = React.useState(false)

  const isRunning = status?.status === 'connected' || status?.status === 'connecting'

  const save = React.useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      await window.electronAPI.saveFeishuBridgeBot({
        id: bot.id,
        name,
        enabled,
        appId,
        appSecret,
        autoApprove,
        defaultSession: bot.defaultSession,
      })
      setAppSecret('')
      toast.success(t('settingsBridge.feishu.bots.toast.saved'))
      await onReload()
    } catch (error) {
      toast.error(t('settingsBridge.feishu.bots.toast.saveFailed'), { description: getErrorMessage(error) })
    } finally {
      setBusy(false)
    }
  }, [appId, appSecret, autoApprove, bot.defaultSession, bot.id, enabled, name, onReload, t])

  const toggleRuntime = React.useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      if (isRunning) {
        await window.electronAPI.stopFeishuBridgeBot(bot.id)
      } else {
        await window.electronAPI.startFeishuBridgeBot(bot.id)
      }
      await onReload()
    } catch (error) {
      toast.error(t('settingsBridge.feishu.bots.toast.toggleFailed'), { description: getErrorMessage(error) })
    } finally {
      setBusy(false)
    }
  }, [bot.id, isRunning, onReload, t])

  const test = React.useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.electronAPI.testFeishuBridgeBot(bot.id)
      if (result.success) {
        toast.success(t('settingsBridge.feishu.bots.toast.testSuccess'), { description: result.message })
      } else {
        toast.error(t('settingsBridge.feishu.bots.toast.testFailed'), { description: result.message })
      }
    } catch (error) {
      toast.error(t('settingsBridge.feishu.bots.toast.testError'), { description: getErrorMessage(error) })
    } finally {
      setBusy(false)
    }
  }, [bot.id, t])

  const remove = React.useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      await window.electronAPI.removeFeishuBridgeBot(bot.id)
      toast.success(t('settingsBridge.feishu.bots.toast.removed'))
      await onReload()
    } catch (error) {
      toast.error(t('settingsBridge.feishu.bots.toast.removeFailed'), { description: getErrorMessage(error) })
    } finally {
      setBusy(false)
    }
  }, [bot.id, onReload, t])

  return (
    <SettingsCard divided={false}>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <button type="button" className="min-w-0 text-left" onClick={() => setExpanded((value) => !value)}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{bot.name || t('settingsBridge.feishu.bots.unnamed')}</span>
            <Badge variant="outline" className={statusTone(status)}>{statusLabel(t, status)}</Badge>
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {bot.appId || t('settingsBridge.feishu.bots.noAppId')}
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {bot.appId && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void toggleRuntime()}>
              {isRunning ? <PowerOff className="mr-1 size-3.5" /> : <Power className="mr-1 size-3.5" />}
              {isRunning ? t('settingsBridge.common.stop') : t('settingsBridge.common.start')}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setExpanded((value) => !value)}>
            {expanded
              ? t('settingsBridge.feishu.bots.collapse')
              : t('settingsBridge.feishu.bots.configure')}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border/60 py-2">
          <SettingsRow label={t('settingsBridge.feishu.bots.enableLabel')}>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </SettingsRow>
          <SettingsInput
            label={t('settingsBridge.feishu.bots.nameLabel')}
            value={name}
            onChange={setName}
            placeholder={t('settingsBridge.feishu.bots.namePlaceholder')}
          />
          <SettingsInput
            label={t('settingsBridge.feishu.bots.appIdLabel')}
            value={appId}
            onChange={setAppId}
            placeholder="cli_xxxxx"
          />
          <SettingsSecretInput
            label={t('settingsBridge.feishu.bots.appSecretLabel')}
            description={t('settingsBridge.feishu.bots.appSecretDescription')}
            value={appSecret}
            onChange={setAppSecret}
            hasSavedValue={!!bot.appSecret}
            onReveal={() => window.electronAPI.getFeishuBridgeBotSecret(bot.id)}
            placeholder={t('settingsBridge.feishu.bots.appSecretPlaceholder')}
          />
          <BridgeDefaultModelField
            description={t('settingsBridge.feishu.bots.defaultModelDescription')}
            value={bot.defaultSession}
            onChange={(value) => {
              void window.electronAPI.saveFeishuBridgeBot({
                id: bot.id,
                name,
                enabled,
                appId,
                appSecret,
                autoApprove,
                defaultSession: value,
              }).then(onReload)
            }}
          />
          <SettingsRow
            label={t('settingsBridge.feishu.bots.autoApproveLabel')}
            description={t('settingsBridge.feishu.bots.autoApproveDescription')}
          >
            <Switch checked={autoApprove} onCheckedChange={setAutoApprove} />
          </SettingsRow>
          {autoApprove && (
            <div className="mx-4 mb-3 rounded-lg bg-destructive/10 px-3 py-2.5 text-xs text-destructive shadow-sm">
              {t('settingsBridge.feishu.bots.autoApproveWarning')}
            </div>
          )}
          {status?.errorMessage && (
            <div className="px-4 py-2 text-sm text-destructive">{status.errorMessage}</div>
          )}
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <Button variant="outline" size="sm" disabled={busy || !name.trim()} onClick={() => void save()}>
              {busy && <Loader2 className="mr-1 size-3.5 animate-spin" />}
              {t('settingsBridge.feishu.bots.saveConfig')}
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={busy || !bot.appId} onClick={() => void test()}>
                {t('settingsBridge.feishu.bots.testConnection')}
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove()}>
                <Trash2 className="mr-1 size-3.5" />
                {t('settingsBridge.common.delete')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </SettingsCard>
  )
}
