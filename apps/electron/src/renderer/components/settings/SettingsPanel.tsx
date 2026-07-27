/**
 * SettingsPanel - 设置面板
 *
 * 左侧导航 + 右侧 ScrollArea 内容区域。
 * 设置项包含通用、渠道、个性、全局 MCP / Skills 等菜单。
 * 使用 Jotai atom 管理当前标签页状态。
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import {
  ArchiveRestore,
  Brain,
  CalendarClock,
  ChartColumn,
  Cpu,
  Info,
  Palette,
  Plug,
  RadioTower,
  Route,
  SlidersHorizontal,
  UserRoundCog,
  Monitor,
  Search,
  Wand2,
} from 'lucide-react'
import { OverlayScrollbarArea } from '@/components/ui/overlay-scrollbar'
import { settingsDirtyAtom, settingsTabAtom } from '@/atoms/settings-tab'
import type { SettingsTab } from '@/atoms/settings-tab'
import { hasUpdateAtom } from '@/atoms/updater'
const ChannelSettings = React.lazy(() => import('./ChannelSettings').then(m => ({ default: m.ChannelSettings })))
const GeneralSettings = React.lazy(() => import('./GeneralSettings').then(m => ({ default: m.GeneralSettings })))
const MemorySettings = React.lazy(() => import('./MemorySettings').then(m => ({ default: m.MemorySettings })))
const ProxySettings = React.lazy(() => import('./ProxySettings').then(m => ({ default: m.ProxySettings })))
const AppearanceSettings = React.lazy(() => import('./AppearanceSettings').then(m => ({ default: m.AppearanceSettings })))
const AboutSettings = React.lazy(() => import('./AboutSettings').then(m => ({ default: m.AboutSettings })))
const GlobalMcpSettings = React.lazy(() => import('./GlobalMcpSettings').then(m => ({ default: m.GlobalMcpSettings })))
const GlobalSkillsSettings = React.lazy(() => import('./GlobalSkillsSettings').then(m => ({ default: m.GlobalSkillsSettings })))
const PersonalitySettings = React.lazy(() => import('./PersonalitySettings').then(m => ({ default: m.PersonalitySettings })))
const BridgeSettings = React.lazy(() => import('./BridgeSettings').then(m => ({ default: m.BridgeSettings })))
const TokenUsageSettings = React.lazy(() => import('./TokenUsageSettings').then(m => ({ default: m.TokenUsageSettings })))
const ContextCompactionSettings = React.lazy(() => import('./ContextCompactionSettings').then(m => ({ default: m.ContextCompactionSettings })))
const ScheduledTasksSettings = React.lazy(() => import('./scheduled-tasks').then(m => ({ default: m.ScheduledTasksSettings })))
const ComputerUseSettings = React.lazy(() => import('./ComputerUseSettings').then(m => ({ default: m.ComputerUseSettings })))
/** 设置 Tab 定义 */
interface TabItem {
  id: SettingsTab
  /** 对应 `settings.tabs.*` 下的翻译 key */
  labelKey: string
  icon: React.ReactNode
}

/** Tab 顺序定义（label 在渲染时翻译） */
const TAB_ITEMS: TabItem[] = [
  { id: 'general', labelKey: 'general', icon: <SlidersHorizontal size={16} /> },
  { id: 'memory', labelKey: 'memory', icon: <Brain size={16} /> },
  { id: 'channels', labelKey: 'channels', icon: <Cpu size={16} /> },
  { id: 'prompts', labelKey: 'prompts', icon: <UserRoundCog size={16} /> },
  { id: 'token-usage', labelKey: 'tokenUsage', icon: <ChartColumn size={16} /> },
  { id: 'context-compaction', labelKey: 'contextCompaction', icon: <ArchiveRestore size={16} /> },
  { id: 'proxy', labelKey: 'proxy', icon: <Route size={16} /> },
  { id: 'mcp', labelKey: 'mcp', icon: <Plug size={16} /> },
  { id: 'skills', labelKey: 'skills', icon: <Wand2 size={16} /> },
  { id: 'bridge', labelKey: 'bridge', icon: <RadioTower size={16} /> },
  { id: 'scheduled-tasks', labelKey: 'scheduledTasks', icon: <CalendarClock size={16} /> },
  { id: 'computer-use', labelKey: 'computerUse', icon: <Monitor size={16} /> },
  { id: 'appearance', labelKey: 'appearance', icon: <Palette size={16} /> },
  { id: 'about', labelKey: 'about', icon: <Info size={16} /> },
]

