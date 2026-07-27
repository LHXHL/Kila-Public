import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Clock3, FolderOpen, FolderSearch, Loader2, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { OverlayScrollbarArea } from '@/components/ui/overlay-scrollbar'
import { FileBrowser, FilePreviewPanel } from '@/components/file-browser'
import {
  sessionFileWorkbenchStateMapAtom,
  sessionWorkbenchExplorerWidthAtom,
  sessionsAtom,
} from '@/atoms/session-atoms'
import {
  sessionPinnedWidgetsMapAtom,
  setSessionPinnedWidgetsAtom,
} from '@/atoms/session-board-atoms'
import { agentSidePanelActiveToolMapAtom, type AgentSidePanelToolId } from '@/atoms/agent-atoms'
import { useSessionWebPreview } from '@/hooks/useSessionWebPreview'
import {
  clampSessionWorkbenchExplorerWidth,
  createEmptyWorkbenchState,
  getActiveWorkbenchItem,
  openWorkbenchFile,
  pruneWorkbenchWidgets,
  SESSION_WORKBENCH_EXPLORER_WIDTH_DEFAULT,
} from './session-file-workbench-state'
import { isHtmlFilePath } from './session-web-preview-state'
import { PinnedWidgetPreviewPanel } from './PinnedWidgetPreviewPanel'

interface SessionFileWorkbenchProps {
  sessionId: string
}

