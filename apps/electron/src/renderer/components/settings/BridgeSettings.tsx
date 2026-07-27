import * as React from 'react'
import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { RadioTower, RefreshCw } from 'lucide-react'
import {
  bridgeBindingsAtom,
  bridgeStatusAtom,
  wechatBridgeAccountStatusAtom,
  wechatBridgeAccountsAtom,
  wechatBridgeLoginStateAtom,
} from '@/atoms/bridge-atoms'
import type { BridgeBinding, BridgeChannelType, BridgeConfig, BridgeConfigInput, BridgeStatus, BridgeTestResult } from '@kila/shared'
import { Button } from '@/components/ui/button'
import { SettingsCard } from './primitives/SettingsCard'
import { SettingsSection } from './primitives/SettingsSection'
import { SettingsSegmentedControl } from './primitives/SettingsSegmentedControl'
import { getBridgeChannelLabel } from './bridge/bridge-labels'
import { BridgeBindingsPanel } from './bridge/BridgeBindingsPanel'
import { BridgeGeneralSettings } from './bridge/BridgeGeneralSettings'
import { DiscordBridgeSettings } from './bridge/DiscordBridgeSettings'
import { FeishuBridgeSettings } from './bridge/FeishuBridgeSettings'
import { TelegramBridgeSettings } from './bridge/TelegramBridgeSettings'
import { WeChatBridgeSettings } from './bridge/WeChatBridgeSettings'

type BridgeSettingsTab = 'general' | 'telegram' | 'discord' | 'feishu' | 'wechat' | 'bindings'

const DEFAULT_CONFIG: BridgeConfig = {
  enabled: false,
  autoStart: false,
  defaultSession: {},
  telegram: {
    enabled: false,
    botToken: '',
    allowedUserIds: [],
    maxInboundFileBytes: 10 * 1024 * 1024,
    defaultSession: {},
  },
  discord: {
    enabled: false,
    botToken: '',
    allowedUserIds: [],
    allowedChannelIds: [],
    allowedGuildIds: [],
    requireMention: true,
    maxInboundFileBytes: 10 * 1024 * 1024,
    defaultSession: {},
  },
  feishu: {
    enabled: false,
    appId: '',
    appSecret: '',
    bots: [],
    sessionMirror: { mode: 'off' },
    allowP2P: true,
    allowGroup: true,
    requireMention: true,
    allowedOpenIds: [],
    allowedChatIds: [],
    maxInboundFileBytes: 10 * 1024 * 1024,
    streamingCards: true,
    quietWindowMs: 600,
    maxConcurrent: 5,
    defaultSession: {},
  },
  wechat: {
    enabled: false,
    baseUrl: 'https://ilinkai.weixin.qq.com',
    accountIds: [],
    allowedUserIds: [],
    maxInboundFileBytes: 25 * 1024 * 1024,
    aggregateWindowMs: 1200,
    deferredOutboundTtlMs: 12 * 60 * 60 * 1000,
    contextTtlMs: 24 * 60 * 60 * 1000,
    defaultSession: {},
  },
}

const TAB_VALUES = ['general', 'telegram', 'discord', 'feishu', 'wechat', 'bindings'] as const

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function applyStatus(setStatus: (next: BridgeStatus) => void, nextStatus: BridgeStatus): void {
  setStatus(nextStatus)
}

