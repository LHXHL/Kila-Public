/**
 * ChannelSettings - 渠道配置页
 *
 * 单一 Session 模式下只保留“供应商管理”：
 * - 管理所有供应商连接
 * - 启用后的渠道会直接出现在会话输入框模型选择器里
 * - 全局 `agentChannelId / agentModelId` 仅作为最近一次默认选择持久化
 * - 后台轻任务的专用模型配置已迁到通用设置页
 * - 左侧列表把“已保存供应商 + 预设模板”混排到同一层级中
 */

import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Activity, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PROVIDER_LABELS } from '@kila/shared'
import type { Channel } from '@kila/shared'
import { getChannelLogo, getProviderLogo, getProviderLogoResolved, isOpenAIChannelLogo } from '@/lib/model-logo'
import { agentChannelIdAtom, agentModelIdAtom } from '@/atoms/agent-atoms'
import { cn } from '@/lib/utils'
import { SettingsSection } from './primitives'
import ChannelForm from './ChannelForm'
import {
  CHANNEL_PRESETS,
  dbSummaryToPreset,
  type ChannelPreset,
  type ProviderDbSummary,
} from './channel-presets'
import { EntityMetadataChip } from '@/components/ui/entity-metadata-chip'
import { WorkspaceEntityRow } from '@/components/ui/workspace-entity-row'
import { settingsDirtyAtom } from '@/atoms/settings-tab'
import { toast } from 'sonner'

interface ChannelSelection {
  channelId: string
  modelId?: string
}

type ChannelListEntry =
  | { kind: 'channel'; id: string; searchText: string; channel: Channel }
  | { kind: 'preset'; id: string; searchText: string; preset: ChannelPreset }

function resolveChannelSelection(
  channels: Channel[],
  currentChannelId: string | null,
  currentModelId: string | null,
): ChannelSelection | null {
  const enabledChannels = channels.filter((channel) => channel.enabled)
  if (enabledChannels.length === 0) {
    return null
  }

  const preferredChannel = currentChannelId
    ? enabledChannels.find((channel) => channel.id === currentChannelId)
    : null
  const channel = preferredChannel
    ?? enabledChannels.find((candidate) => candidate.models.some((model) => model.enabled))
    ?? enabledChannels[0]

  if (!channel) {
    return null
  }

  const preferredModel = currentModelId
    ? channel.models.find((model) => model.id === currentModelId && model.enabled)
    : null
  const model = preferredModel ?? channel.models.find((candidate) => candidate.enabled)

  return {
    channelId: channel.id,
    modelId: model?.id,
  }
}

function buildPresetSearchText(preset: ChannelPreset): string {
  return [
    preset.name,
    PROVIDER_LABELS[preset.provider],
    ...(preset.searchTerms ?? []),
  ].join(' ').toLowerCase()
}