export function SessionFileWorkbench({ sessionId }: SessionFileWorkbenchProps): React.ReactElement {
  const { t } = useTranslation()
  const sessions = useAtomValue(sessionsAtom)
  const setSessions = useSetAtom(sessionsAtom)
  const stateMap = useAtomValue(sessionFileWorkbenchStateMapAtom)
  const setStateMap = useSetAtom(sessionFileWorkbenchStateMapAtom)
  const pinnedWidgetsMap = useAtomValue(sessionPinnedWidgetsMapAtom)
  const setSessionPinnedWidgets = useSetAtom(setSessionPinnedWidgetsAtom)
  const setSidePanelActiveToolMap = useSetAtom(agentSidePanelActiveToolMapAtom)
  const [atomExplorerWidth, setExplorerWidth] = useAtom(sessionWorkbenchExplorerWidthAtom)
  const { openHtmlFileInSessionBrowser } = useSessionWebPreview(sessionId)

  const [isResizingExplorer, setIsResizingExplorer] = React.useState(false)
  const [isSelectingProjectFolder, setIsSelectingProjectFolder] = React.useState(false)
  const [explorerWidth, setExplorerWidthLocal] = React.useState(atomExplorerWidth)
  const explorerDragStartRef = React.useRef({ x: 0, width: 0 })
  const explorerCurrentWidthRef = React.useRef(atomExplorerWidth)

  // 非拖拽时：atom 变更同步到 local state
  React.useEffect(() => {
    if (!isResizingExplorer) {
      setExplorerWidthLocal(atomExplorerWidth)
      explorerCurrentWidthRef.current = atomExplorerWidth
    }
  }, [atomExplorerWidth, isResizingExplorer])

  React.useEffect(() => {
    if (!isResizingExplorer) return

    const { x: startX, width: startWidth } = explorerDragStartRef.current

    const handlePointerMove = (e: PointerEvent): void => {
      const delta = e.clientX - startX
      const next = clampSessionWorkbenchExplorerWidth(startWidth + delta)
      explorerCurrentWidthRef.current = next
      setExplorerWidthLocal(next)
    }

    const handlePointerUp = (): void => {
      setExplorerWidth(explorerCurrentWidthRef.current)
      setIsResizingExplorer(false)
    }

    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', handlePointerUp)
    return () => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', handlePointerUp)
    }
  }, [isResizingExplorer, setExplorerWidth])

  const handleResizeStart = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    explorerDragStartRef.current = { x: event.clientX, width: explorerCurrentWidthRef.current }
    setIsResizingExplorer(true)
  }, [])

  const handleResizeKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>): void => {
    let nextWidth = explorerCurrentWidthRef.current
    if (event.key === 'ArrowLeft') nextWidth -= 16
    else if (event.key === 'ArrowRight') nextWidth += 16
    else return
    event.preventDefault()
    nextWidth = clampSessionWorkbenchExplorerWidth(nextWidth)
    explorerCurrentWidthRef.current = nextWidth
    setExplorerWidthLocal(nextWidth)
    setExplorerWidth(nextWidth)
  }, [setExplorerWidth])

  const session = sessions.find((item) => item.id === sessionId) ?? null
  const projectPath = session?.project.path ?? null
  const projectLocked = Boolean(session?.project.lockedAt)
  const pinnedWidgets = pinnedWidgetsMap.get(sessionId) ?? []
  const state = stateMap.get(sessionId) ?? createEmptyWorkbenchState()
  const recentFiles = state.recentFiles ?? []
  const activeItem = getActiveWorkbenchItem(state)

  const updateWorkbenchState = React.useCallback((
    updater: ReturnType<typeof createEmptyWorkbenchState> | ((prev: ReturnType<typeof createEmptyWorkbenchState>) => ReturnType<typeof createEmptyWorkbenchState>),
  ) => {
    setStateMap((prev) => {
      const current = prev.get(sessionId) ?? createEmptyWorkbenchState()
      const next = typeof updater === 'function'
        ? (updater as (prev: ReturnType<typeof createEmptyWorkbenchState>) => ReturnType<typeof createEmptyWorkbenchState>)(current)
        : updater

      if (current === next) return prev

      const map = new Map(prev)
      if (!next.activeItem && next.viewMode === 'preview' && (next.recentFiles?.length ?? 0) === 0) {
        map.delete(sessionId)
      } else {
        map.set(sessionId, next)
      }
      return map
    })
  }, [sessionId, setStateMap])

  React.useEffect(() => {
    let cancelled = false

    window.electronAPI.listSessionPinnedWidgets(sessionId)
      .then((widgets) => {
        if (!cancelled) {
          setSessionPinnedWidgets({ sessionId, widgets })
        }
      })
      .catch((error) => {
        console.error('[SessionFileWorkbench] 加载 pinned widgets 失败:', error)
      })

    return () => {
      cancelled = true
    }
  }, [sessionId, setSessionPinnedWidgets])

  React.useEffect(() => {
    const validPinIds = new Set(pinnedWidgets.map((widget) => widget.id))
    updateWorkbenchState((prev) => pruneWorkbenchWidgets(prev, validPinIds))
  }, [pinnedWidgets, updateWorkbenchState])

  const setActiveToolId = React.useCallback((toolId: AgentSidePanelToolId) => {
    setSidePanelActiveToolMap((prev) => {
      const map = new Map(prev)
      map.set(sessionId, toolId)
      return map
    })
  }, [sessionId, setSidePanelActiveToolMap])

  const handleOpenFile = React.useCallback((filePath: string) => {
    updateWorkbenchState((prev) => openWorkbenchFile(prev, filePath))
    if (isHtmlFilePath(filePath)) {
      setActiveToolId('web')
      void openHtmlFileInSessionBrowser(filePath)
    }
  }, [openHtmlFileInSessionBrowser, setActiveToolId, updateWorkbenchState])

  const handleResizeReset = React.useCallback(() => {
    setExplorerWidth(SESSION_WORKBENCH_EXPLORER_WIDTH_DEFAULT)
  }, [setExplorerWidth])

  const handleSelectProjectFolder = React.useCallback(async (): Promise<void> => {
    if (projectLocked) {
      toast.info(t('session.workbench.projectLocked'))
      return
    }
    if (isSelectingProjectFolder) return

    setIsSelectingProjectFolder(true)
    try {
      const result = await window.electronAPI.openFolderDialog()
      if (!result) return

      const updated = await window.electronAPI.updateSessionProject(sessionId, result.path)
      setSessions((prev) => prev.map((item) => (
        item.id === updated.id ? updated : item
      )))
      setStateMap((prev) => {
        const map = new Map(prev)
        map.delete(sessionId)
        return map
      })
      toast.success(t('session.workbench.folderSwitched', { name: result.name }))
    } catch (error) {
      console.error('[SessionFileWorkbench] 更新项目目录失败:', error)
      toast.error(t('session.workbench.folderSwitchFailed'))
    } finally {
      setIsSelectingProjectFolder(false)
    }
  }, [isSelectingProjectFolder, projectLocked, sessionId, setSessions, setStateMap, t])

  return (
    <div className="flex h-full min-h-0 gap-0 bg-workspace">
      <div
        className="flex flex-shrink-0 flex-col overflow-hidden border-r border-border/55"
        style={{ width: explorerWidth }}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-border/55 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <FolderOpen className="size-3.5 text-foreground/70" />
                <span className="text-[12px] font-medium text-foreground/78">Explorer</span>
              </div>
              <div
                className="mt-1 truncate font-mono text-[11px] text-muted-foreground/70"
                title={projectPath ?? undefined}
              >
                {projectPath ?? t('session.workbench.noProjectPath')}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 rounded-md px-2 text-[11px] text-foreground/65 hover:text-foreground"
                onClick={() => { void handleSelectProjectFolder() }}
                disabled={projectLocked || isSelectingProjectFolder}
                aria-busy={isSelectingProjectFolder}
                title={projectLocked ? t('session.workbench.projectLocked') : isSelectingProjectFolder ? t('session.workbench.switchingFolder') : t('session.workbench.selectFolderHint')}
              >
                {projectLocked ? <Lock className="size-3.5" /> : isSelectingProjectFolder ? <Loader2 className="size-3.5 animate-spin" /> : <FolderSearch className="size-3.5" />}
                <span>{t('session.workbench.selectFolder')}</span>
              </Button>
            </div>
          </div>

          {projectPath ? (
            <>
              {recentFiles.length > 0 && (
                <div className="border-b border-border/55 px-3 py-2">
                  <div className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <Clock3 className="size-3" />{t('session.workbench.recentFiles')}
                  </div>
                  <div className="space-y-0.5">
                    {recentFiles.map((path) => (
                      <button
                        key={path}
                        type="button"
                        className="block w-full truncate rounded-md px-2 py-1 text-left text-[11px] text-foreground/75 hover:bg-muted/55"
                        title={path}
                        onClick={() => handleOpenFile(path)}
                      >
                        {path.split(/[\\/]/).pop() ?? path}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <OverlayScrollbarArea
                className="min-h-0 flex-1"
                options={{ overflow: { x: 'hidden', y: 'scroll' } }}
              >
                <FileBrowser
                  rootPath={projectPath}
                  hideToolbar
                  embedded
                  onEntrySelect={(entry) => {
                    if (!entry.isDirectory) {
                      handleOpenFile(entry.path)
                    }
                  }}
                  onEntryPreview={(entry) => {
                    if (entry.isDirectory) return
                    if (isHtmlFilePath(entry.path)) {
                      setActiveToolId('web')
                      void openHtmlFileInSessionBrowser(entry.path)
                      return
                    }
                    window.electronAPI.previewFile(entry.path).catch(console.error)
                  }}
                />
              </OverlayScrollbarArea>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-xs leading-5 text-muted-foreground">
              <div className="rounded-lg bg-muted/30 px-4 py-6">
                {t('session.workbench.emptyProject')}
              </div>
            </div>
          )}
        </div>
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('session.workbench.resizeExplorer')}
        aria-valuemin={180}
        aria-valuemax={420}
        aria-valuenow={Math.round(explorerWidth)}
        tabIndex={0}
        className="group relative z-[var(--kila-z-popover)] w-[5px] flex-shrink-0 cursor-col-resize bg-transparent titlebar-no-drag"
        onPointerDown={handleResizeStart}
        onKeyDown={handleResizeKeyDown}
        onDoubleClick={handleResizeReset}
        title={t('session.workbench.resizeExplorerHint')}
      >
        <div className="absolute inset-y-3 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-transparent transition-colors group-hover:bg-primary/45" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1">
          {activeItem?.kind === 'widget' ? (
            <PinnedWidgetPreviewPanel
              sessionId={sessionId}
              widget={pinnedWidgets.find((widget) => widget.id === activeItem.pinId) ?? null}
              viewMode={state.viewMode}
              onViewModeChange={(viewMode) => updateWorkbenchState((prev) => ({ ...prev, viewMode }))}
            />
          ) : (
            <FilePreviewPanel
              filePath={activeItem?.kind === 'file' ? activeItem.path : null}
              viewMode={state.viewMode}
              onViewModeChange={(viewMode) => updateWorkbenchState((prev) => ({ ...prev, viewMode }))}
            />
          )}
        </div>
      </div>
    </div>
  )
}
