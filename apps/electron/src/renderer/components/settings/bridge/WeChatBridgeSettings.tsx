import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type {
  BridgeConfig,
  WeChatBridgeAccountEntry,
  WeChatBridgeAccountStatus,
  WeChatBridgeLoginState,
} from '@kila/shared'
import { ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { SettingsCard } from '../primitives/SettingsCard'
import { SettingsInput } from '../primitives/SettingsInput'
import { SettingsRow } from '../primitives/SettingsRow'
import { SettingsSection } from '../primitives/SettingsSection'
import { BridgeDefaultModelField } from './BridgeDefaultModelField'
import { BridgeAllowlistNotice } from './BridgeAllowlistNotice'
import { getBridgeStatusLabel } from './bridge-labels'

interface WeChatBridgeSettingsProps {
  config: BridgeConfig
  accounts: WeChatBridgeAccountEntry[]
  loginStates: Record<string, WeChatBridgeLoginState>
  accountStatuses: Record<string, WeChatBridgeAccountStatus>
  onChange: (config: BridgeConfig) => void
  onSave: (config: BridgeConfig) => Promise<void>
  onRefresh: () => Promise<void>
  saving: boolean
}

function statusLabel(t: TFunction, status?: WeChatBridgeAccountStatus): string {
  if (!status) return t('settingsBridge.common.status.notStarted')
  const label = getBridgeStatusLabel(t, status.status)
  if (status.errorMessage) return `${label} · ${status.errorMessage}`
  return label
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function QrPreview({ state }: { state: WeChatBridgeLoginState | null }): React.ReactElement | null {
  const { t } = useTranslation()
  if (!state) return null

  if (!state.qrCodeDataUrl) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
        {state.message
          || state.errorMessage
          || t('settingsBridge.wechat.login.statusFallback', { status: state.status })}
      </div>
    )
  }

  if (state.qrCodeDataUrl.startsWith('data:image') || state.qrCodeDataUrl.startsWith('http')) {
    return (
      <img
        className="size-44 rounded-2xl border border-border bg-background object-contain p-3"
        src={state.qrCodeDataUrl}
        alt={t('settingsBridge.wechat.login.qrAlt')}
      />
    )
  }

  return (
    <div className="rounded-2xl border border-dashed border-border px-4 py-6 font-mono text-xs text-muted-foreground">
      {state.qrCodeDataUrl}
    </div>
  )
}

function GuideStep({ index, title, children }: { index: number; title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="grid gap-2 sm:grid-cols-[28px_minmax(0,1fr)]">
      <div className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{index}</div>
      <div>
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="mt-1 text-sm leading-6 text-muted-foreground">{children}</div>
      </div>
    </div>
  )
}

