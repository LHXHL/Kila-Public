/**
 * ProcessTimeline — 工具与思考过程渲染入口
 *
 * 对标 LobeHub Group + WorkflowCollapse：
 * - 思考和工具按事件顺序交织排列，统一包在 WorkflowCollapse 折叠面板内
 * - 流式空状态 → 思考中占位卡片
 */

import type * as React from 'react'
import { ThinkingProcessCard } from './ThinkingProcessCard'
import { WorkflowCollapse } from './WorkflowCollapse'
import type { BackgroundTask, ProcessTimelineEntry } from '@/atoms/agent-atoms'

export function ProcessTimeline({
  entries,
  backgroundTasks,
  startedAt,
  streaming = false,
  sessionPath,
  animate = false,
}: {
  entries: ProcessTimelineEntry[]
  backgroundTasks?: BackgroundTask[]
  startedAt?: number
  streaming?: boolean
  sessionPath?: string | null
  animate?: boolean
}): React.ReactElement | null {
  if (entries.length === 0 && !streaming) return null

  // 空状态：流式中但没有条目
  if (entries.length === 0 && streaming) {
    return (
      <div className="mb-2.5 w-full">
        <ThinkingProcessCard
          fallback
          startedAt={startedAt}
          streaming={streaming}
          sessionPath={sessionPath}
        />
      </div>
    )
  }

  return (
    <WorkflowCollapse
      entries={entries}
      backgroundTasks={backgroundTasks}
      streaming={streaming}
      startedAt={startedAt}
      sessionPath={sessionPath}
      animate={animate}
    />
  )
}
