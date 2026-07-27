/**
 * MainArea — 主内容区域
 *
 * 组合 WorkspaceToolbar + SplitContainer，承载统一 Session 主内容区。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { activeTabAtom, splitLayoutAtom, tabsAtom } from '@/atoms/tab-atoms'
import { currentSessionIdAtom } from '@/atoms/session-atoms'
import { userProfileAtom } from '@/atoms/user-profile'
import { Panel } from '@/components/app-shell/Panel'
import { WorkspaceToolbar } from './WorkspaceToolbar'
import { SplitContainer } from './SplitContainer'
import { CalendarDays, MapPin, Moon } from 'lucide-react'

/** 按当前小时挑选问候语文案 key */
function getGreetingKey(date: Date): string {
  const hour = date.getHours()
  if (hour < 6) return 'tabs.greeting.lateNight'
  if (hour < 11) return 'tabs.greeting.morning'
  if (hour < 14) return 'tabs.greeting.midday'
  if (hour < 18) return 'tabs.greeting.afternoon'
  return 'tabs.greeting.evening'
}

const GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
const ANIMALS = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪']
const LUNAR_DAYS = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十',
]

function getGanZhiYear(year: number): string {
  const g = (year - 4) % 10
  const z = (year - 4) % 12
  return `${GAN[g]}${ZHI[z]}${ANIMALS[z]}年`
}

function getLunarDateLabel(date: Date): string {
  const year = date.getFullYear()
  const parts = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
    month: 'long',
    day: 'numeric',
  }).formatToParts(date)

  const month = parts.find((part) => part.type === 'month')?.value ?? ''
  const day = Number(parts.find((part) => part.type === 'day')?.value)
  const dayLabel = Number.isFinite(day) ? LUNAR_DAYS[day - 1] ?? String(day) : ''
  return `${getGanZhiYear(year)} ${month}${dayLabel}`
}


export function MainArea(): React.ReactElement {
  const { t, i18n } = useTranslation()
  const tabs = useAtomValue(tabsAtom)
  const activeTab = useAtomValue(activeTabAtom)
  const splitLayout = useAtomValue(splitLayoutAtom)
  const setCurrentSessionId = useSetAtom(currentSessionIdAtom)
  const userProfile = useAtomValue(userProfileAtom)
  const displayName = userProfile.userName.trim() || t('tabs.home.defaultName')
  const [now, setNow] = React.useState(() => new Date())
  React.useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const greeting = t(getGreetingKey(now))
  // 日期格式跟随当前界面语言，避免英文界面里出现中式日期
  const dateLabel = React.useMemo(() => now.toLocaleDateString(i18n.language, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }), [i18n.language, now])
  const lunarDateLabel = React.useMemo(() => getLunarDateLabel(now), [now])
  // 农历只在中文环境展示：其内容是干支与月日的中文字符，英文界面无法阅读
  const showLunarDate = i18n.language.startsWith('zh')
  const profileLocation = [userProfile.city, userProfile.country].filter(Boolean).join(' · ') || t('tabs.home.locationUnset')
  const profileTimeZone = userProfile.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || t('tabs.home.localTimeZone')

  // focused Pane 是当前会话的唯一真相源，确保侧栏、权限队列和后台桥接始终指向可见焦点。
  React.useEffect(() => {
    setCurrentSessionId(activeTab?.sessionId ?? null)
  }, [activeTab?.sessionId, setCurrentSessionId])

  // 只监听当前可见 Pane 的项目，避免历史 Session 数量增长后耗尽文件句柄。
  React.useEffect(() => {
    const visibleSessionIds = splitLayout.panels.flatMap((panel) => {
      if (!panel.activeTabId) return []
      const tab = tabs.find((candidate) => candidate.id === panel.activeTabId)
      return tab ? [tab.sessionId] : []
    })

    void window.electronAPI.setActiveSessionProjectWatches(visibleSessionIds).catch((error) => {
      console.error('[MainArea] 同步可见 Session 项目监听失败:', error)
    })
  }, [splitLayout.panels, tabs])

  // 标签视图
  return (
    <Panel
      variant="grow"
      className="bg-workspace"
    >
      <WorkspaceToolbar />
      {tabs.length === 0 ? (
        <div className="titlebar-no-drag flex flex-1 items-center justify-center px-6 py-10 text-muted-foreground">
          <div className="w-full max-w-[680px] text-center">
            <h2 className="text-balance text-[34px] font-semibold leading-tight tracking-tight text-foreground md:text-[40px]">
              {t('tabs.home.greeting', { greeting, name: displayName })}
            </h2>
            <p className="mx-auto mt-3 max-w-[560px] text-sm leading-6 text-muted-foreground">
              {t('tabs.home.openSessionHint')}
            </p>
            <div className="mx-auto mt-6 flex max-w-[620px] flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-3.5" />{dateLabel}</span>
              {/* 农历标签本身是中文字符（甲辰年正月初一），英文界面下显示无意义，故仅中文环境展示 */}
              {showLunarDate && (
                <span className="inline-flex items-center gap-1.5"><Moon className="size-3.5" />{t('tabs.home.lunarDate', { date: lunarDateLabel })}</span>
              )}
              <span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5" />{profileLocation} · {profileTimeZone}</span>
            </div>
          </div>
        </div>
      ) : (
        <SplitContainer />
      )}
    </Panel>
  )
}
