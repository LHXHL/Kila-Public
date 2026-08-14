/**
 * LeftSidebar - 单一 Session 侧边栏
 *
 * 统一会话入口，所有会话均为 Agent 模式。
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Download,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  Plus,
  Search,
  Settings,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { OverlayScrollbarArea } from '@/components/ui/overlay-scrollbar'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { sessionsAtom, currentSessionIdAtom, sessionFileWorkbenchStateMapAtom } from '@/atoms/session-atoms'
import {
  sessionModelPreferencesAtom,
  sessionContextLengthPreferencesAtom,
  sessionThinkingLevelPreferencesAtom,
  sessionParallelModePreferencesAtom,
} from '@/atoms/session-preference-atoms'
import {
  agentRunningSessionIdsAtom,
  agentSidePanelActiveToolMapAtom,
} from '@/atoms/agent-atoms'
import {
  tabsAtom,
  splitLayoutAtom,
  activeTabIdAtom,
  sidebarCollapsedAtom,
  openTab,
  closeTab,
  updateTabTitle,
} from '@/atoms/tab-atoms'
import { userProfileAtom } from '@/atoms/user-profile'
import { hasUpdateAtom } from '@/atoms/updater'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { GlobalPendingRequestsButton } from '@/components/agent/GlobalPendingRequestsButton'
import { allPendingAskUserRequestsAtom, allPendingPermissionRequestsAtom } from '@/atoms/agent-permission-atoms'
import { EntityMetadataChip } from '@/components/ui/entity-metadata-chip'
import { WorkspaceEntityGroupHeader, WorkspaceEntityList } from '@/components/ui/workspace-entity-list'
import type { SessionMeta, SessionSearchResult } from '@kila/shared'
import { useTypeAhead } from '@/hooks/useTypeAhead'
import { SessionItem, groupByDate, type SessionItemProps } from './session-list-item'

/** DateGroup 直接作为 `sidebar.*` 译文 key；Translate 是 t(key) 的最小签名 */
type DateGroup = 'today' | 'yesterday' | 'earlier'
type WorkflowFilter = 'all' | 'running' | 'pending'

export interface LeftSidebarProps {
  width?: number
  /** 拖拽中禁用 width transition */
  isResizing?: boolean
}