/** 根据标签页 id 渲染对应内容 */
function renderTabContent(tab: SettingsTab): React.ReactElement {
  switch (tab) {
    case 'general':
      return <GeneralSettings />
    case 'channels':
      return <ChannelSettings />
    case 'memory':
      return <MemorySettings />
    case 'prompts':
      return <PersonalitySettings />
    case 'proxy':
      return <ProxySettings />
    case 'token-usage':
      return <TokenUsageSettings />
    case 'context-compaction':
      return <ContextCompactionSettings />
    case 'mcp':
      return <GlobalMcpSettings />
    case 'skills':
      return <GlobalSkillsSettings />
    case 'bridge':
      return <BridgeSettings />
    case 'scheduled-tasks':
      return <ScheduledTasksSettings />
    case 'computer-use':
      return <ComputerUseSettings />
    case 'appearance':
      return <AppearanceSettings />
    case 'about':
      return <AboutSettings />
    default:
      {
        const exhaustiveCheck: never = tab
        throw new Error(`Unknown settings tab: ${exhaustiveCheck}`)
      }
  }
}

export function SettingsPanel(): React.ReactElement {
  const { t, i18n } = useTranslation()
  const [activeTab, setActiveTab] = useAtom(settingsTabAtom)
  const hasUpdate = useAtomValue(hasUpdateAtom)
  const [settingsDirty, setSettingsDirty] = useAtom(settingsDirtyAtom)
  const [search, setSearch] = React.useState('')

  const tabs = React.useMemo(
    () => TAB_ITEMS.map((tab) => ({ ...tab, label: t(`settings.tabs.${tab.labelKey}`) })),
    [t],
  )
  const visibleTabs = React.useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase(i18n.language)
    return keyword ? tabs.filter((tab) => tab.label.toLocaleLowerCase(i18n.language).includes(keyword)) : tabs
  }, [i18n.language, search, tabs])

  const handleNavigate = React.useCallback((tab: SettingsTab): void => {
    if (tab === activeTab) return
    if (settingsDirty && !window.confirm(t('settings.unsavedConfirm'))) return
    setSettingsDirty(false)
    setActiveTab(tab)
  }, [activeTab, setActiveTab, setSettingsDirty, settingsDirty, t])

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-workspace md:flex-row">
      {/* 左侧 Tab 导航 */}
      <div className="w-full shrink-0 overflow-x-auto border-b border-border/50 bg-muted/45 px-2 pb-2 pt-12 scrollbar-none md:min-h-0 md:w-[212px] md:overflow-y-auto md:border-b-0 md:border-r md:pb-0 md:pt-14">
        <h2 className="mb-2 px-3 text-base font-medium text-foreground">
          {t('settings.title')}
        </h2>
        <div className="relative mb-2 hidden md:block">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} aria-label={t('settings.searchPlaceholder')} placeholder={t('settings.searchPlaceholder')} className="h-8 rounded-lg pl-8 text-xs" />
        </div>
        <nav aria-label={t('settings.navLabel')} className="flex gap-1 md:flex-col">
          {visibleTabs.map((tab) => (
            <button
              type="button"
              key={tab.id}
              onClick={() => handleNavigate(tab.id)}
              aria-current={activeTab === tab.id ? 'page' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm md:text-base',
                activeTab === tab.id
                  ? 'bg-kila-accent-muted text-foreground font-medium'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              )}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.id === 'about' && hasUpdate && (
                <span className="h-2 w-2 rounded-full bg-status-danger" />
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* 右侧内容区域 */}
      <OverlayScrollbarArea className="min-h-0 flex-1 pt-2 md:pt-14" options={{ overflow: { x: 'hidden', y: 'scroll' } }}>
        <div className="px-4 pb-6 md:px-6">
          <React.Suspense fallback={<div className="p-8 text-center text-sm text-muted-foreground animate-pulse">{t('common.loading')}</div>}>
            {renderTabContent(activeTab)}
          </React.Suspense>
        </div>
      </OverlayScrollbarArea>
    </div>
  )
}
