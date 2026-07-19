export interface SessionTurnReplayPlan<T extends { id: string; role: string }> {
  prefixBeforeTurn: T[]
  optimisticMessages: T[]
  replayUserMessage: T
  replacedMessages: T[]
  targetMessage: T
}

export function buildSessionTurnReplayPlan<T extends { id: string; role: string }>(
  messages: T[],
  messageId: string,
): SessionTurnReplayPlan<T> | null {
  const targetIndex = messages.findIndex((message) => message.id === messageId && message.role !== 'system')
  if (targetIndex === -1) {
    return null
  }

  for (let userIndex = targetIndex; userIndex >= 0; userIndex--) {
    const candidate = messages[userIndex]
    if (candidate?.role !== 'user') continue

    return {
      prefixBeforeTurn: messages.slice(0, userIndex),
      optimisticMessages: messages.slice(0, userIndex + 1),
      replayUserMessage: candidate,
      replacedMessages: messages.slice(userIndex),
      targetMessage: messages[targetIndex]!,
    }
  }

  return null
}

export type AssistantTurnReplayPlan<T extends { id: string; role: string }> = SessionTurnReplayPlan<T>
export const buildAssistantTurnReplayPlan = buildSessionTurnReplayPlan


export function createOptimisticReplayUserMessage<T extends { id: string; createdAt: number }>(
  replayUserMessage: T,
  options?: {
    now?: () => number
    idPrefix?: string
  },
): T {
  const createdAt = options?.now?.() ?? Date.now()
  const idPrefix = options?.idPrefix ?? 'replay-temp'

  return {
    ...replayUserMessage,
    id: `${idPrefix}-${createdAt}-${replayUserMessage.id}`,
    createdAt,
  }
}
