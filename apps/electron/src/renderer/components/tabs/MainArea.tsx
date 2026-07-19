/**
 * MainArea — 主内容区域
 *
 * 组合 TabBar + SplitContainer，承载统一 Session 主内容区。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { activeTabAtom, splitLayoutAtom, tabsAtom } from '@/atoms/tab-atoms'
import { currentSessionIdAtom } from '@/atoms/session-atoms'
import { userProfileAtom } from '@/atoms/user-profile'
import { Panel } from '@/components/app-shell/Panel'
import { TabBar } from './TabBar'
import { SplitContainer } from './SplitContainer'
import { CalendarDays, MapPin, Moon } from 'lucide-react'

function getGreeting(date: Date): string {
  const hour = date.getHours()
  if (hour < 6) return '夜深了'
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
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
  const tabs = useAtomValue(tabsAtom)
  const activeTab = useAtomValue(activeTabAtom)
  const splitLayout = useAtomValue(splitLayoutAtom)
  const setCurrentSessionId = useSetAtom(currentSessionIdAtom)
  const userProfile = useAtomValue(userProfileAtom)
  const displayName = userProfile.userName.trim() || '你'
  const [now, setNow] = React.useState(() => new Date())
  React.useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const greeting = getGreeting(now)
  const dateLabel = React.useMemo(() => now.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }), [now])
  const lunarDateLabel = React.useMemo(() => getLunarDateLabel(now), [now])
  const profileLocation = [userProfile.city, userProfile.country].filter(Boolean).join(' · ') || '位置待补充'
  const profileTimeZone = userProfile.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || '本地时区'

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
      className="bg-[hsl(var(--workspace))]"
    >
      <TabBar />
      {tabs.length === 0 ? (
        <div className="titlebar-no-drag flex flex-1 items-center justify-center px-6 py-10 text-muted-foreground">
          <div className="w-full max-w-[680px] text-center">
            <h2 className="text-balance text-[34px] font-semibold leading-tight tracking-tight text-foreground md:text-[40px]">
              {greeting}，{displayName}
            </h2>
            <p className="mx-auto mt-3 max-w-[560px] text-sm leading-6 text-muted-foreground">
              打开一个会话开始工作。
            </p>
            <div className="mx-auto mt-6 flex max-w-[620px] flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-3.5" />{dateLabel}</span>
              <span className="inline-flex items-center gap-1.5"><Moon className="size-3.5" />农历 {lunarDateLabel}</span>
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
