import { listPendingSessionDeletions } from './session-deletion-tombstone'
import { createLogger } from './logger'

const log = createLogger('Session 删除事务')

export interface SessionCleanupDeps {
  disposeSessionRuntime: (sessionId: string) => Promise<void>
  clearPiSessionState: (sessionId: string) => void
  clearProcesses: (sessionId: string) => void
  clearProjectRunChanges: (sessionId: string) => void
  beforeDeleteMemory: (sessionId: string) => Promise<void>
  stopWebPreview: (sessionId: string) => Promise<void>
  clearPermissionWhitelist: (sessionId: string) => void
  clearPermissionPending: (sessionId: string) => void
  clearAskUserPending: (sessionId: string) => void
  unwatchProject: (sessionId: string) => void
  deleteAttachments: (sessionId: string) => void
  deleteSession: (sessionId: string) => void
  beginSessionDeletion?: (sessionId: string) => void
  completeSessionDeletion?: (sessionId: string) => void
  markSessionDeletionFailed?: (sessionId: string, error: unknown) => void
}

let defaultDepsPromise: Promise<SessionCleanupDeps> | undefined

function loadDefaultSessionCleanupDeps(): Promise<SessionCleanupDeps> {
  defaultDepsPromise ??= Promise.all([
    import('./agent-service'),
    import('./agent-ask-user-service'),
    import('./agent-permission-service'),
    import('./attachment-service'),
    import('./memory/lifecycle-manager'),
    import('./pi-session-state'),
    import('./process-registry'),
    import('./project-run-changes'),
    import('./session-manager'),
    import('./session-web-preview-manager'),
    import('./workspace-watcher'),
    import('./session-deletion-tombstone'),
  ]).then(([
    agentRuntime,
    askUser,
    permission,
    attachments,
    memory,
    piState,
    processes,
    projectChanges,
    sessions,
    webPreview,
    watcher,
    tombstones,
  ]) => ({
    disposeSessionRuntime: agentRuntime.disposeSessionRuntime,
    clearPiSessionState: piState.clearPiSessionState,
    clearProcesses: (sessionId) => processes.processRegistry.clearBySession(sessionId),
    clearProjectRunChanges: projectChanges.clearProjectRunChanges,
    beforeDeleteMemory: (sessionId) => memory.memoryLifecycleManager.onBeforeDeleteSession(sessionId),
    stopWebPreview: webPreview.stopSessionWebPreviewServer,
    clearPermissionWhitelist: (sessionId) => permission.permissionService.clearSessionWhitelist(sessionId),
    clearPermissionPending: (sessionId) => permission.permissionService.clearSessionPending(sessionId),
    clearAskUserPending: (sessionId) => askUser.askUserService.clearSessionPending(sessionId),
    unwatchProject: watcher.unwatchSessionProject,
    deleteAttachments: attachments.deleteConversationAttachments,
    deleteSession: sessions.deleteSession,
    beginSessionDeletion: tombstones.beginSessionDeletion,
    completeSessionDeletion: tombstones.completeSessionDeletion,
    markSessionDeletionFailed: tombstones.markSessionDeletionFailed,
  }))
  return defaultDepsPromise
}

/** 桌面 IPC 与 CLI 共用的 Session 删除事务，避免两条入口的清理语义继续漂移。 */
export async function deleteSessionWithCleanup(
  sessionId: string,
  deps?: SessionCleanupDeps,
): Promise<void> {
  const resolvedDeps = deps ?? await loadDefaultSessionCleanupDeps()
  resolvedDeps.beginSessionDeletion?.(sessionId)
  try {
    await resolvedDeps.disposeSessionRuntime(sessionId)
    resolvedDeps.clearPiSessionState(sessionId)
    resolvedDeps.clearProcesses(sessionId)
    resolvedDeps.clearProjectRunChanges(sessionId)
    await resolvedDeps.beforeDeleteMemory(sessionId)
    await resolvedDeps.stopWebPreview(sessionId)
    resolvedDeps.clearPermissionWhitelist(sessionId)
    resolvedDeps.clearPermissionPending(sessionId)
    resolvedDeps.clearAskUserPending(sessionId)
    resolvedDeps.unwatchProject(sessionId)
    resolvedDeps.deleteAttachments(sessionId)
    resolvedDeps.deleteSession(sessionId)
    resolvedDeps.completeSessionDeletion?.(sessionId)
  } catch (error) {
    resolvedDeps.markSessionDeletionFailed?.(sessionId, error)
    throw error
  }
}

/** 应用启动时继续未完成的删除事务；失败项保留 tombstone，不恢复为普通 Session。 */
export async function resumePendingSessionDeletions(): Promise<void> {
  const pending = listPendingSessionDeletions()
  for (const tombstone of pending) {
    try {
      await deleteSessionWithCleanup(tombstone.sessionId)
    } catch (error) {
      log.error(`[Session 删除事务] 启动恢复失败: ${tombstone.sessionId}`, error)
    }
  }
}
