const dirtySessionIds = new Set<string>()
let fullRebuildRequested = false

export function markSessionSearchIndexDirty(sessionId?: string): void {
  if (sessionId) {
    dirtySessionIds.add(sessionId)
    return
  }
  fullRebuildRequested = true
  dirtySessionIds.clear()
}

export function consumeSessionSearchIndexDirtyState(): { fullRebuild: boolean; sessionIds: string[] } {
  const state = {
    fullRebuild: fullRebuildRequested,
    sessionIds: Array.from(dirtySessionIds),
  }
  fullRebuildRequested = false
  dirtySessionIds.clear()
  return state
}
