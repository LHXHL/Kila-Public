/**
 * Tab Atoms — 标签页和分屏布局状态管理
 *
 * 支持浏览器风格的多标签页 + 最多 4 面板分屏。
 * 当前所有标签页都承载统一 Agent 会话。
 */

import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import {
  agentRunningSessionIdsAtom,
} from './agent-atoms'

// ===== 类型定义 =====

/** 标签页类型（设置不作为 Tab，改走独立原生窗口） */
export type TabType = 'agent'

/** 标签页数据 */
export interface TabItem {
  /** 唯一标签 ID（直接使用 sessionId） */
  id: string
  /** 标签页类型 */
  type: TabType
  /** 统一 Session ID */
  sessionId: string
  /** 标签页显示标题 */
  title: string
}

/** 分屏布局模式 */
export type SplitMode = 'single' | 'horizontal-2' | 'vertical-2' | 'grid-4'

/** 分屏面板 */
export interface SplitPanel {
  /** 面板位置索引（0-3） */
  index: number
  /** 该面板激活的标签 ID（null = 空面板） */
  activeTabId: string | null
}

/** 分屏布局状态 */
export interface SplitLayoutState {
  /** 布局模式 */
  mode: SplitMode
  /** 面板列表（1-4 个面板） */
  panels: SplitPanel[]
  /** 当前焦点面板索引 */
  focusedPanelIndex: number
}

/** Tab 持久化数据（保存到 settings.json） */
export interface PersistedTabState {
  tabs: TabItem[]
  splitLayout: SplitLayoutState
}

const SPLIT_MODES = new Set<SplitMode>(['single', 'horizontal-2', 'vertical-2', 'grid-4'])

interface RestorableTabState {
  tabs: Array<{
    id: string
    type: string
    sessionId: string
    title: string
  }>
  splitLayout: {
    mode: string
    panels: Array<{ index: number; activeTabId: string | null }>
    focusedPanelIndex: number
  }
}

export function restorePersistedTabState(
  persisted: RestorableTabState | undefined,
  validSessionIds: ReadonlySet<string>,
): PersistedTabState | null {
  if (!persisted || !Array.isArray(persisted.tabs)) return null

  const seenSessionIds = new Set<string>()
  const tabs = persisted.tabs.flatMap((tab): TabItem[] => {
    if (tab?.type !== 'agent' || typeof tab.sessionId !== 'string' || !validSessionIds.has(tab.sessionId)) return []
    if (seenSessionIds.has(tab.sessionId)) return []
    seenSessionIds.add(tab.sessionId)
    return [{
      id: tab.sessionId,
      type: 'agent',
      sessionId: tab.sessionId,
      title: typeof tab.title === 'string' && tab.title.trim() ? tab.title : '新会话',
    }]
  })
  if (tabs.length === 0) return null

  const rawMode = persisted.splitLayout?.mode
  const mode: SplitMode = SPLIT_MODES.has(rawMode as SplitMode) ? rawMode as SplitMode : 'single'
  const panelCount = mode === 'grid-4' ? 4 : mode === 'single' ? 1 : 2
  const tabIds = new Set(tabs.map((tab) => tab.id))
  const assignedTabIds = new Set<string>()
  const panels = Array.from({ length: panelCount }, (_, index): SplitPanel => {
    const candidate = persisted.splitLayout?.panels?.[index]?.activeTabId ?? null
    const activeTabId = candidate && tabIds.has(candidate) && !assignedTabIds.has(candidate)
      ? candidate
      : null
    if (activeTabId) assignedTabIds.add(activeTabId)
    return { index, activeTabId }
  })
  const rawFocusedIndex = Number.isFinite(persisted.splitLayout?.focusedPanelIndex)
    ? persisted.splitLayout.focusedPanelIndex
    : 0
  const focusedPanelIndex = Math.max(0, Math.min(rawFocusedIndex, panels.length - 1))
  if (panels.every((panel) => panel.activeTabId === null)) {
    panels[focusedPanelIndex] = { ...panels[focusedPanelIndex]!, activeTabId: tabs[0]!.id }
  }

  return {
    tabs,
    splitLayout: { mode, panels, focusedPanelIndex },
  }
}

// ===== 默认值 =====

const DEFAULT_SPLIT_LAYOUT: SplitLayoutState = {
  mode: 'single',
  panels: [{ index: 0, activeTabId: null }],
  focusedPanelIndex: 0,
}

// ===== 核心 Atoms =====

/** 所有打开的标签页列表（有序；标签栏已移除，仅作为分屏面板的会话载体） */
export const tabsAtom = atom<TabItem[]>([])

/** 分屏布局状态 */
export const splitLayoutAtom = atom<SplitLayoutState>(DEFAULT_SPLIT_LAYOUT)

/** 侧边栏是否收起（持久化） */
export const sidebarCollapsedAtom = atomWithStorage<boolean>(
  'kila-sidebar-collapsed',
  false,
)

/** 侧边栏宽度（持久化） */
export const sidebarWidthAtom = atomWithStorage<number>(
  'kila-sidebar-width',
  312,
)

// ===== 派生 Atoms =====

/** 当前焦点面板的活跃标签 ID */
export const activeTabIdAtom = atom<string | null>((get) => {
  const layout = get(splitLayoutAtom)
  const focusedPanel = layout.panels[layout.focusedPanelIndex]
  return focusedPanel?.activeTabId ?? null
})

/** 当前焦点面板的活跃标签 */
export const activeTabAtom = atom<TabItem | null>((get) => {
  const activeId = get(activeTabIdAtom)
  if (!activeId) return null
  return get(tabsAtom).find((t) => t.id === activeId) ?? null
})

