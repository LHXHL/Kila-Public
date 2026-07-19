/**
 * TabBar — 顶部标签栏
 *
 * 显示所有打开的标签页，支持：
 * - 点击切换标签
 * - 中键关闭标签
 * - 拖拽重排序
 * - 溢出时水平滚动
 * - 分屏模式切换按钮
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { FolderOpen, GitBranch, Globe, Wrench } from 'lucide-react'
import {
  tabsAtom,
  splitLayoutAtom,
  tabStreamingMapAtom,
  activeTabIdAtom,
  closeTab,
  focusTab,
  reorderTabs,
} from '@/atoms/tab-atoms'
import {
  sessionModelPreferencesAtom,
  sessionContextLengthPreferencesAtom,
  sessionThinkingLevelPreferencesAtom,
  sessionParallelModePreferencesAtom,
} from '@/atoms/session-preference-atoms'
import {
  agentSidePanelActiveToolMapAtom,
  agentSidePanelCloseRequestMapAtom,
  widgetDraftProposalMapAtom,
  type AgentSidePanelToolId,
} from '@/atoms/agent-atoms'
import { currentSessionIdAtom, sessionFileWorkbenchStateMapAtom } from '@/atoms/session-atoms'
import { cleanupSessionPinnedWidgetsAtom } from '@/atoms/session-board-atoms'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { TabBarItem } from './TabBarItem'
import { SplitModeToggle } from './SplitModeToggle'

const TAB_BAR_SESSION_TOOLS: Array<{
  id: AgentSidePanelToolId
  label: string
  icon: React.ComponentType<{ className?: string }>
}> = [
  { id: 'files', label: '文件工作台', icon: FolderOpen },
  { id: 'web', label: '网页预览', icon: Globe },
  { id: 'tools', label: '工具调用', icon: Wrench },
  { id: 'git', label: 'Git 状态', icon: GitBranch },
]

const SIDEPANEL_CLOSE_ANIMATION_MS = 180

export function TabBar(): React.ReactElement {
  const store = useStore()
  const [tabs, setTabs] = useAtom(tabsAtom)
  const setLayout = useSetAtom(splitLayoutAtom)
  const [sidePanelActiveToolMap, setSidePanelActiveToolMap] = useAtom(agentSidePanelActiveToolMapAtom)
  const [sidePanelCloseRequestMap, setSidePanelCloseRequestMap] = useAtom(agentSidePanelCloseRequestMapAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)
  const streamingMap = useAtomValue(tabStreamingMapAtom)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  // per-session Map atoms（用于关闭标签时清理）
  const setSessionModelPrefs = useSetAtom(sessionModelPreferencesAtom)
  const setSessionContextLengthPrefs = useSetAtom(sessionContextLengthPreferencesAtom)
  const setSessionThinkingPrefs = useSetAtom(sessionThinkingLevelPreferencesAtom)
  const setSessionParallelPrefs = useSetAtom(sessionParallelModePreferencesAtom)
  const setWidgetDraftProposalMap = useSetAtom(widgetDraftProposalMapAtom)
  const setSessionFileWorkbenchStateMap = useSetAtom(sessionFileWorkbenchStateMapAtom)
  const cleanupSessionPinnedWidgets = useSetAtom(cleanupSessionPinnedWidgetsAtom)
  const setCurrentSessionId = useSetAtom(currentSessionIdAtom)

  /** 清理关闭标签对应的 per-session Map atoms 条目 */
  const cleanupMapAtoms = React.useCallback((tabId: string) => {
    const deleteKey = <T,>(prev: Map<string, T>): Map<string, T> => {
      if (!prev.has(tabId)) return prev
      const map = new Map(prev)
      map.delete(tabId)
      return map
    }
    // Session preference atoms
    setSessionModelPrefs(deleteKey)
    setSessionContextLengthPrefs(deleteKey)
    setSessionThinkingPrefs(deleteKey)
    setSessionParallelPrefs(deleteKey)
    // Session runtime atoms
    setSidePanelActiveToolMap(deleteKey)
    setSidePanelCloseRequestMap(deleteKey)
    setWidgetDraftProposalMap(deleteKey)
    setSessionFileWorkbenchStateMap(deleteKey)
    cleanupSessionPinnedWidgets(tabId)
  }, [cleanupSessionPinnedWidgets, setSessionModelPrefs, setSessionContextLengthPrefs, setSessionThinkingPrefs, setSessionParallelPrefs, setSidePanelActiveToolMap, setSidePanelCloseRequestMap, setSessionFileWorkbenchStateMap, setWidgetDraftProposalMap])

  // 拖拽状态
  const dragState = React.useRef<{
    dragging: boolean
    tabId: string
    startX: number
    currentIndex: number
  } | null>(null)

  const handleActivate = React.useCallback((tabId: string) => {
    setLayout((prev) => focusTab(prev, tabId))
    const target = tabs.find((tab) => tab.id === tabId)
    if (!target) return
    setCurrentSessionId(target.sessionId)
  }, [setCurrentSessionId, setLayout, tabs])

  const handleClose = React.useCallback((tabId: string) => {
    const currentTabs = store.get(tabsAtom)
    const currentLayout = store.get(splitLayoutAtom)
    const result = closeTab(currentTabs, currentLayout, tabId)
    if (result.tabs === currentTabs) return

    // 同一事件内基于同一快照提交，避免延迟回写旧 layout 覆盖后续分屏操作。
    setTabs(result.tabs)
    setLayout(result.layout)

    const nextActiveTabId = result.layout.panels[result.layout.focusedPanelIndex]?.activeTabId ?? null
    const nextActiveTab = result.tabs.find((tab) => tab.id === nextActiveTabId) ?? null
    setCurrentSessionId(nextActiveTab?.sessionId ?? null)

    // 清理 per-session Map atoms 条目，防止内存泄漏
    cleanupMapAtoms(tabId)
  }, [cleanupMapAtoms, setCurrentSessionId, setLayout, setTabs, store])

  const handleDragStart = React.useCallback((tabId: string, e: React.PointerEvent) => {
    if (e.button !== 0) return // 只处理左键
    const idx = tabs.findIndex((t) => t.id === tabId)
    if (idx === -1) return

    dragState.current = {
      dragging: false,
      tabId,
      startX: e.clientX,
      currentIndex: idx,
    }

    const handleMove = (me: PointerEvent): void => {
      if (!dragState.current) return
      const dx = Math.abs(me.clientX - dragState.current.startX)
      if (dx > 5) dragState.current.dragging = true
      if (!dragState.current.dragging || !scrollRef.current) return

      const tabElements = Array.from(scrollRef.current.querySelectorAll<HTMLElement>('[data-tab-id]'))
      let targetIndex = tabElements.length - 1
      for (let index = 0; index < tabElements.length; index += 1) {
        const bounds = tabElements[index]!.getBoundingClientRect()
        if (me.clientX < bounds.left + bounds.width / 2) {
          targetIndex = index
          break
        }
      }

      if (targetIndex === dragState.current.currentIndex) return
      const fromIndex = dragState.current.currentIndex
      dragState.current.currentIndex = targetIndex
      setTabs((currentTabs) => reorderTabs(currentTabs, fromIndex, targetIndex))
    }

    const handleUp = (): void => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)
      dragState.current = null
    }

    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
  }, [setTabs, tabs])

  const handleMoveTab = React.useCallback((tabId: string, offset: -1 | 1): void => {
    setTabs((currentTabs) => {
      const fromIndex = currentTabs.findIndex((tab) => tab.id === tabId)
      if (fromIndex < 0) return currentTabs
      const toIndex = Math.max(0, Math.min(currentTabs.length - 1, fromIndex + offset))
      return reorderTabs(currentTabs, fromIndex, toIndex)
    })
  }, [setTabs])

  // 水平滚动支持
  const handleWheel = React.useCallback((e: React.WheelEvent) => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft += e.deltaY
    }
  }, [])

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

  if (tabs.length === 0) return <div className="h-[var(--kila-toolbar-height)] border-b border-border/30 bg-[hsl(var(--workspace))] titlebar-drag-region" />

  return (
    <div className="flex h-[var(--kila-toolbar-height)] items-center gap-2 border-b border-border/35 bg-[hsl(var(--workspace))] px-2">
      {/* 标签区域（可滚动） */}
      <div
        ref={scrollRef}
        role="tablist"
        aria-label="打开的会话"
        className="flex min-w-0 shrink items-center gap-1.5 overflow-x-auto scrollbar-none titlebar-no-drag"
        onWheel={handleWheel}
      >
        {tabs.map((tab, _index) => (
          <TabBarItem
            key={tab.id}
            id={tab.id}
            type={tab.type}
            title={tab.title}
            isActive={tab.id === activeTabId}
            isStreaming={streamingMap.get(tab.id) ?? false}
            onActivate={() => handleActivate(tab.id)}
            onClose={() => handleClose(tab.id)}
            onMiddleClick={() => handleClose(tab.id)}
            onMoveLeft={() => handleMoveTab(tab.id, -1)}
            onMoveRight={() => handleMoveTab(tab.id, 1)}
            onDragStart={(e) => handleDragStart(tab.id, e)}
          />
        ))}
      </div>

      {/* 空白拖拽区域：支持拖动窗口 */}
      <div className="flex-1 h-full titlebar-drag-region" />

      <div className="h-5 w-px shrink-0 bg-border/60 titlebar-no-drag" />
      <div className="flex shrink-0 items-center gap-1 titlebar-no-drag">
        {TAB_BAR_SESSION_TOOLS.map((tool) => {
          const Icon = tool.icon
          const active = activeSidePanelToolId === tool.id

          return (
            <Tooltip key={tool.id}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={tool.label}
                  aria-pressed={active}
                  disabled={!activeSessionId}
                  className={cn(
                    'size-8 rounded-lg border border-transparent text-muted-foreground/70 transition-colors',
                    active
                      ? 'border-primary/25 bg-[hsl(var(--kila-accent-muted))] text-primary'
                      : 'hover:border-border/55 hover:bg-muted/35 hover:text-foreground/82',
                  )}
                  onClick={() => handleToggleSessionTool(tool.id)}
                >
                  <Icon className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{tool.label}</p>
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
