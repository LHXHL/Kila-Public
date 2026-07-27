/**
 * WorkspaceToolbar — 顶部精简工具条
 *
 * 移除会话标签列表后，仅承载：
 * - 空白拖拽区（用于拖动窗口）
 * - 侧栏工具按钮组（文件工作台 / 网页预览 / 工具调用 / Git 状态）
 * - 分屏模式切换按钮
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { FolderOpen, GitBranch, Globe, Wrench } from 'lucide-react'
import {
  tabsAtom,
  activeTabIdAtom,
} from '@/atoms/tab-atoms'
import {
  agentSidePanelActiveToolMapAtom,
  agentSidePanelCloseRequestMapAtom,
  type AgentSidePanelToolId,
} from '@/atoms/agent-atoms'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { SplitModeToggle } from './SplitModeToggle'

/** 与 SessionSidePanel 共用同一批文案 key，避免两处各写一份 */
const TOOLBAR_SESSION_TOOLS: Array<{
  id: AgentSidePanelToolId
  labelKey: string
  icon: React.ComponentType<{ className?: string }>
}> = [
  { id: 'files', labelKey: 'session.sidePanel.files', icon: FolderOpen },
  { id: 'web', labelKey: 'session.sidePanel.web', icon: Globe },
  { id: 'tools', labelKey: 'session.sidePanel.tools', icon: Wrench },
  { id: 'git', labelKey: 'session.sidePanel.git', icon: GitBranch },
]

const SIDEPANEL_CLOSE_ANIMATION_MS = 180

export function WorkspaceToolbar(): React.ReactElement {
  const { t } = useTranslation()
  const tabs = useAtomValue(tabsAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)
  const [sidePanelActiveToolMap, setSidePanelActiveToolMap] = useAtom(agentSidePanelActiveToolMapAtom)
  const [sidePanelCloseRequestMap, setSidePanelCloseRequestMap] = useAtom(agentSidePanelCloseRequestMapAtom)

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null
  const activeSessionId = activeTab?.sessionId ?? null
  const activeSidePanelToolId = activeSessionId ? (sidePanelActiveToolMap.get(activeSessionId) ?? null) : null

  const handleToggleSessionTool = React.useCallback((toolId: AgentSidePanelToolId): void => {
    if (!activeSessionId) return
    const currentTool = sidePanelActiveToolMap.get(activeSessionId) ?? null
    if (currentTool === toolId) {
      const closeRequestAt = Date.now()
      setSidePanelCloseRequestMap((prevClose) => {
        const nextClose = new Map(prevClose)
        nextClose.set(activeSessionId, closeRequestAt)
        return nextClose
      })

      window.setTimeout(() => {
        setSidePanelActiveToolMap((latestPrev) => {
          const latest = new Map(latestPrev)
          if ((latest.get(activeSessionId) ?? null) !== toolId) {
            return latestPrev
          }
          latest.delete(activeSessionId)
          return latest
        })
        setSidePanelCloseRequestMap((latestPrev) => {
          if ((latestPrev.get(activeSessionId) ?? null) !== closeRequestAt) {
            return latestPrev
          }
          const latest = new Map(latestPrev)
          latest.delete(activeSessionId)
          return latest
        })
      }, SIDEPANEL_CLOSE_ANIMATION_MS)
      return
    }

    setSidePanelCloseRequestMap((prevClose) => {
      if (!prevClose.has(activeSessionId)) return prevClose
      const nextClose = new Map(prevClose)
      nextClose.delete(activeSessionId)
      return nextClose
    })
    setSidePanelActiveToolMap((prev) => {
      const map = new Map(prev)
      map.set(activeSessionId, toolId)
      return map
    })
  }, [activeSessionId, sidePanelActiveToolMap, setSidePanelActiveToolMap, setSidePanelCloseRequestMap])

  return (
    <div className="flex h-[var(--kila-toolbar-height)] items-center gap-2 border-b border-border/35 bg-workspace px-2 titlebar-drag-region">
      {/* 空白拖拽区域：支持拖动窗口 */}
      <div className="flex-1 h-full" />

      <div className="h-5 w-px shrink-0 bg-border/60 titlebar-no-drag" />
      <div className="flex shrink-0 items-center gap-1 titlebar-no-drag">
        {TOOLBAR_SESSION_TOOLS.map((tool) => {
          const Icon = tool.icon
          const active = activeSidePanelToolId === tool.id
          const label = t(tool.labelKey)

          return (
            <Tooltip key={tool.id}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={label}
                  aria-pressed={active}
                  disabled={!activeSessionId}
                  className={cn(
                    'size-8 rounded-lg border border-transparent text-muted-foreground/70 transition-colors',
                    active
                      ? 'border-primary/25 bg-kila-accent-muted text-primary'
                      : 'hover:border-border/55 hover:bg-muted/35 hover:text-foreground/82',
                  )}
                  onClick={() => handleToggleSessionTool(tool.id)}
                >
                  <Icon className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{label}</p>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>

      {/* 分屏模式切换 */}
      <SplitModeToggle />
    </div>
  )
}
