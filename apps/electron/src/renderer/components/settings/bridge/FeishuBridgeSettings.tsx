import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { BridgeBinding, BridgeConfig, FeishuBotConfig, FeishuMultiBridgeStatus } from '@kila/shared'
import { Plus, QrCode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { SettingsCard } from '../primitives/SettingsCard'
import { SettingsInput } from '../primitives/SettingsInput'
import { SettingsRow } from '../primitives/SettingsRow'
import { SettingsSection } from '../primitives/SettingsSection'
import { SettingsSegmentedControl } from '../primitives/SettingsSegmentedControl'
import { BridgeAllowlistNotice } from './BridgeAllowlistNotice'
import { BridgeBindingsPanel } from './BridgeBindingsPanel'
import { FeishuBotCard } from './FeishuBotCard'
import { FeishuBridgeGuide } from './FeishuBridgeGuide'
import { FeishuRegisterDialog } from './FeishuRegisterDialog'

type FeishuSettingsTab = 'bots' | 'bindings' | 'guide'

export function FeishuBridgeSettings({
  config,
  bindings,
  sessions,
  onChange,
  onSave,
  onUpdateBinding,
  onUpdateBindingProjectPath,
  onRemoveBinding,
  saving,
}: {
  config: BridgeConfig
  bindings: BridgeBinding[]
  sessions: Array<{ id: string; title: string }>
  onChange: (config: BridgeConfig) => void
  onSave: (config: BridgeConfig) => Promise<void>
  onUpdateBinding: (binding: BridgeBinding) => Promise<void>
  onUpdateBindingProjectPath: (endpointKey: string, projectPath: string) => Promise<void>
  onRemoveBinding: (endpointKey: string) => Promise<void>
  saving: boolean
}): React.ReactElement {
  const { t } = useTranslation()
  const [tab, setTab] = React.useState<FeishuSettingsTab>('bots')
  const [bots, setBots] = React.useState<FeishuBotConfig[]>([])
  const [multiStatus, setMultiStatus] = React.useState<FeishuMultiBridgeStatus>({ bots: {} })
  const [registerOpen, setRegisterOpen] = React.useState(false)

  const updateFeishu = React.useCallback(
    (patch: Partial<BridgeConfig['feishu']>) => {
      onChange({ ...config, feishu: { ...config.feishu, ...patch } })
    },
    [config, onChange],
  )

  const reload = React.useCallback(async (): Promise<void> => {
    const [nextBots, nextStatus] = await Promise.all([
      window.electronAPI.listFeishuBridgeBots(),
      window.electronAPI.getFeishuBridgeMultiStatus(),
    ])
    setBots(nextBots)
    setMultiStatus(nextStatus)
  }, [])

  React.useEffect(() => {
    void reload()
    return window.electronAPI.onFeishuBridgeMultiStatusChanged(setMultiStatus)
  }, [reload])

  const defaultBotName = React.useCallback(
    (index: number): string => t('settingsBridge.feishu.bots.defaultName', { index: index + 1 }),
    [t],
  )

  const createManualBot = React.useCallback(async (): Promise<void> => {
    await window.electronAPI.saveFeishuBridgeBot({
      name: defaultBotName(bots.length),
      enabled: false,
      appId: '',
      appSecret: '',
      defaultSession: config.feishu.defaultSession,
    })
    await reload()
  }, [bots.length, config.feishu.defaultSession, defaultBotName, reload])

  const createFromRegister = React.useCallback(async (result: { appId: string; appSecret: string }): Promise<void> => {
    const saved = await window.electronAPI.saveFeishuBridgeBot({
      name: defaultBotName(bots.length),
      enabled: true,
      appId: result.appId,
      appSecret: result.appSecret,
      defaultSession: config.feishu.defaultSession,
    })
    await reload()
    void window.electronAPI.startFeishuBridgeBot(saved.id).then(reload).catch(() => {})
  }, [bots.length, config.feishu.defaultSession, defaultBotName, reload])

  const feishuBindings = React.useMemo(
    () => bindings.filter((binding) => binding.channelType === 'feishu'),
    [bindings],
  )
  const enabledBots = bots.filter((bot) => bot.enabled && bot.appId)

  return (
    <div className="space-y-6">
      <SettingsSection
        title={t('settingsBridge.feishu.title')}
        description={t('settingsBridge.feishu.description')}
        action={(
          <Button onClick={() => void onSave(config)} disabled={saving}>
            {saving ? t('settingsBridge.common.saving') : t('settingsBridge.feishu.saveGlobal')}
          </Button>
        )}
      >
        <SettingsSegmentedControl
          label={t('settingsBridge.feishu.tabsLabel')}
          value={tab}
          options={[
            { value: 'bots', label: t('settingsBridge.feishu.tabs.bots') },
            { value: 'bindings', label: t('settingsBridge.feishu.tabs.bindings') },
            { value: 'guide', label: t('settingsBridge.feishu.tabs.guide') },
          ]}
          onValueChange={(value) => setTab(value as FeishuSettingsTab)}
        />
      </SettingsSection>

      {tab === 'bots' && (
        <>
          <SettingsCard>
            <SettingsRow label={t('settingsBridge.feishu.enableLabel')}>
              <Switch checked={config.feishu.enabled} onCheckedChange={(checked) => updateFeishu({ enabled: checked })} />
            </SettingsRow>
            <SettingsRow label={t('settingsBridge.feishu.allowP2PLabel')}>
              <Switch checked={config.feishu.allowP2P} onCheckedChange={(checked) => updateFeishu({ allowP2P: checked })} />
            </SettingsRow>
            <SettingsRow label={t('settingsBridge.feishu.allowGroupLabel')}>
              <Switch checked={config.feishu.allowGroup} onCheckedChange={(checked) => updateFeishu({ allowGroup: checked })} />
            </SettingsRow>
            <SettingsRow label={t('settingsBridge.feishu.requireMentionLabel')}>
              <Switch checked={config.feishu.requireMention} onCheckedChange={(checked) => updateFeishu({ requireMention: checked })} />
            </SettingsRow>
          </SettingsCard>

          <SettingsSection
            title={t('settingsBridge.feishu.accessControl.title')}
            description={t('settingsBridge.feishu.accessControl.description')}
          >
            <SettingsCard divided={false}>
              <BridgeAllowlistNotice
                allowedCount={config.feishu.allowedOpenIds.length}
                subject={t('settingsBridge.common.allowlist.subjectOpenId')}
              />
              <SettingsInput
                label={t('settingsBridge.feishu.accessControl.allowedOpenIdsLabel')}
                description={t('settingsBridge.feishu.accessControl.allowedOpenIdsDescription')}
                value={config.feishu.allowedOpenIds.join(', ')}
                onChange={(value) => updateFeishu({
                  allowedOpenIds: value.split(',').map((item) => item.trim()).filter(Boolean),
                })}
                placeholder="ou_xxx, ou_yyy"
              />
              <SettingsInput
                label={t('settingsBridge.feishu.accessControl.allowedChatIdsLabel')}
                description={t('settingsBridge.feishu.accessControl.allowedChatIdsDescription')}
                value={config.feishu.allowedChatIds.join(', ')}
                onChange={(value) => updateFeishu({
                  allowedChatIds: value.split(',').map((item) => item.trim()).filter(Boolean),
                })}
                placeholder="oc_xxx, oc_yyy"
              />
              <SettingsInput
                label={t('settingsBridge.common.maxInboundFileBytesLabel')}
                description={t('settingsBridge.feishu.accessControl.maxInboundFileBytesDescription')}
                value={String(config.feishu.maxInboundFileBytes)}
                onChange={(value) => updateFeishu({ maxInboundFileBytes: Number.parseInt(value, 10) || 0 })}
                placeholder="10485760"
              />
            </SettingsCard>
          </SettingsSection>

          <SettingsSection
            title={t('settingsBridge.feishu.bots.title')}
            description={t('settingsBridge.feishu.bots.description')}
            action={(
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setRegisterOpen(true)}>
                  <QrCode className="mr-1 size-3.5" />
                  {t('settingsBridge.feishu.bots.scanCreate')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void createManualBot()}>
                  <Plus className="mr-1 size-3.5" />
                  {t('settingsBridge.feishu.bots.manualAdd')}
                </Button>
              </div>
            )}
          >
            <FeishuRegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} onSuccess={createFromRegister} />
            {bots.length === 0 ? (
              <SettingsCard>
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {t('settingsBridge.feishu.bots.empty')}
                </div>
              </SettingsCard>
            ) : (
              <div className="space-y-3">
                {bots.map((bot) => (
                  <FeishuBotCard key={bot.id} bot={bot} status={multiStatus.bots[bot.id]} onReload={reload} />
                ))}
              </div>
            )}
          </SettingsSection>

          <SettingsSection
            title={t('settingsBridge.feishu.mirror.title')}
            description={t('settingsBridge.feishu.mirror.description')}
          >
            <SettingsCard>
              <SettingsRow label={t('settingsBridge.feishu.mirror.toggleLabel')}>
                <Switch
                  checked={config.feishu.sessionMirror?.mode === 'stream'}
                  onCheckedChange={(checked) => updateFeishu({
                    sessionMirror: {
                      mode: checked ? 'stream' : 'off',
                      botId: config.feishu.sessionMirror?.botId ?? enabledBots[0]?.id,
                    },
                  })}
                />
              </SettingsRow>
              <div className="px-4 py-3 space-y-2">
                <div className="text-sm font-medium">{t('settingsBridge.feishu.mirror.botLabel')}</div>
                <Select
                  value={config.feishu.sessionMirror?.botId ?? ''}
                  disabled={enabledBots.length === 0}
                  onValueChange={(botId) => updateFeishu({
                    sessionMirror: {
                      mode: config.feishu.sessionMirror?.mode ?? 'stream',
                      botId,
                      targetOpenId: config.feishu.sessionMirror?.targetOpenId,
                    },
                  })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={enabledBots.length === 0
                      ? t('settingsBridge.feishu.mirror.botPlaceholderEmpty')
                      : t('settingsBridge.feishu.mirror.botPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {enabledBots.map((bot) => (
                      <SelectItem key={bot.id} value={bot.id}>{bot.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <SettingsInput
                label={t('settingsBridge.feishu.mirror.targetOpenIdLabel')}
                description={t('settingsBridge.feishu.mirror.targetOpenIdDescription')}
                value={config.feishu.sessionMirror?.targetOpenId ?? ''}
                onChange={(value) => updateFeishu({
                  sessionMirror: {
                    mode: config.feishu.sessionMirror?.mode ?? 'off',
                    botId: config.feishu.sessionMirror?.botId,
                    targetOpenId: value.trim() || undefined,
                  },
                })}
                placeholder="ou_xxx"
              />
            </SettingsCard>
          </SettingsSection>

          <SettingsCard>
            <SettingsRow
              label={t('settingsBridge.feishu.streamingCardsLabel')}
              description={t('settingsBridge.feishu.streamingCardsDescription')}
            >
              <Switch checked={config.feishu.streamingCards ?? true} onCheckedChange={(checked) => updateFeishu({ streamingCards: checked })} />
            </SettingsRow>
            <SettingsInput
              label={t('settingsBridge.feishu.quietWindowLabel')}
              value={String(config.feishu.quietWindowMs ?? 600)}
              onChange={(value) => updateFeishu({ quietWindowMs: Number.parseInt(value, 10) || 0 })}
            />
            <SettingsInput
              label={t('settingsBridge.feishu.maxConcurrentLabel')}
              value={String(config.feishu.maxConcurrent ?? 5)}
              onChange={(value) => updateFeishu({ maxConcurrent: Number.parseInt(value, 10) || 1 })}
            />
          </SettingsCard>
        </>
      )}

      {tab === 'bindings' && (
        <BridgeBindingsPanel
          bindings={feishuBindings}
          sessions={sessions}
          onUpdate={onUpdateBinding}
          onUpdateProjectPath={onUpdateBindingProjectPath}
          onRemove={onRemoveBinding}
        />
      )}

      {tab === 'guide' && <FeishuBridgeGuide />}
    </div>
  )
}