export function LeftSidebar({ width, isResizing }: LeftSidebarProps): React.ReactElement {
  const { t } = useTranslation()
  const [sessions, setSessions] = useAtom(sessionsAtom)
  const [currentSessionId, setCurrentSessionId] = useAtom(currentSessionIdAtom)
  const setUserProfile = useSetAtom(userProfileAtom)
  const agentRunningSessionIds = useAtomValue(agentRunningSessionIdsAtom)
  const pendingPermissionMap = useAtomValue(allPendingPermissionRequestsAtom)
  const pendingAskUserMap = useAtomValue(allPendingAskUserRequestsAtom)
  const hasUpdate = useAtomValue(hasUpdateAtom)

  const [tabs, setTabs] = useAtom(tabsAtom)
  const [layout, setLayout] = useAtom(splitLayoutAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom)

  const setSessionModelPrefs = useSetAtom(sessionModelPreferencesAtom)
  const setSessionContextLengthPrefs = useSetAtom(sessionContextLengthPreferencesAtom)
  const setSessionThinkingPrefs = useSetAtom(sessionThinkingLevelPreferencesAtom)
  const setSessionParallelPrefs = useSetAtom(sessionParallelModePreferencesAtom)
  const setAgentSidePanelActiveTool = useSetAtom(agentSidePanelActiveToolMapAtom)
  const setSessionFileWorkbenchStateMap = useSetAtom(sessionFileWorkbenchStateMapAtom)

  const [pinnedExpanded, setPinnedExpanded] = React.useState(true)
  const [workflowFilter, setWorkflowFilter] = React.useState<WorkflowFilter>('all')
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null)
  const [deleteSubmitting, setDeleteSubmitting] = React.useState<boolean>(false)
  // 批量选择/删除
  const [selectMode, setSelectMode] = React.useState<boolean>(false)
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [pendingBatchDelete, setPendingBatchDelete] = React.useState<boolean>(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editValue, setEditValue] = React.useState('')
  const [sessionSearch, setSessionSearch] = React.useState('')
  const [sessionSearchResults, setSessionSearchResults] = React.useState<SessionSearchResult[]>([])
  const [sessionSearchLoading, setSessionSearchLoading] = React.useState(false)
  const sessionListRef = React.useRef<HTMLDivElement>(null)

  const refreshAllLists = React.useCallback(async (): Promise<void> => {
    const [sessionList, userProfile] = await Promise.all([
      window.electronAPI.listSessions(),
      window.electronAPI.getUserProfile(),
    ])

    setSessions(sessionList)
    setUserProfile(userProfile)
  }, [setSessions, setUserProfile])

  React.useEffect(() => {
    refreshAllLists().catch(console.error)
  }, [refreshAllLists])

  React.useEffect(() => {
    const query = sessionSearch.trim()
    if (query.length < 2) {
      setSessionSearchResults([])
      setSessionSearchLoading(false)
      return
    }

    let cancelled = false
    setSessionSearchLoading(true)
    const timer = window.setTimeout(() => {
      window.electronAPI.searchSessions({ query, limitPerType: 6 })
        .then((result) => {
          if (!cancelled) setSessionSearchResults(result.results)
        })
        .catch((error) => {
          console.error('[Session Search] 搜索失败:', error)
          if (!cancelled) setSessionSearchResults([])
        })
        .finally(() => {
          if (!cancelled) setSessionSearchLoading(false)
        })
    }, 160)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [sessionSearch])

  const syncSelection = React.useCallback((id: string | null): void => {
    setCurrentSessionId(id)
  }, [setCurrentSessionId])

  const cleanupMapAtoms = React.useCallback((id: string): void => {
    const deleteKey = <T,>(prev: Map<string, T>): Map<string, T> => {
      if (!prev.has(id)) return prev
      const map = new Map(prev)
      map.delete(id)
      return map
    }

    setSessionModelPrefs(deleteKey)
    setSessionContextLengthPrefs(deleteKey)
    setSessionThinkingPrefs(deleteKey)
    setSessionParallelPrefs(deleteKey)
    setAgentSidePanelActiveTool(deleteKey)
    setSessionFileWorkbenchStateMap(deleteKey)
  }, [setAgentSidePanelActiveTool, setSessionContextLengthPrefs, setSessionModelPrefs, setSessionParallelPrefs, setSessionThinkingPrefs, setSessionFileWorkbenchStateMap])

  const handleCreateSession = React.useCallback(async (): Promise<void> => {
    const session = await window.electronAPI.createSession({
      title: t('sidebar.newSession'),
    })

    const sessionList = await window.electronAPI.listSessions()
    setSessions(sessionList)

    const result = openTab(tabs, layout, {
      type: 'agent',
      sessionId: session.id,
      title: session.title,
    })
    setTabs(result.tabs)
    setLayout(result.layout)
    syncSelection(session.id)
  }, [layout, setLayout, setSessions, setTabs, syncSelection, t, tabs])

  const handleExportCurrentSession = React.useCallback(async (): Promise<void> => {
    if (!currentSessionId) return
    const result = await window.electronAPI.exportSession({
      sessionId: currentSessionId,
      includeAttachments: true,
    })
    if (!result.canceled && result.exportDir) {
      console.info('[Session Export] 导出完成:', result)
    }
  }, [currentSessionId])

  const handleImportSession = React.useCallback(async (): Promise<void> => {
    const preview = await window.electronAPI.importSession({ dryRun: true })
    if (preview.canceled || !preview.sourceDir) return

    const confirmed = window.confirm(t('sidebar.importConfirm', { title: preview.title ?? 'Untitled', messages: preview.messageCount ?? 0, attachments: preview.attachmentCount ?? 0, widgets: preview.boardWidgetCount ?? 0 }))
    if (!confirmed) return

    const result = await window.electronAPI.importSession({
      sourceDir: preview.sourceDir,
      dryRun: false,
    })
    if (result.canceled || !result.sessionId) return

    const sessionList = await window.electronAPI.listSessions()
    setSessions(sessionList)
    const session = sessionList.find((candidate) => candidate.id === result.sessionId)
    const tabResult = openTab(tabs, layout, {
      type: 'agent',
      sessionId: result.sessionId,
      title: session?.title ?? result.title ?? t('sidebar.importedSession'),
    })
    setTabs(tabResult.tabs)
    setLayout(tabResult.layout)
    syncSelection(result.sessionId)
  }, [layout, setLayout, setSessions, setTabs, syncSelection, t, tabs])

  const handleSelectSession = React.useCallback((session: SessionMeta): void => {
    const result = openTab(tabs, layout, {
      type: 'agent',
      sessionId: session.id,
      title: session.title,
    })
    setTabs(result.tabs)
    setLayout(result.layout)
    syncSelection(session.id)
  }, [layout, setLayout, setTabs, syncSelection, tabs])

  const handleOpenSearchResult = React.useCallback((result: SessionSearchResult): void => {
    const session = sessions.find((candidate) => candidate.id === result.sessionId)
    const tabResult = openTab(tabs, layout, {
      type: 'agent',
      sessionId: result.sessionId,
      title: session?.title ?? result.title,
    })
    setTabs(tabResult.tabs)
    setLayout(tabResult.layout)
    syncSelection(result.sessionId)
    setSessionSearch('')
    setSessionSearchResults([])
  }, [layout, sessions, setLayout, setTabs, syncSelection, tabs])

  const handleTogglePin = React.useCallback(async (sessionId: string): Promise<void> => {
    const updated = await window.electronAPI.togglePinSession(sessionId)
    setSessions((prev) => prev.map((session) => (session.id === updated.id ? updated : session)))
    void refreshAllLists()
  }, [refreshAllLists, setSessions])

  const handleRename = React.useCallback(async (): Promise<void> => {
    if (!editingId) return
    const trimmed = editValue.trim()
    const targetId = editingId

    if (!trimmed) {
      setEditingId(null)
      setEditValue('')
      return
    }

    const updated = await window.electronAPI.updateSessionTitle(targetId, trimmed)
    setSessions((prev) => prev.map((session) => (session.id === updated.id ? updated : session)))
    setTabs((prev) => updateTabTitle(prev, updated.id, updated.title))
    setEditingId(null)
    setEditValue('')
    void refreshAllLists()
  }, [editValue, editingId, refreshAllLists, setSessions, setTabs])

  const handleConfirmDelete = React.useCallback(async (): Promise<void> => {
    if (!pendingDeleteId) return

    const targetId = pendingDeleteId
    setDeleteSubmitting(true)

    try {
      const tabResult = closeTab(tabs, layout, targetId)
      setTabs(tabResult.tabs)
      setLayout(tabResult.layout)
      cleanupMapAtoms(targetId)

      await window.electronAPI.deleteSession(targetId)

      setSessions((prev) => prev.filter((session) => session.id !== targetId))
      if (currentSessionId === targetId) {
        const focusedPanel = tabResult.layout.panels[tabResult.layout.focusedPanelIndex]
        syncSelection(focusedPanel?.activeTabId ?? null)
      }

      setPendingDeleteId(null)
      void refreshAllLists()
    } finally {
      setDeleteSubmitting(false)
    }
  }, [cleanupMapAtoms, currentSessionId, layout, pendingDeleteId, refreshAllLists, setLayout, setSessions, setTabs, syncSelection, tabs])

  const toggleSelectMode = React.useCallback((): void => {
    setSelectMode((prev) => {
      if (prev) setSelectedIds(new Set())
      return !prev
    })
  }, [])

  const toggleSelectSession = React.useCallback((sessionId: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }, [])

  const handleConfirmBatchDelete = React.useCallback(async (): Promise<void> => {
    if (selectedIds.size === 0) return
    setDeleteSubmitting(true)

    const targetIds = Array.from(selectedIds)
    let nextTabs = tabs
    let nextLayout = layout
    try {
      for (const targetId of targetIds) {
        const tabResult = closeTab(nextTabs, nextLayout, targetId)
        nextTabs = tabResult.tabs
        nextLayout = tabResult.layout
        cleanupMapAtoms(targetId)
        // 复用单会话删除入口（内部走 deleteSessionWithCleanup），逐个清理运行时/磁盘态。
        await window.electronAPI.deleteSession(targetId)
      }
      setTabs(nextTabs)
      setLayout(nextLayout)

      const removed = new Set(targetIds)
      setSessions((prev) => prev.filter((session) => !removed.has(session.id)))
      if (currentSessionId && removed.has(currentSessionId)) {
        const focusedPanel = nextLayout.panels[nextLayout.focusedPanelIndex]
        syncSelection(focusedPanel?.activeTabId ?? null)
      }

      setSelectedIds(new Set())
      setSelectMode(false)
      setPendingBatchDelete(false)
      void refreshAllLists()
    } finally {
      setDeleteSubmitting(false)
    }
  }, [cleanupMapAtoms, currentSessionId, layout, refreshAllLists, selectedIds, setLayout, setSessions, setTabs, syncSelection, tabs])

  const pendingSessionIds = React.useMemo(() => {
    const ids = new Set<string>()
    for (const [sessionId, requests] of pendingPermissionMap) {
      if (requests.length > 0) ids.add(sessionId)
    }
    for (const [sessionId, requests] of pendingAskUserMap) {
      if (requests.length > 0) ids.add(sessionId)
    }
    return ids
  }, [pendingAskUserMap, pendingPermissionMap])

  const filteredSessions = React.useMemo(
    () => sessions.filter((session) => {
      if (workflowFilter === 'running') return agentRunningSessionIds.has(session.id)
      if (workflowFilter === 'pending') return pendingSessionIds.has(session.id)
      return true
    }),
    [agentRunningSessionIds, pendingSessionIds, sessions, workflowFilter],
  )

  const pinnedSessions = React.useMemo(() => filteredSessions.filter((session) => session.pinned), [filteredSessions])
  const regularGroups = React.useMemo(() => groupByDate(filteredSessions.filter((session) => !session.pinned)), [filteredSessions])

  const workflowFilters = React.useMemo<Array<{ id: WorkflowFilter; label: string; count: number }>>(() => [
    { id: 'all', label: t('sidebar.filterAll'), count: sessions.length },
    { id: 'running', label: t('sidebar.filterRunning'), count: sessions.filter((session) => agentRunningSessionIds.has(session.id)).length },
    { id: 'pending', label: t('sidebar.filterPending'), count: sessions.filter((session) => pendingSessionIds.has(session.id)).length },
  ], [agentRunningSessionIds, pendingSessionIds, sessions, t])
  const allFilteredSelected = filteredSessions.length > 0 && filteredSessions.every((session) => selectedIds.has(session.id))

  const isStreaming = React.useCallback((session: SessionMeta): boolean => {
    return agentRunningSessionIds.has(session.id)
  }, [agentRunningSessionIds])

  // 稳定回调：用 ref 承接易变的 handleSelectSession / handleRename / handleTogglePin，
  // 使传给 SessionItem 的回调引用恒定，配合 React.memo 让标题编辑、选中态变化等
  // 只重渲染受影响的行，而非整个会话列表。
  const sidebarHandlersRef = React.useRef({ handleSelectSession, handleRename, handleTogglePin })
  sidebarHandlersRef.current = { handleSelectSession, handleRename, handleTogglePin }

  const stableOnSelect = React.useCallback((session: SessionMeta) => {
    sidebarHandlersRef.current.handleSelectSession(session)
  }, [])
  const stableOnStartEdit = React.useCallback((session: SessionMeta) => {
    setEditingId(session.id)
    setEditValue(session.title)
  }, [])
  const stableOnEditSubmit = React.useCallback(() => {
    void sidebarHandlersRef.current.handleRename()
  }, [])
  const stableOnEditCancel = React.useCallback(() => {
    setEditingId(null)
    setEditValue('')
  }, [])
  const stableOnTogglePin = React.useCallback((sessionId: string) => {
    void sidebarHandlersRef.current.handleTogglePin(sessionId)
  }, [])
  const stableOnRequestDelete = React.useCallback((sessionId: string) => {
    setPendingDeleteId(sessionId)
  }, [])

  const renderSessionItem = (session: SessionMeta): React.ReactElement => (
    <SessionItem
      key={session.id}
      session={session}
      active={session.id === activeTabId}
      streaming={isStreaming(session)}
      editing={editingId === session.id}
      editValue={editingId === session.id ? editValue : session.title}
      selectMode={selectMode}
      checked={selectedIds.has(session.id)}
      onToggleSelect={toggleSelectSession}
      onSelect={stableOnSelect}
      onStartEdit={stableOnStartEdit}
      onEditChange={setEditValue}
      onEditSubmit={stableOnEditSubmit}
      onEditCancel={stableOnEditCancel}
      onTogglePin={stableOnTogglePin}
      onRequestDelete={stableOnRequestDelete}
    />
  )

  // Native-feel: type-ahead 按键跳转到匹配的会话
  const allVisibleSessions = React.useMemo(
    () => [...pinnedSessions, ...regularGroups.flatMap((g) => g.items)],
    [pinnedSessions, regularGroups],
  )
  const { onKeyDown: handleTypeAhead } = useTypeAhead({
    items: allVisibleSessions,
    getLabel: (session) => session.title,
    onMatch: (session) => {
      handleSelectSession(session)
      // 滚动到匹配项
      const el = sessionListRef.current?.querySelector(`[data-session-id="${session.id}"]`)
      el?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
    },
    enabled: !sessionSearch && !editingId,
  })

  if (sidebarCollapsed) {
    return (
      <div className="relative z-[var(--kila-z-panel)] h-full bg-transparent transition-[width] duration-300" style={{ width: 64, flexShrink: 0 }}>
        <div className="h-full p-[var(--kila-panel-edge-inset)] pr-1.5">
          <div className="workspace-floating-panel flex h-full flex-col items-center overflow-hidden rounded-xl">
            <div className="pt-[50px]" />
            <div className="pt-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setSidebarCollapsed(false)}
                    className="titlebar-no-drag rounded-lg p-2 text-foreground/60 transition-colors hover:bg-muted/60 hover:text-foreground"
                  >
                    <PanelLeftOpen size={18} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{t('sidebar.expand')}</TooltipContent>
              </Tooltip>
            </div>

            <div className="pt-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => { void handleCreateSession() }}
                    className="workspace-floating-control titlebar-no-drag rounded-lg p-2 text-foreground/70 transition-colors"
                  >
                    <Plus size={16} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{t('sidebar.newSession')}</TooltipContent>
              </Tooltip>
            </div>

            <div className="flex-1" />

            <div className="pb-3">
              <div className="mb-2">
                <GlobalPendingRequestsButton collapsed />
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => { void window.electronAPI.openSettingsWindow('general') }}
                    className="workspace-floating-control titlebar-no-drag relative rounded-lg p-2 text-foreground/78 transition-colors hover:text-foreground"
                  >
                    <Settings size={18} />
                    {hasUpdate && (
                      <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-status-danger" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{t('sidebar.settings')}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={cn(
      'relative z-[var(--kila-z-panel)] h-full bg-transparent',
      !isResizing && 'transition-[width] duration-300',
    )} style={{ width: width ?? 300, minWidth: 248, flexShrink: 1 }}>
      <div className="h-full p-[var(--kila-panel-edge-inset)]">
        <div className="workspace-floating-panel flex h-full flex-col overflow-hidden rounded-xl">
          <div className="pt-[50px]">
            <div className="flex items-center gap-1 pl-3 pr-1">
              <button
                onClick={() => { void handleCreateSession() }}
                className="workspace-floating-control titlebar-no-drag flex h-10 flex-1 items-center gap-2 rounded-lg px-3 text-[13px] font-medium text-foreground/70 transition-colors hover:text-foreground"
              >
                <Plus size={14} />
                <span>{t('sidebar.newSession')}</span>
              </button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => { void handleImportSession() }}
                    className="titlebar-no-drag mt-0.5 flex size-10 items-center justify-center rounded-lg text-foreground/45 transition-colors hover:bg-muted/55 hover:text-foreground/70"
                  >
                    <Upload size={16} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{t('sidebar.importSession')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => { void handleExportCurrentSession() }}
                    disabled={!currentSessionId}
                    className="titlebar-no-drag mt-0.5 flex size-10 items-center justify-center rounded-lg text-foreground/45 transition-colors hover:bg-muted/55 hover:text-foreground/70 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <Download size={16} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{t('sidebar.exportSession')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={toggleSelectMode}
                    data-selected={selectMode ? 'true' : undefined}
                    className="titlebar-no-drag mt-0.5 flex size-10 items-center justify-center rounded-lg text-foreground/45 transition-colors hover:bg-muted/55 hover:text-foreground/70 data-[selected=true]:bg-brand-soft data-[selected=true]:text-brand-soft-foreground"
                  >
                    <ListChecks size={16} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{selectMode ? t('sidebar.exitSelectMode') : t('sidebar.selectMode')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setSidebarCollapsed(true)}
                    className="titlebar-no-drag mt-0.5 flex size-10 items-center justify-center rounded-lg text-foreground/40 transition-colors hover:bg-muted/55 hover:text-foreground/60"
                  >
                    <PanelLeftClose size={18} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{t('sidebar.collapse')}</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col pb-2 pl-3 pr-0.5 pt-3">
            <div className="titlebar-no-drag mb-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
                <input
                  value={sessionSearch}
                  onChange={(event) => setSessionSearch(event.target.value)}
                  placeholder={t('sidebar.searchPlaceholder')}
                  className="workspace-floating-control h-9 w-full rounded-lg pl-8 pr-3 text-[12.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/62 focus:border-primary/35 focus:bg-workspace"
                />
              </div>
              {sessionSearch.trim().length >= 2 && (
                <div className="workspace-floating-control mt-2 overflow-hidden rounded-lg bg-workspace">
                  {sessionSearchLoading && (
                    <div className="px-3 py-2 text-[12px] text-muted-foreground">{t('sidebar.searching')}</div>
                  )}
                  {!sessionSearchLoading && sessionSearchResults.length === 0 && (
                    <div className="px-3 py-2 text-[12px] text-muted-foreground">{t('sidebar.noResults')}</div>
                  )}
                  {!sessionSearchLoading && sessionSearchResults.map((result) => (
                    <button
                      key={`${result.type}:${result.sessionId}:${result.messageId ?? result.title}`}
                      type="button"
                      onClick={() => handleOpenSearchResult(result)}
                      className="flex w-full min-w-0 flex-col gap-0.5 border-b border-border/50 px-3 py-2 text-left last:border-b-0 hover:bg-muted/70"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-normal text-muted-foreground">
                          {t(result.type === 'message' ? 'sidebar.resultMessage' : result.type === 'project' ? 'sidebar.resultProject' : 'sidebar.resultSession')}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">{result.title}</span>
                      </span>
                      <span className="line-clamp-2 text-[11.5px] leading-4 text-muted-foreground">{result.snippet || result.subtitle}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="titlebar-no-drag mb-3 flex gap-1">
              {workflowFilters.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setWorkflowFilter(filter.id)}
                  data-selected={workflowFilter === filter.id ? 'true' : undefined}
                  className="interactive-row flex min-w-0 items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-muted-foreground"
                >
                  <span className="min-w-0 flex-1 truncate">{filter.label}</span>
                  <span className="tabular-nums text-[10px]">{filter.count}</span>
                </button>
              ))}
            </div>
            {selectMode && (
              <div className="titlebar-no-drag mb-3 flex items-center gap-2 rounded-lg bg-brand-soft px-2.5 py-1.5 text-[12px] text-brand-soft-foreground">
                <span className="tabular-nums">{t('sidebar.selectedCount', { count: selectedIds.size })}</span>
                <button
                  type="button"
                  onClick={() => setSelectedIds(allFilteredSelected ? new Set() : new Set(filteredSessions.map((session) => session.id)))}
                  className="rounded-md px-2 py-1 hover:bg-background/40"
                >
                  {allFilteredSelected ? t('sidebar.deselectAll') : t('sidebar.selectAll')}
                </button>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => { if (selectedIds.size > 0) setPendingBatchDelete(true) }}
                  disabled={selectedIds.size === 0}
                  className="flex items-center gap-1 rounded-md bg-destructive px-2 py-1 text-destructive-foreground hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2 className="size-3.5" />
                  <span>{t('common.delete')}</span>
                </button>
              </div>
            )}
            <OverlayScrollbarArea
              className="kila-sidebar-scroll min-h-0 flex-1 overflow-y-auto px-0"
              options={{ overflow: { x: 'hidden', y: 'scroll' } }}
            >
              <div ref={sessionListRef} className="flex flex-col gap-1" onKeyDown={handleTypeAhead} tabIndex={-1}>
                <button
                  type="button"
                  onClick={() => setPinnedExpanded((prev) => !prev)}
                  className="titlebar-no-drag flex items-center justify-between rounded-lg px-3 py-2 text-[12px] font-medium text-foreground/60 transition-colors hover:bg-muted/55 hover:text-foreground"
                >
                  <span className="flex items-center gap-2">
                    <Pin size={15} />
                    <span>{t('sidebar.pinned')}</span>
                    <EntityMetadataChip>{pinnedSessions.length}</EntityMetadataChip>
                  </span>
                  {pinnedSessions.length > 0 && (
                    pinnedExpanded
                      ? <ChevronDown size={14} className="text-foreground/40" />
                      : <ChevronRight size={14} className="text-foreground/40" />
                  )}
                </button>

                {pinnedExpanded && pinnedSessions.length > 0 && (
                  <WorkspaceEntityList className="ml-2 border-l border-border/70 pl-2">
                    {pinnedSessions.map(renderSessionItem)}
                  </WorkspaceEntityList>
                )}
              </div>

              <div className="mt-3 space-y-3">
                {regularGroups.map((group) => (
                  <div key={group.label}>
                    <WorkspaceEntityGroupHeader>
                      <span>{t(`sidebar.${group.label}`)}</span>
                      <span>{group.items.length}</span>
                    </WorkspaceEntityGroupHeader>
                    <WorkspaceEntityList>
                      {group.items.map(renderSessionItem)}
                    </WorkspaceEntityList>
                  </div>
                ))}
                {filteredSessions.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center text-xs leading-5 text-muted-foreground">
                    {t('sidebar.emptyFiltered')}
                  </div>
                )}
              </div>
            </OverlayScrollbarArea>
          </div>

          <div className="relative z-10 shrink-0 bg-transparent px-3 pb-[var(--kila-panel-edge-inset)] pt-1.5">
            <div className="mb-1">
              <GlobalPendingRequestsButton />
            </div>
            <button
              type="button"
              onClick={() => { void window.electronAPI.openSettingsWindow('general') }}
              className="titlebar-no-drag flex h-10 w-full items-center gap-2 rounded-lg px-3 text-[13px] font-medium text-foreground/55 transition-colors hover:bg-muted/50 hover:text-foreground/78"
            >
              <Settings size={16} />
              <span>{t('sidebar.settings')}</span>
              {hasUpdate && (
                <span className="ml-auto h-2 w-2 rounded-full bg-status-danger" />
              )}
            </button>
          </div>
        </div>
      </div>

      <AlertDialog open={pendingDeleteId !== null} onOpenChange={(open) => {
        if (!open && !deleteSubmitting) setPendingDeleteId(null)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sidebar.confirmDelete')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('sidebar.deleteWarning')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSubmitting}>{t('sidebar.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void handleConfirmDelete()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteSubmitting}
            >
              {deleteSubmitting ? t('sidebar.deleting') : t('sidebar.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingBatchDelete} onOpenChange={(open) => {
        if (!open && !deleteSubmitting) setPendingBatchDelete(false)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sidebar.confirmBatchDelete')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('sidebar.batchDeleteWarning', { count: selectedIds.size })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSubmitting}>{t('sidebar.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void handleConfirmBatchDelete()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteSubmitting}
            >
              {deleteSubmitting ? t('sidebar.deleting') : t('sidebar.deleteCount', { count: selectedIds.size })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