export function BridgeSettings(): React.ReactElement {
  const { t } = useTranslation()
  const [tab, setTab] = React.useState<BridgeSettingsTab>('general')
  const [config, setConfig] = React.useState<BridgeConfig>(DEFAULT_CONFIG)
  const [bridgeStatus, setBridgeStatus] = useAtom(bridgeStatusAtom)
  const [bindings, setBindings] = useAtom(bridgeBindingsAtom)
  const [wechatAccounts, setWeChatAccounts] = useAtom(wechatBridgeAccountsAtom)
  const [wechatLoginStates, setWeChatLoginStates] = useAtom(wechatBridgeLoginStateAtom)
  const [wechatAccountStatuses, setWeChatAccountStatuses] = useAtom(wechatBridgeAccountStatusAtom)
  const [sessions, setSessions] = React.useState<Array<{ id: string; title: string }>>([])
  const [telegramTokenDraft, setTelegramTokenDraft] = React.useState('')
  const [discordTokenDraft, setDiscordTokenDraft] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [saveState, setSaveState] = React.useState<'idle' | 'saving'>('idle')
  const [testingChannel, setTestingChannel] = React.useState<BridgeChannelType | null>(null)
  const [testResult, setTestResult] = React.useState<BridgeTestResult | null>(null)

  const refresh = React.useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [nextConfig, nextStatus, nextBindings, nextSessions, nextWeChatAccounts] = await Promise.all([
        window.electronAPI.getBridgeConfig(),
        window.electronAPI.getBridgeStatus(),
        window.electronAPI.listBridgeBindings(),
        window.electronAPI.listSessions(),
        window.electronAPI.listWeChatBridgeAccounts(),
      ])

      setConfig(nextConfig)
      setTelegramTokenDraft('')
      setDiscordTokenDraft('')
      applyStatus(setBridgeStatus, nextStatus)
      setBindings(nextBindings)
      setWeChatAccounts(nextWeChatAccounts)
      setSessions(nextSessions.map((session) => ({ id: session.id, title: session.title })))
    } catch (error) {
      console.error('[BridgeSettings] 加载失败:', error)
      toast.error(t('settingsBridge.toast.loadFailed'), {
        description: getErrorMessage(error),
      })
    } finally {
      setLoading(false)
    }
  }, [setBindings, setBridgeStatus, setWeChatAccounts, t])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    return window.electronAPI.onBridgeStatusChanged((nextStatus) => {
      applyStatus(setBridgeStatus, nextStatus)
    })
  }, [setBridgeStatus])

  React.useEffect(() => {
    return window.electronAPI.onWeChatBridgeLoginStateChanged((state) => {
      setWeChatLoginStates((prev) => ({
        ...prev,
        [state.accountId]: state,
      }))
    })
  }, [setWeChatLoginStates])

  React.useEffect(() => {
    return window.electronAPI.onWeChatBridgeAccountStatusChanged((status) => {
      setWeChatAccountStatuses((prev) => ({
        ...prev,
        [status.accountId]: status,
      }))
    })
  }, [setWeChatAccountStatuses])

  const buildConfigInput = React.useCallback((nextConfig: BridgeConfig): BridgeConfigInput => ({
    enabled: nextConfig.enabled,
    autoStart: nextConfig.autoStart,
    defaultSession: nextConfig.defaultSession,
    telegram: {
      ...nextConfig.telegram,
      botToken: telegramTokenDraft,
    },
    discord: {
      ...nextConfig.discord,
      botToken: discordTokenDraft,
    },
    feishu: {
      ...(() => {
        const { bots: _bots, appSecret: _appSecret, ...feishu } = nextConfig.feishu
        return feishu
      })(),
    },
    wechat: nextConfig.wechat,
  }), [discordTokenDraft, telegramTokenDraft])

  const saveConfig = React.useCallback(async (nextConfig: BridgeConfig): Promise<void> => {
    setSaveState('saving')
    try {
      const saved = await window.electronAPI.saveBridgeConfig(buildConfigInput(nextConfig))
      setConfig(saved)
      setTelegramTokenDraft('')
      setDiscordTokenDraft('')
      toast.success(t('settingsBridge.toast.saved'))
      await refresh()
    } catch (error) {
      console.error('[BridgeSettings] 保存失败:', error)
      toast.error(t('settingsBridge.toast.saveFailed'), {
        description: getErrorMessage(error),
      })
    } finally {
      setSaveState('idle')
    }
  }, [buildConfigInput, t])

  const testChannel = React.useCallback(async (channel: BridgeChannelType, nextConfig: BridgeConfig) => {
    setTestingChannel(channel)
    setTestResult(null)

    try {
      const result = await window.electronAPI.testBridgeChannel(channel, buildConfigInput(nextConfig))
      setTestResult(result)

      const channelLabel = getBridgeChannelLabel(t, channel)
      if (result.success) {
        toast.success(t('settingsBridge.toast.testSuccess', { channel: channelLabel }), {
          description: result.message,
        })
      } else {
        toast.error(t('settingsBridge.toast.testFailed', { channel: channelLabel }), {
          description: result.message,
        })
      }

      return result
    } catch (error) {
      const message = getErrorMessage(error)
      const result: BridgeTestResult = {
        channel,
        success: false,
        message,
      }

      setTestResult(result)
      console.error('[BridgeSettings] 测试失败:', error)
      toast.error(t('settingsBridge.toast.testError', { channel: getBridgeChannelLabel(t, channel) }), {
        description: message,
      })
      return result
    } finally {
      setTestingChannel(null)
    }
  }, [buildConfigInput, t])

  const startOrStop = React.useCallback(async (): Promise<void> => {
    if (bridgeStatus.running) {
      await window.electronAPI.stopBridge()
    } else {
      await window.electronAPI.startBridge()
    }
    await refresh()
  }, [bridgeStatus.running, refresh])

  const updateBinding = React.useCallback(async (binding: BridgeBinding): Promise<void> => {
    const updated = await window.electronAPI.updateBridgeBinding({
      endpointKey: binding.endpointKey,
      sessionId: binding.sessionId,
    })
    if (!updated) return
    setBindings((prev) => prev.map((item) => item.endpointKey === updated.endpointKey ? updated : item))
  }, [setBindings])

  const updateBindingProjectPath = React.useCallback(async (endpointKey: string, projectPath: string): Promise<void> => {
    const result = await window.electronAPI.updateBridgeBindingProjectPath(endpointKey, projectPath)
    setBindings((prev) => prev.map((item) => item.endpointKey === result.binding.endpointKey ? result.binding : item))
  }, [setBindings])

  const removeBinding = React.useCallback(async (endpointKey: string): Promise<void> => {
    const removed = await window.electronAPI.removeBridgeBinding(endpointKey)
    if (!removed) return
    setBindings((prev) => prev.filter((item) => item.endpointKey !== endpointKey))
  }, [setBindings])

  const activeTestResult = React.useMemo(() => {
    if (tab !== 'telegram' && tab !== 'discord' && tab !== 'feishu' && tab !== 'wechat') {
      return null
    }

    return testResult?.channel === tab ? testResult : null
  }, [tab, testResult])

  return (
    <div className="space-y-6">
      <SettingsSection
        title={(
          <div className="flex items-center gap-2">
            <RadioTower className="size-4" />
            <span>{t('settingsBridge.title')}</span>
          </div>
        )}
        description={t('settingsBridge.description')}
        action={(
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className="mr-1 size-4" />
              {t('settingsBridge.common.refresh')}
            </Button>
            <Button size="sm" onClick={() => void startOrStop()}>
              {bridgeStatus.running ? t('settingsBridge.common.stop') : t('settingsBridge.common.start')}
            </Button>
          </div>
        )}
      >
        <SettingsSegmentedControl
          label={t('settingsBridge.tabGroupLabel')}
          value={tab}
          options={TAB_VALUES.map((value) => ({ value, label: t(`settingsBridge.tabs.${value}`) }))}
          onValueChange={(value) => setTab(value as BridgeSettingsTab)}
        />
      </SettingsSection>

      {tab === 'general' && (
        <BridgeGeneralSettings
          config={config}
          status={bridgeStatus}
          onChange={setConfig}
          onSave={saveConfig}
          saving={saveState === 'saving'}
        />
      )}

      {activeTestResult && (
        <SettingsCard
          divided={false}
          className={
            activeTestResult.success
              ? 'border-[hsl(var(--status-success)/0.28)] bg-status-success-soft text-status-success-foreground'
              : 'border-destructive/30 bg-destructive/5 text-destructive'
          }
        >
          <div className="p-4 text-sm">
            <div className="font-medium">
              {activeTestResult.success
                ? t('settingsBridge.testResult.success', { channel: getBridgeChannelLabel(t, activeTestResult.channel) })
                : t('settingsBridge.testResult.failure', { channel: getBridgeChannelLabel(t, activeTestResult.channel) })}
            </div>
            <div className="mt-1 text-current/90">{activeTestResult.message}</div>
            {activeTestResult.details && (
              <div className="mt-2 text-xs text-current/80">{activeTestResult.details}</div>
            )}
          </div>
        </SettingsCard>
      )}

      {tab === 'telegram' && (
        <TelegramBridgeSettings
          config={config}
          tokenDraft={telegramTokenDraft}
          onTokenDraftChange={setTelegramTokenDraft}
          onRevealToken={() => window.electronAPI.getBridgeSecret('telegram')}
          onChange={setConfig}
          onSave={saveConfig}
          onTest={testChannel}
          saving={saveState === 'saving'}
          testing={testingChannel === 'telegram'}
          hasSavedToken={!!config.telegram.botToken}
        />
      )}

      {tab === 'discord' && (
        <DiscordBridgeSettings
          config={config}
          tokenDraft={discordTokenDraft}
          onTokenDraftChange={setDiscordTokenDraft}
          onRevealToken={() => window.electronAPI.getBridgeSecret('discord')}
          onChange={setConfig}
          onSave={saveConfig}
          onTest={testChannel}
          saving={saveState === 'saving'}
          testing={testingChannel === 'discord'}
          hasSavedToken={!!config.discord.botToken}
        />
      )}

      {tab === 'feishu' && (
        <FeishuBridgeSettings
          config={config}
          bindings={bindings}
          sessions={sessions}
          onChange={setConfig}
          onSave={saveConfig}
          onUpdateBinding={updateBinding}
          onUpdateBindingProjectPath={updateBindingProjectPath}
          onRemoveBinding={removeBinding}
          saving={saveState === 'saving'}
        />
      )}

      {tab === 'wechat' && (
        <WeChatBridgeSettings
          config={config}
          accounts={wechatAccounts}
          loginStates={wechatLoginStates}
          accountStatuses={wechatAccountStatuses}
          onChange={setConfig}
          onSave={saveConfig}
          onRefresh={refresh}
          saving={saveState === 'saving'}
        />
      )}

      {tab === 'bindings' && (
        <BridgeBindingsPanel
          bindings={bindings}
          sessions={sessions}
          onUpdate={updateBinding}
          onUpdateProjectPath={updateBindingProjectPath}
          onRemove={removeBinding}
        />
      )}
    </div>
  )
}
