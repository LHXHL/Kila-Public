import type { AgentSendInput } from '@kila/shared'

export interface AgentRuntimeSelection {
  channelId: string
  modelId?: string
}

/** 运行中 steer/follow-up 只能沿用已经创建的 provider runtime。 */
export function hasRuntimeSelectionChanged(
  active: AgentRuntimeSelection,
  next: Pick<AgentSendInput, 'channelId' | 'modelId'>,
): boolean {
  return active.channelId !== next.channelId || active.modelId !== next.modelId
}

/** 判断可选的 Session 输入是否会切换正在运行的 provider runtime。 */
export function switchesActiveRuntimeSelection(
  active: AgentRuntimeSelection,
  next: Partial<AgentRuntimeSelection>,
): boolean {
  return (
    (typeof next.channelId !== 'undefined' && next.channelId !== active.channelId)
    || (typeof next.modelId !== 'undefined' && next.modelId !== active.modelId)
  )
}