export function ChannelSettings(): React.ReactElement {
  const { t } = useTranslation()
  const [channels, setChannels] = React.useState<Channel[]>([])
  const [dbPresets, setDbPresets] = React.useState<ChannelPreset[]>([])
  const [dbLoading, setDbLoading] = React.useState(true)
  const [selectedChannelId, setSelectedChannelId] = React.useState<string | null>(null)
  const [selectedPresetId, setSelectedPresetId] = React.useState<string | null>(null)
  const [isCreating, setIsCreating] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [formDirty, setFormDirty] = React.useState(false)
  const setSettingsDirty = useSetAtom(settingsDirtyAtom)
  const [doctorRunningId, setDoctorRunningId] = React.useState<string | null>(null)
  const [doctorResult, setDoctorResult] = React.useState<{
    channelId: string
    ok: boolean
    lines: string[]
  } | null>(null)
  const [agentChannelId, setAgentChannelId] = useAtom(agentChannelIdAtom)
  const [agentModelId, setAgentModelId] = useAtom(agentModelIdAtom)
  const draftOriginChannelIdRef = React.useRef<string | null>(null)

  const confirmDiscardDraft = React.useCallback((): boolean => (
    !formDirty || window.confirm(t('settings.channel.discardConfirm'))
  ), [formDirty, t])

  const handleFormDirtyChange = React.useCallback((dirty: boolean): void => {
    setFormDirty(dirty)
    setSettingsDirty(dirty)
  }, [setSettingsDirty])

  React.useEffect(() => () => setSettingsDirty(false), [setSettingsDirty])

  // DB 预设加载（与渠道列表并行）
  React.useEffect(() => {
    let cancelled = false
    window.electronAPI.listProviderDbSummaries()
      .then((summaries: ProviderDbSummary[]) => {
        if (cancelled) return
        // 过滤掉已经作为快捷预设存在的头部 provider（避免 anthropic/openai/google 重复）
        const builtinIds = new Set(CHANNEL_PRESETS.map((p) => p.capabilityProviderId))
        const filtered = summaries
          .filter((s) => !builtinIds.has(s.id))
          .map((summary) => dbSummaryToPreset(summary, t))
        // 按字母排序
        filtered.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
        setDbPresets(filtered)
      })
      .catch((error) => {
        console.error('[供应商设置] 加载 Provider DB 失败:', error)
      })
      .finally(() => {
        if (!cancelled) setDbLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const allPresets = React.useMemo(
    () => [...CHANNEL_PRESETS, ...dbPresets],
    [dbPresets],
  )

  const syncDefaultSelection = React.useCallback(async (nextChannels: Channel[]): Promise<void> => {
    const nextSelection = resolveChannelSelection(nextChannels, agentChannelId, agentModelId)

    if (!nextSelection) {
      if (agentChannelId !== null || agentModelId !== null) {
        setAgentChannelId(null)
        setAgentModelId(null)
        await window.electronAPI.updateSettings({
          agentChannelId: undefined,
          agentModelId: undefined,
        })
      }
      return
    }

    if (agentChannelId === nextSelection.channelId && agentModelId === (nextSelection.modelId ?? null)) {
      return
    }

    setAgentChannelId(nextSelection.channelId)
    setAgentModelId(nextSelection.modelId ?? null)
    await window.electronAPI.updateSettings({
      agentChannelId: nextSelection.channelId,
      agentModelId: nextSelection.modelId,
    })
  }, [agentChannelId, agentModelId, setAgentChannelId, setAgentModelId])

  const loadChannels = React.useCallback(async (): Promise<Channel[] | null> => {
    setLoading(true)
    setLoadError(null)
    try {
      const list = await window.electronAPI.listChannels()
      setChannels(list)
      return list
    } catch (error) {
      console.error('[供应商设置] 加载供应商列表失败:', error)
      setLoadError(error instanceof Error ? error.message : t('settings.channel.loadFailed'))
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    loadChannels()
      .then((list) => {
        if (list) void syncDefaultSelection(list)
      })
      .catch(console.error)
  }, [loadChannels, syncDefaultSelection])

  React.useEffect(() => {
    if (isCreating || selectedPresetId) {
      return
    }

    if (channels.length === 0) {
      if (selectedChannelId !== null) {
        setSelectedChannelId(null)
      }
      return
    }

    if (selectedChannelId && channels.some((channel) => channel.id === selectedChannelId)) {
      return
    }

    setSelectedChannelId(channels[0]?.id ?? null)
  }, [channels, isCreating, selectedChannelId, selectedPresetId])

  const openBlankDraft = React.useCallback(() => {
    if (!confirmDiscardDraft()) return
    draftOriginChannelIdRef.current = selectedChannelId
    setSelectedPresetId(null)
    setSelectedChannelId(null)
    setIsCreating(true)
  }, [confirmDiscardDraft, selectedChannelId])

  const openPresetDraft = React.useCallback((presetId: string) => {
    if (!confirmDiscardDraft()) return
    draftOriginChannelIdRef.current = selectedChannelId
    setSelectedPresetId(presetId)
    setSelectedChannelId(null)
    setIsCreating(true)
  }, [confirmDiscardDraft, selectedChannelId])



  const handleSelectChannel = React.useCallback((channelId: string) => {
    if (channelId === selectedChannelId && !isCreating) return
    if (!confirmDiscardDraft()) return
    setSelectedPresetId(null)
    setSelectedChannelId(channelId)
    setIsCreating(false)
  }, [confirmDiscardDraft, isCreating, selectedChannelId])

  const handleDelete = async (channel: Channel): Promise<void> => {
    if (!confirmDiscardDraft()) return
    if (!confirm(t('settings.channel.deleteConfirm', { name: channel.name }))) return

    try {
      await window.electronAPI.deleteChannel(channel.id)
      const loadedChannels = await loadChannels()
      const updatedChannels = loadedChannels ?? channels.filter((item) => item.id !== channel.id)
      if (!loadedChannels) setChannels(updatedChannels)
      if (selectedChannelId === channel.id && !isCreating) {
        setSelectedChannelId(updatedChannels[0]?.id ?? null)
      }
      await syncDefaultSelection(updatedChannels)
    } catch (error) {
      console.error('[供应商设置] 删除供应商失败:', error)
      toast.error(t('settings.channel.deleteFailed'))
    }
  }

  const handleToggle = async (channel: Channel): Promise<void> => {
    try {
      await window.electronAPI.updateChannel(channel.id, { enabled: !channel.enabled })
      const loadedChannels = await loadChannels()
      const updatedChannels = loadedChannels ?? channels.map((item) => (
        item.id === channel.id ? { ...item, enabled: !item.enabled } : item
      ))
      if (!loadedChannels) setChannels(updatedChannels)
      await syncDefaultSelection(updatedChannels)
    } catch (error) {
      console.error('[供应商设置] 切换供应商状态失败:', error)
      toast.error(t('settings.channel.toggleFailed'))
    }
  }

  const runProviderDoctor = async (channel: Channel): Promise<void> => {
    setDoctorRunningId(channel.id)
    setDoctorResult(null)

    try {
      const enabledModels = channel.models.filter((model) => model.enabled)
      const preferredModel = agentChannelId === channel.id
        ? enabledModels.find((model) => model.id === agentModelId)
        : undefined
      const testedModel = preferredModel ?? enabledModels[0]

      if (!testedModel) {
        setDoctorResult({
          channelId: channel.id,
          ok: false,
          lines: [t('settings.channel.doctorNoModel')],
        })
        return
      }

      const [connection, apiKey] = await Promise.all([
        window.electronAPI.testChannel({
          channelId: channel.id,
          modelId: testedModel.id,
        }),
        window.electronAPI.decryptApiKey(channel.id),
      ])
      const modelFetch = await window.electronAPI.fetchModels({
        provider: channel.provider,
        baseUrl: channel.baseUrl,
        apiKey,
      })
      const lines = [
        t('settings.channel.doctorInference', { result: connection.success ? t('settings.channel.doctorPass') : t('settings.channel.doctorFail'), message: connection.message }),
        t('settings.channel.doctorProtocol', { protocol: connection.resolvedApi ?? channel.apiType ?? t('settings.channel.doctorAutoInfer') }),
        t('settings.channel.doctorTestModel', { model: connection.modelId ?? testedModel.id }),
        t('settings.channel.doctorModelList', { result: modelFetch.success ? t('settings.channel.doctorReachable') : t('settings.channel.doctorFail'), message: modelFetch.message }),
        t('settings.channel.doctorRemoteModels', { count: modelFetch.models.length }),
        t('settings.channel.doctorLocalModels', { enabled: enabledModels.length, total: channel.models.length }),
        t('settings.channel.doctorDefault', { value: agentChannelId === channel.id ? (agentModelId || t('settings.channel.doctorNoModelId')) : t('settings.channel.doctorNotDefault') }),
      ]
      setDoctorResult({
        channelId: channel.id,
        // Healthy 只由真实推理决定；模型列表接口可能被网关关闭。
        ok: connection.success,
        lines,
      })
    } catch (error) {
      setDoctorResult({
        channelId: channel.id,
        ok: false,
        lines: [error instanceof Error ? error.message : String(error)],
      })
    } finally {
      setDoctorRunningId(null)
    }
  }

  const handleFormSaved = async (savedChannel: Channel): Promise<void> => {
    const loadedChannels = await loadChannels()
    const updatedChannels = loadedChannels ?? [
      ...channels.filter((channel) => channel.id !== savedChannel.id),
      savedChannel,
    ]
    if (!loadedChannels) setChannels(updatedChannels)
    const nextSelectedChannelId = updatedChannels.some((channel) => channel.id === savedChannel.id)
      ? savedChannel.id
      : updatedChannels[0]?.id ?? null
    draftOriginChannelIdRef.current = null
    setFormDirty(false)
    setSelectedPresetId(null)
    setSelectedChannelId(nextSelectedChannelId)
    setIsCreating(false)
    await syncDefaultSelection(updatedChannels)
  }

  const handleFormCancel = (): void => {
    const fallbackChannelId = draftOriginChannelIdRef.current
    const hasFallbackChannel = fallbackChannelId && channels.some((channel) => channel.id === fallbackChannelId)

    draftOriginChannelIdRef.current = null
    setFormDirty(false)
    setSelectedPresetId(null)
    setIsCreating(false)

    if (hasFallbackChannel) {
      setSelectedChannelId(fallbackChannelId)
      return
    }

    if (!selectedChannelId && channels.length > 0) {
      setSelectedChannelId(channels[0]?.id ?? null)
    }
  }

  const selectedChannel = React.useMemo(() => (
    channels.find((channel) => channel.id === selectedChannelId) ?? null
  ), [channels, selectedChannelId])

  const selectedPreset = React.useMemo(() => (
    allPresets.find((preset) => preset.id === selectedPresetId) ?? null
  ), [allPresets, selectedPresetId])

  const filteredEntries = React.useMemo(() => {
    const channelEntries: ChannelListEntry[] = channels.map((channel) => ({
      kind: 'channel',
      id: channel.id,
      channel,
      searchText: `${channel.name} ${PROVIDER_LABELS[channel.provider]} ${channel.baseUrl}`.toLowerCase(),
    }))
    const presetEntries: ChannelListEntry[] = allPresets.map((preset) => ({
      kind: 'preset',
      id: preset.id,
      preset,
      searchText: buildPresetSearchText(preset),
    }))

    const keyword = search.trim().toLowerCase()
    const entries = [...channelEntries, ...presetEntries]
    if (!keyword) {
      return entries
    }

    return entries.filter((entry) => entry.searchText.includes(keyword))
  }, [channels, allPresets, search])

  const formKey = selectedChannel
    ? `channel:${selectedChannel.id}:${selectedChannel.updatedAt}`
    : selectedPreset
      ? `preset:${selectedPreset.id}`
      : isCreating
        ? 'draft:create'
        : 'idle'

  return (
    <div className="space-y-8">
      <SettingsSection
        title={t('settings.channel.title')}
        description={t('settings.channel.description')}
      >
        <div className="space-y-4">
          <div
            data-slot="channel-toolbar"
            className="grid items-center gap-4 rounded-[var(--kila-panel-radius)] border border-border/45 bg-card/70 p-4 [grid-template-columns:minmax(0,1fr)_auto]"
          >
            <div className="relative min-w-0">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label={t('settings.channel.searchPlaceholder')}
                placeholder={t('settings.channel.searchPlaceholder')}
                className="h-12 rounded-xl border-border/50 bg-background pl-12 text-sm shadow-none"
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button
                size="sm"
                className="h-12 rounded-xl px-5 text-sm"
                onClick={openBlankDraft}
              >
                <Plus size={16} />
                <span>{t('settings.channel.addProvider')}</span>
              </Button>
            </div>
          </div>

          <div
            data-slot="channel-split-layout"
            className="grid min-h-[560px] gap-4 lg:h-[min(72vh,820px)] lg:grid-cols-[minmax(280px,320px)_minmax(0,1fr)] lg:gap-6"
          >
            <div
              data-slot="channel-list-panel"
              className="surface-panel flex h-[280px] min-h-0 flex-col overflow-hidden p-3 lg:h-auto"
            >
              <div data-slot="channel-list-scroll" className="flex-1 min-h-0">
                {loading ? (
                  <div className="flex h-full items-center justify-center py-12 text-center text-sm text-muted-foreground">
                    {t('common.loading')}
                  </div>
                ) : loadError ? (
                  <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 px-4 py-12 text-center text-sm text-destructive">
                    <span>{loadError}</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => { void loadChannels() }}>
                      {t('settings.memory.retry')}
                    </Button>
                  </div>
                ) : filteredEntries.length === 0 ? (
                  <div className="flex h-full items-center justify-center rounded-[20px] border border-dashed border-border/60 px-4 py-14 text-center text-sm text-muted-foreground">
                    {t('settings.channel.noMatches')}
                  </div>
                ) : (
                  <ScrollArea className="h-full pr-1">
                    <div className="space-y-3">
                      {filteredEntries.map((entry) => (
                        entry.kind === 'channel' ? (
                          <ChannelListItem
                            key={entry.id}
                            title={entry.channel.name}
                            badgeLabel={
                              entry.channel.provider === 'custom'
                                ? 'CUSTOM'
                                : undefined
                            }
                            logoSrc={getChannelLogo(entry.channel.baseUrl)}
                            openAiLogo={isOpenAIChannelLogo(entry.channel.baseUrl)}
                            selected={!isCreating && entry.channel.id === selectedChannelId}
                            statusTone={entry.channel.enabled ? 'active' : 'inactive'}
                            onSelect={() => {
                              handleSelectChannel(entry.channel.id)
                            }}
                          />
                        ) : (
                          <ChannelListItem
                            key={entry.id}
                            title={entry.preset.name}
                            logoSrc={getProviderLogoResolved({
                              baseUrl: entry.preset.baseUrl,
                              provider: entry.preset.provider,
                              capabilityProviderId: entry.preset.capabilityProviderId,
                              displayName: entry.preset.name,
                            })}
                            openAiLogo={(entry.preset.iconProvider ?? entry.preset.provider) === 'openai'}
                            selected={isCreating && entry.preset.id === selectedPresetId}
                            statusTone="preset"
                            onSelect={() => {
                              openPresetDraft(entry.preset.id)
                            }}
                          />
                        )
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>
            </div>

            <div
              data-slot="channel-detail-panel"
              className="surface-panel min-h-[560px] min-w-0 overflow-hidden lg:min-h-0"
            >
              <ScrollArea className="h-full">
                <div className="space-y-5 p-5">
                  {selectedPreset ? (
                    <div className="flex items-start gap-4 pb-1">
                      <img
                        src={getProviderLogoResolved({
                          baseUrl: selectedPreset.baseUrl,
                          provider: selectedPreset.provider,
                          capabilityProviderId: selectedPreset.capabilityProviderId,
                          displayName: selectedPreset.name,
                        })}
                        alt=""
                        className={cn(
                          'h-12 w-12 rounded-xl object-cover',
                          (selectedPreset.iconProvider ?? selectedPreset.provider) === 'openai' && 'dark:invert',
                        )}
                      />
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate text-[28px] font-semibold tracking-tight text-foreground">
                            {selectedPreset.name}
                          </div>
                          <span className="rounded-md bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                            Preset
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {selectedPreset.descriptionKey
                            ? t(selectedPreset.descriptionKey)
                            : selectedPreset.description ?? t('settings.channel.presetHint')}
                        </div>
                      </div>
                    </div>
                  ) : isCreating ? (
                    <div className="flex items-start justify-between gap-4 pb-1">
                      <div className="space-y-2">
                        <div className="text-[28px] font-semibold tracking-tight text-foreground">{t('settings.channel.newProvider')}</div>
                        <div className="text-sm text-muted-foreground">{t('settings.channel.newProviderHint')}</div>
                      </div>
                    </div>
                  ) : selectedChannel ? (
                    <div className="flex items-start justify-between gap-4 pb-1">
                      <div className="min-w-0 space-y-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <img
                            src={getChannelLogo(selectedChannel.baseUrl)}
                            alt=""
                            className={cn(
                              'h-12 w-12 rounded-xl object-cover',
                              isOpenAIChannelLogo(selectedChannel.baseUrl) && 'dark:invert',
                            )}
                          />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="truncate text-[28px] font-semibold tracking-tight text-foreground">
                                {selectedChannel.name}
                              </div>
                              <span className="rounded-md bg-muted px-3 py-1 text-xs text-muted-foreground">
                                {PROVIDER_LABELS[selectedChannel.provider]}
                              </span>
                              <span
                                className={cn(
                                  'rounded-md px-3 py-1 text-xs',
                                  selectedChannel.enabled
                                    ? 'bg-status-success-soft text-status-success-foreground'
                                    : 'bg-muted text-muted-foreground',
                                )}
                              >
                                {selectedChannel.enabled ? t('settings.channel.statusActive') : t('settings.channel.statusInactive')}
                              </span>
                            </div>
                            <div className="truncate text-sm text-muted-foreground">
                              {selectedChannel.baseUrl}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => { void runProviderDoctor(selectedChannel) }}
                          className="h-11 w-11 rounded-xl border-border/50"
                          title={t('settings.channel.doctor')}
                          aria-label={t('settings.channel.doctorAria', { name: selectedChannel.name })}
                          disabled={doctorRunningId === selectedChannel.id}
                        >
                          {doctorRunningId === selectedChannel.id
                            ? <RefreshCw size={16} className="animate-spin" />
                            : <Activity size={16} />}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => { void handleDelete(selectedChannel) }}
                          className="h-11 w-11 rounded-xl border-border/50 text-destructive hover:text-destructive"
                          title={t('common.delete')}
                          aria-label={t('settings.channel.deleteAria', { name: selectedChannel.name })}
                        >
                          <Trash2 size={16} />
                        </Button>
                        <div className="rounded-xl border border-border/50 bg-background px-3 py-2">
                          <Switch
                            checked={selectedChannel.enabled}
                            onCheckedChange={() => { void handleToggle(selectedChannel) }}
                            aria-label={selectedChannel.enabled ? t('settings.channel.disableAria', { name: selectedChannel.name }) : t('settings.channel.enableAria', { name: selectedChannel.name })}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-[20px] border border-dashed border-border/60 px-6 text-center">
                      <div className="text-sm font-medium text-foreground">{t('settings.channel.emptySelection')}</div>
                      <div className="max-w-md text-sm text-muted-foreground">
                        {t('settings.channel.emptySelectionHint')}
                      </div>
                    </div>
                  )}

                  {selectedChannel && doctorResult?.channelId === selectedChannel.id && (
                    <div className={cn(
                      'rounded-xl border px-4 py-3 text-sm',
                      doctorResult.ok
                        ? 'border-status-success/25 bg-status-success-soft/40'
                        : 'border-destructive/25 bg-destructive/5',
                    )}>
                      <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
                        <Activity className="size-4" />
                        <span>Provider Doctor</span>
                        <EntityMetadataChip tone={doctorResult.ok ? 'success' : 'danger'}>
                          {doctorResult.ok ? t('settings.channel.doctorHealthy') : t('settings.channel.doctorIssue')}
                        </EntityMetadataChip>
                      </div>
                      <div className="space-y-1 text-muted-foreground">
                        {doctorResult.lines.map((line) => (
                          <div key={line}>{line}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {isCreating || selectedChannel ? (
                    <>
                      {formDirty && (
                        <div role="status" className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                          {t('settings.channel.unsavedChanges')}
                        </div>
                      )}
                      <ChannelForm
                        key={formKey}
                        channel={isCreating ? null : selectedChannel}
                        preset={selectedPreset}
                        onSaved={(channel) => { void handleFormSaved(channel) }}
                        onCancel={handleFormCancel}
                        onDirtyChange={handleFormDirtyChange}
                        embedded
                      />
                    </>
                  ) : null}
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>
      </SettingsSection>
    </div>
  )
}

interface ChannelListItemProps {
  title: string
  logoSrc: string
  openAiLogo?: boolean
  badgeLabel?: string
  selected: boolean
  statusTone: 'active' | 'inactive' | 'preset'
  onSelect: () => void
}

function ChannelListItem({
  title,
  logoSrc,
  openAiLogo = false,
  badgeLabel,
  selected,
  statusTone,
  onSelect,
}: ChannelListItemProps): React.ReactElement {
  const { t } = useTranslation()
  return (
    <WorkspaceEntityRow
      selected={selected}
      onClick={onSelect}
      icon={(
        <img
          src={logoSrc}
          alt=""
          className={cn('h-6 w-6 rounded-lg object-cover', openAiLogo && 'dark:invert')}
        />
      )}
      title={title}
      description={statusTone === 'preset' ? t('settings.channel.presetTemplate') : t('settings.channel.savedProvider')}
      metadata={badgeLabel ? (
        <EntityMetadataChip>
            {badgeLabel}
        </EntityMetadataChip>
      ) : undefined}
      trailing={(
        <EntityMetadataChip tone={statusTone === 'active' ? 'accent' : 'neutral'}>
          {statusTone === 'active' ? t('settings.channel.statusActive') : statusTone === 'preset' ? t('settings.channel.statusPreset') : t('settings.channel.statusInactive')}
        </EntityMetadataChip>
      )}
    />
  )
}
