/**
 * GeneralSettings - 通用设置页
 *
 * 顶部：用户偏好资料（头像、称呼、时区、位置）
 * 中部：语言、通知等通用设置
 * 下方：后台轻任务模型配置
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { BellRing, Camera, RotateCcw } from 'lucide-react'
import type { Channel, KilaNotificationCategory, KilaPermissionMode } from '@kila/shared'
import { toast } from 'sonner'
import {
  SettingsSection,
  SettingsCard,
  SettingsInput,
  SettingsSelect,
  SettingsToggle,
} from './primitives'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { UserAvatar } from '../message/UserAvatar'
import { PermissionModeSelector, getPermissionModeOptions } from '@/components/agent/PermissionModeSelector'
import { userProfileAtom } from '@/atoms/user-profile'
import {
  notificationsEnabledAtom,
  sendDesktopNotification,
  updateNotificationsEnabled,
  notificationPreferencesAtom,
  updateNotificationPreferences,
} from '@/atoms/notifications'
import { localeAtom, changeLocale } from '@/atoms/locale-atom'
import { cn } from '@/lib/utils'
import type { AppLocale, UserProfile } from '../../../types'

const UNSET_SELECT_VALUE = '__unset__'
const PROFILE_INPUT_CLASS = 'h-12 rounded-xl border-border/60 bg-background/85 px-4 text-[15px] shadow-none'

const NOTIFICATION_CATEGORY_OPTIONS: Array<{
  category: KilaNotificationCategory
  label: string
  description: string
}> = [
  { category: 'agent', label: 'Agent 任务', description: '任务完成、失败等状态' },
  { category: 'permission', label: '权限请求', description: 'Agent 请求操作权限或用户输入' },
  { category: 'usage', label: '用量告警', description: 'Token 预算超限提醒' },
  { category: 'update', label: '版本更新', description: '发现新版本可用' },
  { category: 'bridge', label: 'IM 桥接', description: '飞书/Telegram 等渠道连接状态' },
  { category: 'system', label: '系统通知', description: '其他系统级别通知' },
]

type EditableProfileFields = Pick<UserProfile, 'userName' | 'timeZone' | 'city' | 'country'>
type EditableProfileField = keyof EditableProfileFields

interface ChannelSelection {
  channelId: string
  modelId?: string
}

function getSystemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function isValidTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat('zh-CN', { timeZone: value }).format(new Date())
    return true
  } catch {
    return false
  }
}

function buildEditableProfile(userProfile: UserProfile): EditableProfileFields {
  return {
    userName: userProfile.userName,
    timeZone: userProfile.timeZone,
    city: userProfile.city,
    country: userProfile.country,
  }
}

function resolveUtilitySelection(
  channels: Channel[],
  currentChannelId: string | null,
  currentModelId: string | null,
): ChannelSelection | null {
  if (!currentChannelId || !currentModelId) {
    return null
  }

  const channel = channels.find((candidate) => candidate.id === currentChannelId && candidate.enabled)
  if (!channel) {
    return null
  }

  const model = channel.models.find((candidate) => candidate.id === currentModelId && candidate.enabled)
  if (!model) {
    return null
  }

  return {
    channelId: channel.id,
    modelId: model.id,
  }
}

export function GeneralSettings(): React.ReactElement {
  const { t } = useTranslation()
  const [userProfile, setUserProfile] = useAtom(userProfileAtom)
  const [notificationsEnabled, setNotificationsEnabled] = useAtom(notificationsEnabledAtom)
  const [notificationPrefs, setNotificationPrefs] = useAtom(notificationPreferencesAtom)
  const [locale, setLocale] = useAtom(localeAtom)
  const [channels, setChannels] = React.useState<Channel[]>([])
  const [profileDraft, setProfileDraft] = React.useState<EditableProfileFields>(() => buildEditableProfile(userProfile))
  const [profileErrors, setProfileErrors] = React.useState<Partial<Record<EditableProfileField, string>>>({})
  const [savingField, setSavingField] = React.useState<EditableProfileField | null>(null)
  const [agentPermissionMode, setAgentPermissionMode] = React.useState<KilaPermissionMode>('smart')
  const [utilityChannelId, setUtilityChannelId] = React.useState<string | null>(null)
  const [utilityModelId, setUtilityModelId] = React.useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const systemTimeZone = React.useMemo(() => getSystemTimeZone(), [])
  const permissionModeOptions = React.useMemo(() => getPermissionModeOptions(t), [t])
  const selectedPermissionMode = React.useMemo(
    () => permissionModeOptions.find((option) => option.value === agentPermissionMode) ?? permissionModeOptions[1]!,
    [agentPermissionMode, permissionModeOptions],
  )

  React.useEffect(() => {
    setProfileDraft(buildEditableProfile(userProfile))
  }, [userProfile])

  const persistUtilitySelection = React.useCallback(async (
    nextChannelId: string | null,
    nextModelId: string | null,
  ): Promise<void> => {
    setUtilityChannelId(nextChannelId)
    setUtilityModelId(nextModelId)
    await window.electronAPI.updateSettings({
      utilityChannelId: nextChannelId ?? undefined,
      utilityModelId: nextModelId ?? undefined,
    })
  }, [])

  React.useEffect(() => {
    Promise.all([
      window.electronAPI.getSettings(),
      window.electronAPI.listChannels(),
    ])
      .then(async ([settings, list]) => {
        setAgentPermissionMode(settings.agentPermissionMode ?? 'smart')
        setChannels(list)

        const nextSelection = resolveUtilitySelection(
          list,
          settings.utilityChannelId ?? null,
          settings.utilityModelId ?? null,
        )
        const nextChannelId = nextSelection?.channelId ?? null
        const nextModelId = nextSelection?.modelId ?? null

        setUtilityChannelId(nextChannelId)
        setUtilityModelId(nextModelId)

        if (
          (settings.utilityChannelId ?? null) !== nextChannelId
          || (settings.utilityModelId ?? null) !== nextModelId
        ) {
          await window.electronAPI.updateSettings({
            utilityChannelId: nextChannelId ?? undefined,
            utilityModelId: nextModelId ?? undefined,
          })
        }
      })
      .catch(console.error)
  }, [])

  React.useEffect(() => {
    return window.electronAPI.onSettingsChanged((settings) => {
      setAgentPermissionMode(settings.agentPermissionMode ?? 'smart')
    })
  }, [])

  const enabledChannels = React.useMemo(
    () => channels.filter((channel) => channel.enabled),
    [channels],
  )

  const utilityChannelOptions = React.useMemo(() => (
    [
      { value: UNSET_SELECT_VALUE, label: t('settings.general.unsetProvider') },
      ...enabledChannels.map((channel) => ({
        value: channel.id,
        label: channel.name,
      })),
    ]
  ), [enabledChannels, t])

  const selectedUtilityChannel = React.useMemo(() => (
    enabledChannels.find((channel) => channel.id === utilityChannelId) ?? null
  ), [enabledChannels, utilityChannelId])

  const utilityModelOptions = React.useMemo(() => {
    if (!selectedUtilityChannel) {
      return [{ value: UNSET_SELECT_VALUE, label: t('settings.general.noProvider') }]
    }

    const enabledModels = selectedUtilityChannel.models
      .filter((model) => model.enabled)
      .map((model) => ({
        value: model.id,
        label: model.name,
      }))

    return enabledModels.length > 0
      ? enabledModels
      : [{ value: UNSET_SELECT_VALUE, label: t('settings.general.noEnabledModels') }]
  }, [selectedUtilityChannel, t])

  const handleUtilityChannelChange = React.useCallback(async (value: string): Promise<void> => {
    if (value === UNSET_SELECT_VALUE) {
      await persistUtilitySelection(null, null)
      return
    }

    const channel = enabledChannels.find((candidate) => candidate.id === value)
    const nextModelId = channel?.models.find((candidate) => candidate.enabled)?.id ?? null
    await persistUtilitySelection(channel?.id ?? null, nextModelId)
  }, [enabledChannels, persistUtilitySelection])

  const handleUtilityModelChange = React.useCallback(async (value: string): Promise<void> => {
    if (!selectedUtilityChannel || value === UNSET_SELECT_VALUE) {
      return
    }

    await persistUtilitySelection(selectedUtilityChannel.id, value)
  }, [persistUtilitySelection, selectedUtilityChannel])

  const clearProfileError = React.useCallback((field: EditableProfileField): void => {
    setProfileErrors((prev) => {
      if (!prev[field]) {
        return prev
      }
      const next = { ...prev }
      delete next[field]
      return next
    })
  }, [])

  const setProfileField = React.useCallback((field: EditableProfileField, value: string): void => {
    setProfileDraft((prev) => ({
      ...prev,
      [field]: value,
    }))
    clearProfileError(field)
  }, [clearProfileError])

  const persistProfileField = React.useCallback(async (field: EditableProfileField): Promise<void> => {
    let nextValue = profileDraft[field].trim()

    if (field === 'userName' && !nextValue) {
      setProfileErrors((prev) => ({
        ...prev,
        userName: t('settings.general.nameRequiredError'),
      }))
      return
    }

    if (field === 'timeZone') {
      nextValue = nextValue || systemTimeZone
      if (!isValidTimeZone(nextValue)) {
        setProfileErrors((prev) => ({
          ...prev,
          timeZone: t('settings.general.timeZoneError'),
        }))
        return
      }
      setProfileDraft((prev) => ({ ...prev, timeZone: nextValue }))
    }

    setSavingField(field)

    try {
      const updated = await window.electronAPI.updateUserProfile({
        [field]: nextValue,
      } as Partial<UserProfile>)
      setUserProfile(updated)
      clearProfileError(field)
    } catch (error) {
      console.error(`[通用设置] 更新 ${field} 失败:`, error)
    } finally {
      setSavingField((current) => (current === field ? null : current))
    }
  }, [clearProfileError, profileDraft, setUserProfile, systemTimeZone, t])

  const handleFieldKeyDown = React.useCallback((field: EditableProfileField) => (
    event: React.KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void persistProfileField(field)
      event.currentTarget.blur()
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setProfileDraft((prev) => ({
        ...prev,
        [field]: userProfile[field],
      }))
      clearProfileError(field)
      event.currentTarget.blur()
    }
  }, [clearProfileError, persistProfileField, userProfile])

  /** 上传图片作为头像 */
  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async () => {
      const dataUrl = reader.result as string
      try {
        const updated = await window.electronAPI.updateUserProfile({ avatar: dataUrl })
        setUserProfile(updated)
      } catch (error) {
        console.error('[通用设置] 更新头像失败:', error)
      }
    }
    reader.readAsDataURL(file)
    event.target.value = ''
  }

  const handleSendTestNotification = React.useCallback(async (): Promise<void> => {
    const delivered = await sendDesktopNotification(
      t('settings.general.testNotificationTitle'),
      t('settings.general.testNotificationBody'),
      true,
      { force: true },
    )

    if (delivered) {
      toast.success(t('settings.general.testNotificationSent'))
      return
    }

    toast.error(t('settings.general.testNotificationFailed'))
  }, [t])

  const locationPreview = [profileDraft.city.trim(), profileDraft.country.trim()]
    .filter(Boolean)
    .join(' / ') || t('settings.general.locationUnset')

  return (
    <div className="space-y-6">
      <SettingsSection
        title={t('settings.general.userProfile')}
        description={t('settings.general.userProfileDescription')}
      >
        <SettingsCard divided={false} className="overflow-hidden border-border/60 bg-background/95">
          <div className="grid gap-5 border-b border-border/60 bg-muted/15 px-5 py-5 md:grid-cols-[auto_minmax(0,1fr)_minmax(220px,280px)] md:items-center">
            <div className="relative group/avatar w-fit">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="relative rounded-[24px] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <UserAvatar avatar={userProfile.avatar} size={72} />
                <div
                  className={cn(
                    'absolute inset-0 flex items-center justify-center rounded-[24px]',
                    'bg-black/38 opacity-0 transition-opacity group-hover/avatar:opacity-100',
                  )}
                >
                  <Camera className="size-5 text-white" />
                </div>
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="hidden"
                onChange={handleImageUpload}
              />

              {userProfile.avatar && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const updated = await window.electronAPI.updateUserProfile({ avatar: '' })
                      setUserProfile(updated)
                    } catch (error) {
                      console.error('[通用设置] 恢复默认头像失败:', error)
                    }
                  }}
                  className={cn(
                    'absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full border border-border/60 bg-background text-foreground/55 shadow-none transition-colors',
                    'hover:bg-muted hover:text-foreground',
                    'opacity-0 group-hover/avatar:opacity-100',
                  )}
                  title={t('settings.general.resetAvatar')}
                >
                  <RotateCcw className="size-3.5" />
                </button>
              )}
            </div>

            <div className="min-w-0 space-y-1">
              <div className="text-base font-semibold tracking-tight text-foreground">
                {profileDraft.userName || t('settings.general.namePlaceholder')}
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                {t('settings.general.avatarHint')}
              </p>
            </div>

            <div className="rounded-[22px] border border-border/60 bg-background/85 px-4 py-3 text-sm leading-6 text-muted-foreground">
              <p>{t('settings.general.profileUsage')}</p>
              <p className="mt-1.5 text-foreground/75">
                {t('settings.general.profileCurrentContext', {
                  timeZone: profileDraft.timeZone.trim() || systemTimeZone,
                  location: locationPreview,
                })}
              </p>
            </div>
          </div>

          <div className="border-b border-border/60 bg-background/90">
            <div className="px-5 pt-5">
              <h5 className="text-[15px] font-semibold tracking-tight text-foreground">
                {t('settings.general.basicInfo')}
              </h5>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {t('settings.general.basicInfoDescription')}
              </p>
            </div>
            <div className="grid gap-0 md:grid-cols-2">
              <SettingsInput
                label={t('settings.general.nameLabel')}
                description={t('settings.general.nameDescription')}
                value={profileDraft.userName}
                onChange={(value) => setProfileField('userName', value)}
                onBlur={() => { void persistProfileField('userName') }}
                onKeyDown={handleFieldKeyDown('userName')}
                placeholder={t('settings.general.namePlaceholder')}
                error={profileErrors.userName}
                disabled={savingField === 'userName'}
                inputClassName={PROFILE_INPUT_CLASS}
              />
              <SettingsInput
                label={t('settings.general.timeZoneLabel')}
                description={t('settings.general.timeZoneDescription')}
                value={profileDraft.timeZone}
                onChange={(value) => setProfileField('timeZone', value)}
                onBlur={() => { void persistProfileField('timeZone') }}
                onKeyDown={handleFieldKeyDown('timeZone')}
                placeholder={t('settings.general.timeZonePlaceholder')}
                error={profileErrors.timeZone}
                disabled={savingField === 'timeZone'}
                inputClassName={PROFILE_INPUT_CLASS}
              />
            </div>
          </div>

          <div className="bg-background/90">
            <div className="px-5 pt-5">
              <h5 className="text-[15px] font-semibold tracking-tight text-foreground">
                {t('settings.general.locationSection')}
              </h5>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {t('settings.general.locationSectionDescription')}
              </p>
            </div>
            <div className="grid gap-0 md:grid-cols-2">
              <SettingsInput
                label={t('settings.general.cityLabel')}
                description={t('settings.general.cityDescription')}
                value={profileDraft.city}
                onChange={(value) => setProfileField('city', value)}
                onBlur={() => { void persistProfileField('city') }}
                onKeyDown={handleFieldKeyDown('city')}
                placeholder={t('settings.general.cityPlaceholder')}
                disabled={savingField === 'city'}
                inputClassName={PROFILE_INPUT_CLASS}
              />
              <SettingsInput
                label={t('settings.general.countryLabel')}
                description={t('settings.general.countryDescription')}
                value={profileDraft.country}
                onChange={(value) => setProfileField('country', value)}
                onBlur={() => { void persistProfileField('country') }}
                onKeyDown={handleFieldKeyDown('country')}
                placeholder={t('settings.general.countryPlaceholder')}
                disabled={savingField === 'country'}
                inputClassName={PROFILE_INPUT_CLASS}
              />
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t('settings.general.generalSettings')}
        description={t('settings.general.generalSettingsDescription')}
        action={(
          <Button
            variant="outline"
            size="sm"
            onClick={() => { void handleSendTestNotification() }}
            disabled={!notificationsEnabled}
          >
            <BellRing className="mr-1.5 size-4" />
            <span>{t('settings.general.testNotification')}</span>
          </Button>
        )}
      >
        <SettingsCard>
          <SettingsSelect
            label={t('settings.general.language')}
            description={t('settings.general.languageDescription')}
            value={locale}
            onValueChange={(value) => { void changeLocale(value as AppLocale, setLocale) }}
            options={[
              { value: 'zh-CN', label: '简体中文' },
              { value: 'en', label: 'English' },
            ]}
          />
          <SettingsToggle
            label={t('settings.general.notifications')}
            description={t('settings.general.notificationsDescription')}
            checked={notificationsEnabled}
            onCheckedChange={(checked) => {
              setNotificationsEnabled(checked)
              void updateNotificationsEnabled(checked)
            }}
          />
          {notificationsEnabled && (
            <div className="px-5 py-4 space-y-3">
              <div className="text-sm font-medium text-foreground">
                {t('settings.general.notificationCategories')}
              </div>
              <div className="space-y-2.5">
                {NOTIFICATION_CATEGORY_OPTIONS.map((option) => (
                  <div key={option.category} className="flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="text-sm text-foreground">{option.label}</div>
                      <div className="text-xs text-muted-foreground">{option.description}</div>
                    </div>
                    <Switch
                      checked={notificationPrefs[option.category]?.enabled ?? true}
                      onCheckedChange={(checked) => {
                        const next = { ...notificationPrefs, [option.category]: { enabled: checked } }
                        setNotificationPrefs(next)
                        void updateNotificationPreferences(next)
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="px-5 py-4">
            <div className="space-y-1">
              <div className="text-sm font-medium text-foreground">
                {t('settings.general.permissionMode')}
              </div>
              <div className="text-sm leading-6 text-muted-foreground">
                {t('settings.general.permissionModeDescription')}
              </div>
            </div>
            <div className="mt-3 space-y-2.5">
              <PermissionModeSelector
                value={agentPermissionMode}
                onChange={(mode) => {
                  setAgentPermissionMode(mode)
                  window.electronAPI.updateSettings({ agentPermissionMode: mode }).catch(console.error)
                }}
              />
              <div className="text-xs leading-5 text-muted-foreground">
                <span className="font-medium text-foreground">{selectedPermissionMode.label}</span>
                <span> · {selectedPermissionMode.description}</span>
              </div>
              <div className="text-[11px] leading-5 text-muted-foreground/85">
                {t('settings.general.permissionModeHint')}
              </div>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t('settings.general.utilityModel')}
        description={t('settings.general.utilityModelDescription')}
      >
        <SettingsCard>
          <SettingsSelect
            label={t('settings.general.utilityProvider')}
            description={t('settings.general.utilityProviderDescription')}
            value={utilityChannelId ?? UNSET_SELECT_VALUE}
            onValueChange={(value) => {
              void handleUtilityChannelChange(value)
            }}
            options={utilityChannelOptions}
            placeholder={t('settings.general.selectProvider')}
          />
          <SettingsSelect
            label={t('settings.general.utilityModelLabel')}
            description={t('settings.general.utilityModelHint')}
            value={utilityModelId ?? UNSET_SELECT_VALUE}
            onValueChange={(value) => {
              void handleUtilityModelChange(value)
            }}
            options={utilityModelOptions}
            placeholder={t('settings.general.selectModel')}
            disabled={!selectedUtilityChannel || utilityModelOptions[0]?.value === UNSET_SELECT_VALUE}
          />
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}