export function WeChatBridgeSettings({
  config,
  accounts,
  loginStates,
  accountStatuses,
  onChange,
  onSave,
  onRefresh,
  saving,
}: WeChatBridgeSettingsProps): React.ReactElement {
  const { t } = useTranslation()
  const [selectedAccountId, setSelectedAccountId] = React.useState<string | null>(accounts[0]?.accountId ?? null)
  const [loginLabel, setLoginLabel] = React.useState('')
  const [activeLoginId, setActiveLoginId] = React.useState<string | null>(null)
  const selectedAccount = accounts.find((account) => account.accountId === selectedAccountId) ?? accounts[0] ?? null
  const activeLoginState = activeLoginId ? loginStates[activeLoginId] ?? null : null

  React.useEffect(() => {
    if (!selectedAccountId && accounts[0]?.accountId) {
      setSelectedAccountId(accounts[0].accountId)
    }
  }, [accounts, selectedAccountId])

  const startLogin = React.useCallback(async () => {
    try {
      const state = await window.electronAPI.startWeChatBridgeLogin({
        label: loginLabel.trim() || undefined,
      })
      setActiveLoginId(state.accountId)
      toast.success(t('settingsBridge.wechat.toast.loginQrCreated'), {
        description: t('settingsBridge.wechat.toast.loginQrCreatedDescription'),
      })
    } catch (error) {
      toast.error(t('settingsBridge.wechat.toast.loginQrFailed'), {
        description: getErrorMessage(error),
      })
    }
  }, [loginLabel, t])

  const refreshLogin = React.useCallback(async () => {
    if (!activeLoginId) return
    try {
      const state = await window.electronAPI.refreshWeChatBridgeLogin(activeLoginId)
      if (state.status === 'confirmed') {
        setActiveLoginId(null)
        setLoginLabel('')
        await onRefresh()
        toast.success(t('settingsBridge.wechat.toast.loggedIn'))
      } else if (state.status === 'expired') {
        setActiveLoginId(null)
        toast.error(t('settingsBridge.wechat.toast.qrExpired'))
      } else if (state.status === 'error') {
        setActiveLoginId(null)
        toast.error(t('settingsBridge.wechat.toast.loginFailed'), {
          description: state.errorMessage || state.message,
        })
      }
    } catch (error) {
      toast.error(t('settingsBridge.wechat.toast.refreshFailed'), {
        description: getErrorMessage(error),
      })
    }
  }, [activeLoginId, onRefresh, t])

  const cancelLogin = React.useCallback(async () => {
    if (!activeLoginId) return
    try {
      await window.electronAPI.cancelWeChatBridgeLogin(activeLoginId)
      setActiveLoginId(null)
      toast.success(t('settingsBridge.wechat.toast.loginCancelled'))
    } catch (error) {
      toast.error(t('settingsBridge.wechat.toast.cancelFailed'), {
        description: getErrorMessage(error),
      })
    }
  }, [activeLoginId, t])

  const startSelectedAccount = React.useCallback(async (): Promise<void> => {
    if (!selectedAccount) return
    try {
      await window.electronAPI.startWeChatBridgeAccount(selectedAccount.accountId)
      await onRefresh()
      toast.success(t('settingsBridge.wechat.toast.accountStarted'), {
        description: selectedAccount.label,
      })
    } catch (error) {
      toast.error(t('settingsBridge.wechat.toast.accountStartFailed'), {
        description: getErrorMessage(error),
      })
    }
  }, [onRefresh, selectedAccount, t])

  const stopSelectedAccount = React.useCallback(async (): Promise<void> => {
    if (!selectedAccount) return
    try {
      await window.electronAPI.stopWeChatBridgeAccount(selectedAccount.accountId)
      await onRefresh()
      toast.success(t('settingsBridge.wechat.toast.accountStopped'), {
        description: selectedAccount.label,
      })
    } catch (error) {
      toast.error(t('settingsBridge.wechat.toast.accountStopFailed'), {
        description: getErrorMessage(error),
      })
    }
  }, [onRefresh, selectedAccount, t])

  const reloginSelectedAccount = React.useCallback(async (): Promise<void> => {
    if (!selectedAccount) return
    try {
      const state = await window.electronAPI.reloginWeChatBridgeAccount(selectedAccount.accountId)
      setActiveLoginId(state.accountId)
      toast.success(t('settingsBridge.wechat.toast.reloginQrCreated'), {
        description: t('settingsBridge.wechat.toast.reloginQrCreatedDescription'),
      })
    } catch (error) {
      toast.error(t('settingsBridge.wechat.toast.reloginFailed'), {
        description: getErrorMessage(error),
      })
    }
  }, [selectedAccount, t])

  const removeSelectedAccount = React.useCallback(async (): Promise<void> => {
    if (!selectedAccount) return
    const confirmed = window.confirm(t('settingsBridge.wechat.toast.removeConfirm', { label: selectedAccount.label }))
    if (!confirmed) return
    try {
      await window.electronAPI.removeWeChatBridgeAccount(selectedAccount.accountId)
      setSelectedAccountId(null)
      await onRefresh()
      toast.success(t('settingsBridge.wechat.toast.accountRemoved'), {
        description: selectedAccount.label,
      })
    } catch (error) {
      toast.error(t('settingsBridge.wechat.toast.accountRemoveFailed'), {
        description: getErrorMessage(error),
      })
    }
  }, [onRefresh, selectedAccount, t])

  React.useEffect(() => {
    if (!activeLoginId) return

    let disposed = false
    const poll = async (): Promise<void> => {
      try {
        const state = await window.electronAPI.refreshWeChatBridgeLogin(activeLoginId)
        if (disposed) return
        if (state.status === 'confirmed') {
          setActiveLoginId(null)
          setLoginLabel('')
          await onRefresh()
          toast.success(t('settingsBridge.wechat.toast.loggedIn'))
        }
        if (state.status === 'expired' || state.status === 'error') {
          setActiveLoginId(null)
          toast.error(state.status === 'expired'
            ? t('settingsBridge.wechat.toast.qrExpired')
            : t('settingsBridge.wechat.toast.loginFailed'), {
            description: state.errorMessage || state.message,
          })
        }
      } catch (error) {
        if (!disposed) {
          setActiveLoginId(null)
          toast.error(t('settingsBridge.wechat.toast.refreshFailed'), {
            description: getErrorMessage(error),
          })
        }
      }
    }

    const timer = window.setInterval(() => {
      void poll()
    }, 2500)
    void poll()

    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [activeLoginId, onRefresh, t])

  return (
    <SettingsSection
      title={t('settingsBridge.wechat.title')}
      description={t('settingsBridge.wechat.description')}
      action={(
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void onRefresh()}>
            {t('settingsBridge.common.refresh')}
          </Button>
          <Button onClick={() => void onSave(config)} disabled={saving}>
            {saving ? t('settingsBridge.common.saving') : t('settingsBridge.common.save')}
          </Button>
        </div>
      )}
    >
      <SettingsCard>
        <SettingsRow
          label={t('settingsBridge.wechat.enableLabel')}
          description={t('settingsBridge.wechat.enableDescription')}
        >
          <Switch
            checked={config.wechat.enabled}
            onCheckedChange={(checked) => onChange({
              ...config,
              wechat: {
                ...config.wechat,
                enabled: checked,
              },
            })}
          />
        </SettingsRow>
        <SettingsInput
          label={t('settingsBridge.wechat.baseUrlLabel')}
          description={t('settingsBridge.wechat.baseUrlDescription')}
          value={config.wechat.baseUrl}
          onChange={(value) => onChange({
            ...config,
            wechat: {
              ...config.wechat,
              baseUrl: value.trim(),
            },
          })}
          placeholder="https://ilinkai.weixin.qq.com"
        />
        <BridgeDefaultModelField
          description={t('settingsBridge.wechat.defaultModelDescription')}
          value={config.wechat.defaultSession}
          onChange={(value) => onChange({
            ...config,
            wechat: {
              ...config.wechat,
              defaultSession: value,
            },
          })}
        />
      </SettingsCard>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <SettingsCard divided={false}>
          <div className="space-y-3 p-4">
            <div>
              <div className="text-sm font-semibold">{t('settingsBridge.wechat.accounts.title')}</div>
              <div className="mt-1 text-xs text-muted-foreground">{t('settingsBridge.wechat.accounts.description')}</div>
            </div>
            {accounts.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                {t('settingsBridge.wechat.accounts.empty')}
              </div>
            )}
            {accounts.map((account) => (
              <button
                key={account.accountId}
                type="button"
                className={`w-full rounded-2xl border px-3 py-3 text-left transition-colors ${
                  selectedAccount?.accountId === account.accountId
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/60'
                }`}
                onClick={() => setSelectedAccountId(account.accountId)}
              >
                <div className="text-sm font-medium">{account.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">{statusLabel(t, accountStatuses[account.accountId])}</div>
                <div className="mt-1 truncate text-[11px] text-muted-foreground">{account.accountId}</div>
              </button>
            ))}
          </div>
        </SettingsCard>

        <div className="space-y-4">
          <SettingsCard divided={false}>
            <div className="grid gap-4 p-4 md:grid-cols-[220px_minmax(0,1fr)]">
              <div className="space-y-3">
                <QrPreview state={activeLoginState} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void startLogin()} disabled={Boolean(activeLoginId)}>
                    {t('settingsBridge.wechat.login.scanLogin')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void refreshLogin()} disabled={!activeLoginId}>
                    {t('settingsBridge.wechat.login.refreshStatus')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void cancelLogin()} disabled={!activeLoginId}>
                    {t('settingsBridge.wechat.login.cancel')}
                  </Button>
                </div>
              </div>
              <div className="space-y-3">
                <SettingsInput
                  label={t('settingsBridge.wechat.login.labelInputLabel')}
                  description={t('settingsBridge.wechat.login.labelInputDescription')}
                  value={loginLabel}
                  onChange={setLoginLabel}
                  placeholder={t('settingsBridge.wechat.login.labelInputPlaceholder')}
                />
                <div className="rounded-2xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                  {t('settingsBridge.wechat.login.storageNotice')}
                </div>
              </div>
            </div>
          </SettingsCard>

          {selectedAccount && (
            <SettingsCard>
              <SettingsRow
                label={selectedAccount.label}
                description={t('settingsBridge.wechat.accounts.meta', {
                  uin: selectedAccount.ilinkUserId || t('settingsBridge.wechat.accounts.unknownUin'),
                  baseUrl: selectedAccount.baseUrl || t('settingsBridge.wechat.accounts.defaultBaseUrl'),
                })}
              >
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => void startSelectedAccount()}>
                    {t('settingsBridge.wechat.accounts.start')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void stopSelectedAccount()}>
                    {t('settingsBridge.wechat.accounts.stop')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void reloginSelectedAccount()}>
                    {t('settingsBridge.wechat.accounts.relogin')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void removeSelectedAccount()}>
                    {t('settingsBridge.wechat.accounts.remove')}
                  </Button>
                </div>
              </SettingsRow>
            </SettingsCard>
          )}
        </div>
      </div>

      <SettingsCard divided={false}>
        <BridgeAllowlistNotice allowedCount={config.wechat.allowedUserIds.length} />
        <SettingsInput
          label={t('settingsBridge.common.allowedUserIdsLabel')}
          description={t('settingsBridge.wechat.allowedUserIdsDescription')}
          value={config.wechat.allowedUserIds.join(', ')}
          onChange={(value) => onChange({
            ...config,
            wechat: {
              ...config.wechat,
              allowedUserIds: value.split(',').map((item) => item.trim()).filter(Boolean),
            },
          })}
          placeholder="wxid_xxx, wxid_yyy"
        />
        <SettingsInput
          label={t('settingsBridge.common.maxInboundFileBytesLabel')}
          description={t('settingsBridge.wechat.maxInboundFileBytesDescription')}
          value={String(config.wechat.maxInboundFileBytes)}
          onChange={(value) => onChange({
            ...config,
            wechat: {
              ...config.wechat,
              maxInboundFileBytes: Number.parseInt(value, 10) || 0,
            },
          })}
          placeholder="26214400"
        />
        <SettingsInput
          label={t('settingsBridge.wechat.aggregateWindowLabel')}
          description={t('settingsBridge.wechat.aggregateWindowDescription')}
          value={String(config.wechat.aggregateWindowMs)}
          onChange={(value) => onChange({
            ...config,
            wechat: {
              ...config.wechat,
              aggregateWindowMs: Number.parseInt(value, 10) || 0,
            },
          })}
        />
        <SettingsInput
          label={t('settingsBridge.wechat.deferredOutboundLabel')}
          description={t('settingsBridge.wechat.deferredOutboundDescription')}
          value={String(config.wechat.deferredOutboundTtlMs)}
          onChange={(value) => onChange({
            ...config,
            wechat: {
              ...config.wechat,
              deferredOutboundTtlMs: Number.parseInt(value, 10) || 0,
            },
          })}
        />
      </SettingsCard>

      <SettingsSection
        title={t('settingsBridge.wechat.guide.title')}
        description={t('settingsBridge.wechat.guide.description')}
      >
        <SettingsCard divided={false}>
          <div className="space-y-5 px-4 py-4">
            <GuideStep index={1} title={t('settingsBridge.wechat.guide.scanTitle')}>
              {t('settingsBridge.wechat.guide.scanBody')}
            </GuideStep>
            <GuideStep index={2} title={t('settingsBridge.wechat.guide.autoConnectTitle')}>
              {t('settingsBridge.wechat.guide.autoConnectBody')}
            </GuideStep>
            <GuideStep index={3} title={t('settingsBridge.wechat.guide.messagingTitle')}>
              {t('settingsBridge.wechat.guide.messagingBody')}
            </GuideStep>
            <GuideStep index={4} title={t('settingsBridge.wechat.guide.approvalTitle')}>
              {t('settingsBridge.wechat.guide.approvalBody')}
            </GuideStep>
            <div className="rounded-lg bg-muted/35 px-3 py-3 text-xs leading-5 text-foreground/80">
              {t('settingsBridge.wechat.guide.baseUrlNoticeBefore')}{' '}
              <button
                type="button"
                className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                onClick={() => { void window.electronAPI.openExternal('https://ilinkai.weixin.qq.com') }}
              >
                {t('settingsBridge.wechat.guide.baseUrlNoticeLink')}
                <ExternalLink className="size-3" />
              </button>
              {t('settingsBridge.wechat.guide.baseUrlNoticeAfter')}
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>
    </SettingsSection>
  )
}
