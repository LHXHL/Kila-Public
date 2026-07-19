/**
 * NavigatorPanel - Middle panel for list-based navigation
 * Displays a header with title and scrollable content area
 */

import * as React from 'react'
import { Panel } from './Panel'
import { PanelHeader } from './PanelHeader'
import { OverlayScrollbarArea } from '@/components/ui/overlay-scrollbar'

export interface NavigatorPanelProps {
  /** Panel title */
  title: string
  /** Panel width in pixels */
  width: number
  /** Main content */
  children: React.ReactNode
}

export function NavigatorPanel({
  title,
  width,
  children,
}: NavigatorPanelProps): React.ReactElement {
  return (
    <Panel variant="shrink" width={width} className="bg-background border-r border-border">
      <PanelHeader title={title} />
      <OverlayScrollbarArea
        className="min-h-0 flex-1 overflow-y-auto"
        options={{ overflow: { x: 'hidden', y: 'scroll' } }}
      >
        {children}
      </OverlayScrollbarArea>
    </Panel>
  )
}
