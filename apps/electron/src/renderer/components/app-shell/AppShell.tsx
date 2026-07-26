/**
 * AppShell - 应用主布局容器
 *
 * 布局结构：[LeftSidebar 可折叠] | [MainArea: WorkspaceToolbar + SplitContainer]
 *
 * MainArea 只承载session / 分屏；设置改为独立原生窗口。
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { LeftSidebar } from './LeftSidebar'
import { MainArea } from '@/components/tabs/MainArea'
import { AppShellProvider, type AppShellContextType } from '@/contexts/AppShellContext'
import { sidebarCollapsedAtom, sidebarWidthAtom } from '@/atoms/tab-atoms'

export interface AppShellProps {
  /** Context 值，用于传递给子组件 */
  contextValue: AppShellContextType
}

export function AppShell({ contextValue }: AppShellProps): React.ReactElement {
  const [atomSidebarWidth, setSidebarWidth] = useAtom(sidebarWidthAtom)
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom)
  const [isResizingSidebar, setIsResizingSidebar] = React.useState(false)
  // 始终用 local state 作为宽度数据源，避免 atom 异步更新导致弹回
  const [sidebarWidth, setSidebarWidthLocal] = React.useState(atomSidebarWidth)
  const dragStartRef = React.useRef({ x: 0, width: 0 })
  const currentWidthRef = React.useRef(atomSidebarWidth)

  // 非拖拽时：atom 变更同步到 local state
  React.useEffect(() => {
    if (!isResizingSidebar) {
      setSidebarWidthLocal(atomSidebarWidth)
      currentWidthRef.current = atomSidebarWidth
    }
  }, [atomSidebarWidth, isResizingSidebar])

  // 拖拽期间监听 document mousemove/mouseup
  React.useEffect(() => {
    if (!isResizingSidebar) return

    const { x: startX, width: startWidth } = dragStartRef.current

    const handleMouseMove = (e: MouseEvent): void => {
      const nextWidth = Math.min(420, Math.max(248, startWidth + (e.clientX - startX)))
      currentWidthRef.current = nextWidth
      setSidebarWidthLocal(nextWidth)
    }

    const handleMouseUp = (): void => {
      setSidebarWidth(currentWidthRef.current)
      setIsResizingSidebar(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizingSidebar, setSidebarWidth])

  const handleSidebarResizeStart = React.useCallback((e: React.MouseEvent<HTMLElement>): void => {
    e.preventDefault()
    dragStartRef.current = { x: e.clientX, width: currentWidthRef.current }
    setIsResizingSidebar(true)
  }, [])

  const handleSidebarResizeKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>): void => {
    let nextWidth = currentWidthRef.current
    if (event.key === 'ArrowLeft') nextWidth -= 16
    else if (event.key === 'ArrowRight') nextWidth += 16
    else if (event.key === 'Home') nextWidth = 248
    else if (event.key === 'End') nextWidth = 420
    else return
    event.preventDefault()
    nextWidth = Math.min(420, Math.max(248, nextWidth))
    currentWidthRef.current = nextWidth
    setSidebarWidthLocal(nextWidth)
    setSidebarWidth(nextWidth)
  }, [setSidebarWidth])

  return (
    <AppShellProvider value={contextValue}>
      {/* 可拖动标题栏区域，用于窗口拖动 */}
      <div className="titlebar-drag-region fixed left-0 right-0 top-0 h-[50px] z-[var(--kila-z-titlebar)]" />

      <div className="flex h-screen w-screen overflow-hidden bg-workspace">
        {/* 左侧边栏：可折叠 */}
        <LeftSidebar width={sidebarWidth} isResizing={isResizingSidebar} />

        {!sidebarCollapsed && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="调整侧边栏宽度"
            aria-valuemin={248}
            aria-valuemax={420}
            aria-valuenow={Math.round(sidebarWidth)}
            tabIndex={0}
            onKeyDown={handleSidebarResizeKeyDown}
            className="group titlebar-no-drag relative z-[calc(var(--kila-z-panel)+1)] w-px shrink-0 outline-none"
          >
            <div
              className="absolute inset-y-[var(--kila-panel-edge-inset)] -left-3 -right-3 cursor-col-resize group-focus-visible:bg-primary/35"
              onMouseDown={handleSidebarResizeStart}
            />
          </div>
        )}

        {/* 右侧容器：在标题栏拖拽层之上承载主工作台 */}
        <div className="relative z-[var(--kila-z-panel)] min-w-0 flex-1 py-[var(--kila-panel-edge-inset)] pl-1 pr-[var(--kila-panel-edge-inset)]">
          {/* 主内容区域（WorkspaceToolbar + SplitContainer） */}
          <MainArea />
        </div>
      </div>
    </AppShellProvider>
  )
}
