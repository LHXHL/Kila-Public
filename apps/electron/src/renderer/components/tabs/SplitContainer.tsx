/**
 * SplitContainer — 分屏容器
 *
 * 使用 CSS Grid 实现 1-4 面板布局。
 * 根据 splitLayoutAtom.mode 自动切换布局。
 */

import type * as React from 'react'
import { useAtomValue } from 'jotai'
import { splitLayoutAtom } from '@/atoms/tab-atoms'
import { SplitPanel } from './SplitPanel'
import type { SplitMode } from '@/atoms/tab-atoms'
import { useElementWidth } from '@/hooks/use-element-width'

/** 获取 CSS Grid 样式 */
function getGridStyle(mode: SplitMode, width: number): React.CSSProperties {
  if (width > 0 && width < 760 && mode !== 'single') {
    const rows = mode === 'grid-4' ? 4 : 2
    const areas = mode === 'grid-4' ? '"a" "b" "c" "d"' : '"a" "b"'
    return { gridTemplate: `${areas} / 1fr`, gridTemplateRows: `repeat(${rows}, minmax(280px, 1fr))` }
  }
  if (width > 0 && width < 1120 && mode === 'grid-4') {
    return { gridTemplate: '"a b" minmax(280px, 1fr) "c d" minmax(280px, 1fr) / 1fr 1fr' }
  }
  switch (mode) {
    case 'single':
      return { gridTemplate: '"a" 1fr / 1fr' }
    case 'horizontal-2':
      return { gridTemplate: '"a b" 1fr / 1fr 1fr' }
    case 'vertical-2':
      return { gridTemplate: '"a" 1fr "b" 1fr / 1fr' }
    case 'grid-4':
      return { gridTemplate: '"a b" 1fr "c d" 1fr / 1fr 1fr' }
  }
}

const GRID_AREAS = ['a', 'b', 'c', 'd']

export function SplitContainer(): React.ReactElement {
  const layout = useAtomValue(splitLayoutAtom)
  const { width, setElement } = useElementWidth<HTMLDivElement>()

  const isSplit = layout.mode !== 'single'

  return (
    <div
      ref={setElement}
      className={isSplit ? 'titlebar-no-drag min-h-0 flex-1 overflow-auto p-[var(--kila-panel-gap)]' : 'titlebar-no-drag min-h-0 flex-1 overflow-auto'}
      style={{
        display: 'grid',
        gap: isSplit ? 'var(--kila-panel-gap)' : 0,
        ...getGridStyle(layout.mode, width),
      }}
    >
      {layout.panels.map((panel, idx) => (
        <SplitPanel
          key={panel.index}
          panel={panel}
          panelIndex={idx}
          gridArea={GRID_AREAS[idx]!}
          isFocused={idx === layout.focusedPanelIndex}
          showBorder={isSplit}
        />
      ))}
    </div>
  )
}
