interface ScheduledTaskRunContext {
  taskId: string
  taskName: string
  aiCanExit: boolean
  requestedStopReason?: string
}

const scheduledTaskRunContextMap = new Map<string, ScheduledTaskRunContext>()

export function setScheduledTaskRunContext(sessionId: string, context: ScheduledTaskRunContext): void {
  scheduledTaskRunContextMap.set(sessionId, {
    ...context,
    requestedStopReason: undefined,
  })
}

export function clearScheduledTaskRunContext(sessionId: string): void {
  scheduledTaskRunContextMap.delete(sessionId)
}

export function getScheduledTaskRunContext(sessionId: string): ScheduledTaskRunContext | null {
  return scheduledTaskRunContextMap.get(sessionId) ?? null
}

export function requestScheduledTaskExit(sessionId: string, reason?: string): void {
  const context = scheduledTaskRunContextMap.get(sessionId)
  if (!context) {
    throw new Error('当前会话不在定时任务上下文中')
  }
  if (!context.aiCanExit) {
    throw new Error('当前定时任务未启用 AI 主动结束')
  }

  context.requestedStopReason = reason?.trim()
    ? reason.trim().slice(0, 500)
    : 'ai_requested_stop'
}

export function consumeScheduledTaskExitReason(sessionId: string): string | null {
  const context = scheduledTaskRunContextMap.get(sessionId)
  if (!context?.requestedStopReason) {
    return null
  }

  const reason = context.requestedStopReason
  context.requestedStopReason = undefined
  return reason
}