/** 标签是否在流式输出中（派生，从现有流式 atoms 计算） */
export const tabStreamingMapAtom = atom<Map<string, boolean>>((get) => {
  const tabs = get(tabsAtom)
  const agentRunning = get(agentRunningSessionIdsAtom)
  const map = new Map<string, boolean>()
  for (const tab of tabs) {
    map.set(tab.id, agentRunning.has(tab.sessionId))
  }
  return map
})

// ===== 操作函数 =====

/** 打开或聚焦标签页（如果已存在则聚焦，否则创建新标签） */
export function openTab(
  tabs: TabItem[],
  layout: SplitLayoutState,
  item: { type: TabType; sessionId: string; title: string },
): { tabs: TabItem[]; layout: SplitLayoutState } {
  const existingTab = tabs.find((t) => t.sessionId === item.sessionId)

  if (existingTab) {
    const nextTabs = tabs.map((tab) => (
      tab.sessionId === item.sessionId
        ? { ...tab, title: item.title }
        : tab
    ))
    const newLayout = focusTab(layout, existingTab.id)
    return { tabs: nextTabs, layout: newLayout }
  }

  // 创建新标签
  const newTab: TabItem = {
    id: item.sessionId,
    type: item.type,
    sessionId: item.sessionId,
    title: item.title,
  }

  const newTabs = [...tabs, newTab]

  // 在焦点面板中激活新标签
  const newPanels = layout.panels.map((panel, idx) =>
    idx === layout.focusedPanelIndex
      ? { ...panel, activeTabId: newTab.id }
      : panel
  )

  return {
    tabs: newTabs,
    layout: { ...layout, panels: newPanels },
  }
}

/** 关闭标签页 */
export function closeTab(
  tabs: TabItem[],
  layout: SplitLayoutState,
  tabId: string,
): { tabs: TabItem[]; layout: SplitLayoutState } {
  const tabIndex = tabs.findIndex((t) => t.id === tabId)
  if (tabIndex === -1) return { tabs, layout }

  const newTabs = tabs.filter((t) => t.id !== tabId)

  // 更新所有面板：如果面板的活跃标签被关闭，切换到相邻标签
  const newPanels = layout.panels.map((panel) => {
    if (panel.activeTabId !== tabId) return panel

    // 找到相邻标签（优先右侧，其次左侧）
    let nextTabId: string | null = null
    if (newTabs.length > 0) {
      const nextIndex = Math.min(tabIndex, newTabs.length - 1)
      nextTabId = newTabs[nextIndex]!.id
    }

    return { ...panel, activeTabId: nextTabId }
  })

  return {
    tabs: newTabs,
    layout: { ...layout, panels: newPanels },
  }
}

/** 聚焦到指定标签（在焦点面板中激活） */
export function focusTab(
  layout: SplitLayoutState,
  tabId: string,
): SplitLayoutState {
  // 先检查是否已在某个面板中激活
  const panelIndex = layout.panels.findIndex((p) => p.activeTabId === tabId)
  if (panelIndex >= 0) {
    const focusedPanel = layout.panels[layout.focusedPanelIndex]
    // 空面板已获得焦点时，把标签移动到这里；同一会话不会在多个 Pane 中重复渲染。
    if (panelIndex !== layout.focusedPanelIndex && focusedPanel && focusedPanel.activeTabId === null) {
      const panels = layout.panels.map((panel, index) => {
        if (index === panelIndex) return { ...panel, activeTabId: null }
        if (index === layout.focusedPanelIndex) return { ...panel, activeTabId: tabId }
        return panel
      })
      return { ...layout, panels }
    }
    // 已在面板中 → 切换焦点到该面板
    return { ...layout, focusedPanelIndex: panelIndex }
  }

  // 不在任何面板 → 在焦点面板中激活
  const newPanels = layout.panels.map((panel, idx) =>
    idx === layout.focusedPanelIndex
      ? { ...panel, activeTabId: tabId }
      : panel
  )
  return { ...layout, panels: newPanels }
}

/** 重排标签顺序 */
export function reorderTabs(
  tabs: TabItem[],
  fromIndex: number,
  toIndex: number,
): TabItem[] {
  if (fromIndex === toIndex) return tabs
  const newTabs = [...tabs]
  const [moved] = newTabs.splice(fromIndex, 1)
  newTabs.splice(toIndex, 0, moved!)
  return newTabs
}

/** 更新标签标题 */
export function updateTabTitle(
  tabs: TabItem[],
  sessionId: string,
  title: string,
): TabItem[] {
  return tabs.map((t) =>
    t.sessionId === sessionId ? { ...t, title } : t
  )
}

/** 更新标签 runtime 类型 */
export function updateTabType(
  tabs: TabItem[],
  sessionId: string,
  type: TabType,
): TabItem[] {
  return tabs.map((tab) => (
    tab.sessionId === sessionId ? { ...tab, type } : tab
  ))
}

/** 设置分屏模式 */
export function setSplitMode(
  layout: SplitLayoutState,
  mode: SplitMode,
): SplitLayoutState {
  const panelCount = mode === 'single' ? 1
    : mode === 'horizontal-2' || mode === 'vertical-2' ? 2
    : 4

  // 保留现有面板，补充不足的
  const panels: SplitPanel[] = []
  for (let i = 0; i < panelCount; i++) {
    panels.push(
      layout.panels[i] ?? { index: i, activeTabId: null }
    )
  }

  return {
    mode,
    panels: panels.map((p, i) => ({ ...p, index: i })),
    focusedPanelIndex: Math.min(layout.focusedPanelIndex, panelCount - 1),
  }
}
