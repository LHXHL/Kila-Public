import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { FolderOpen, GitBranch, Globe, Wrench, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AgentSidePanelToolId } from '@/atoms/agent-atoms'
import { agentSidePanelActiveToolMapAtom, agentSidePanelCloseRequestMapAtom } from '@/atoms/agent-atoms'
import { sessionSidePanelWidthAtom } from '@/atoms/session-atoms'
import { SessionFileWorkbench } from './SessionFileWorkbench'
import { WebPreviewPanel } from './WebPreviewPanel'
import { ToolCallsPanel } from './ToolCallsPanel'
import { GitStatusPanel } from './GitStatusPanel'
import {
  clampSessionSidePanelWidth,
  SESSION_SIDE_PANEL_WIDTH_MAX,
  SESSION_SIDE_PANEL_WIDTH_MIN,
} from './session-file-workbench-state'

interface SessionSidePanelProps {
  sessionId: string
}

interface SessionSidePanelToolDefinition {
  id: AgentSidePanelToolId
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const SESSION_SIDE_PANEL_TOOLS: SessionSidePanelToolDefinition[] = [
  { id: 'files', label: '文件工作台', icon: FolderOpen },
  { id: 'web', label: '网页预览', icon: Globe },
  { id: 'tools', label: '工具调用', icon: Wrench },
  { id: 'git', label: 'Git 状态', icon: GitBranch },
]

const TOOL_PANEL_COMPONENTS: Record<AgentSidePanelToolId, React.ComponentType<{ sessionId: string }>> = {
  files: SessionFileWorkbench,
  web: WebPreviewPanel,
  tools: ToolCallsPanel,
  git: GitStatusPanel,
}

const SIDEPANEL_CLOSE_ANIMATION_MS = 180

export function SessionSidePanel({ sessionId }: SessionSidePanelProps): React.ReactElement {
  const sidePanelActiveToolMap = useAtomValue(agentSidePanelActiveToolMapAtom)
  const sidePanelCloseRequestMap = useAtomValue(agentSidePanelCloseRequestMapAtom)
  const setSidePanelActiveToolMap = useSetAtom(agentSidePanelActiveToolMapAtom)
  const [atomPanelWidth, setPanelWidth] = useAtom(sessionSidePanelWidthAtom)

  const activeToolId = sidePanelActiveToolMap.get(sessionId) ?? null
  const requestedCloseAt = sidePanelCloseRequestMap.get(sessionId) ?? null
  const [isLocallyClosing, setIsLocallyClosing] = React.useState(false)
  const closeTimerRef = React.useRef<number | null>(null)

  const [isResizing, setIsResizing] = React.useState(false)
  const [panelWidth, setPanelWidthLocal] = React.useState(atomPanelWidth)
  const dragStartRef = React.useRef({ x: 0, width: 0 })
  const currentWidthRef = React.useRef(atomPanelWidth)
  const isClosing = isLocallyClosing || requestedCloseAt !== null
  const shouldRenderPanel = activeToolId !== null || isClosing
  const visiblePanelWidth = activeToolId !== null && !isClosing ? panelWidth : 0

  // 非拖拽时：atom 变更同步到 local state
  React.useEffect(() => {
    if (!isResizing) {
      setPanelWidthLocal(atomPanelWidth)
      currentWidthRef.current = atomPanelWidth
    }
  }, [atomPanelWidth, isResizing])

  // 拖拽期间用 document 监听 + local state，mouseup 时写回 atom
  React.useEffect(() => {
    if (!isResizing) return

    const { x: startX, width: startWidth } = dragStartRef.current

    const handlePointerMove = (e: PointerEvent): void => {
      const delta = startX - e.clientX
      const next = clampSessionSidePanelWidth(startWidth + delta)
      currentWidthRef.current = next
      setPanelWidthLocal(next)
    }

    const handlePointerUp = (): void => {
      setPanelWidth(currentWidthRef.current)
      setIsResizing(false)
    }

    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', handlePointerUp)
    return () => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', handlePointerUp)
    }
  }, [isResizing, setPanelWidth])

  const handleResizeStart = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragStartRef.current = { x: event.clientX, width: currentWidthRef.current }
    setIsResizing(true)
  }, [])

  const handleResizeKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>): void => {
    let nextWidth = currentWidthRef.current
    if (event.key === 'ArrowLeft') nextWidth += 16
    else if (event.key === 'ArrowRight') nextWidth -= 16
    else return
    event.preventDefault()
    nextWidth = clampSessionSidePanelWidth(nextWidth)
    currentWidthRef.current = nextWidth
    setPanelWidthLocal(nextWidth)
    setPanelWidth(nextWidth)
  }, [setPanelWidth])

  const activeTool = SESSION_SIDE_PANEL_TOOLS.find((tool) => tool.id === activeToolId) ?? null

  React.useEffect(() => {
    if (activeToolId !== null) {
      setIsLocallyClosing(false)
    }
  }, [activeToolId])

  React.useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
    }
  }, [])

  const handleClose = React.useCallback(() => {
    if (!activeToolId || isLocallyClosing) return

    setIsLocallyClosing(true)
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
    }

    const toolIdToClose = activeToolId
    closeTimerRef.current = window.setTimeout(() => {
      setSidePanelActiveToolMap((prev) => {
        const map = new Map(prev)
        if ((map.get(sessionId) ?? null) !== toolIdToClose) {
          return prev
        }
        map.delete(sessionId)
        return map
      })
      setIsLocallyClosing(false)
      closeTimerRef.current = null
    }, SIDEPANEL_CLOSE_ANIMATION_MS)
  }, [activeToolId, isLocallyClosing, sessionId, setSidePanelActiveToolMap])

  const ActiveToolPanel = activeToolId ? TOOL_PANEL_COMPONENTS[activeToolId] : null

  return (
    <div
      className={cn(
        'relative flex-shrink-0 titlebar-drag-region',
        !isResizing && 'transition-[width] duration-200 ease-out',
        shouldRenderPanel
          ? 'overflow-hidden bg-[hsl(var(--workspace))]'
          : 'overflow-hidden bg-transparent',
      )}
      style={{ width: visiblePanelWidth }}
    >
      {shouldRenderPanel && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整右侧栏宽度"
          aria-valuemin={SESSION_SIDE_PANEL_WIDTH_MIN}
          aria-valuemax={SESSION_SIDE_PANEL_WIDTH_MAX}
          aria-valuenow={Math.round(panelWidth)}
          tabIndex={0}
          className="absolute left-0 top-0 z-[var(--kila-z-popover)] h-full w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-primary/15 titlebar-no-drag"
          onPointerDown={handleResizeStart}
          onKeyDown={handleResizeKeyDown}
        />
      )}

      {shouldRenderPanel && (
        <div
          className="relative flex h-full min-h-0 flex-col"
          style={{ width: panelWidth }}
        >
          <div
            data-slot="side-panel-top-toolbar"
            className="flex h-10 shrink-0 items-center gap-2 border-b border-border/55 px-3 titlebar-no-drag"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium leading-none text-foreground/74">
                {activeTool?.label ?? '工具'}
              </div>
            </div>
            <button
              type="button"
              aria-label="关闭右侧栏"
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground/52 transition-colors duration-150 hover:bg-muted/45 hover:text-foreground/72"
              onClick={handleClose}
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div
            className={cn(
              'flex min-h-0 flex-1 flex-col titlebar-no-drag transition-[opacity,transform] duration-180 ease-out',
              isClosing ? 'pointer-events-none translate-x-1 opacity-0' : 'translate-x-0 opacity-100',
            )}
          >
            <div className="min-h-0 flex-1">
              {ActiveToolPanel && <ActiveToolPanel sessionId={sessionId} />}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
