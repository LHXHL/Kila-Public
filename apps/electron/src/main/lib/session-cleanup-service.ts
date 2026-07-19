export interface SessionCleanupDeps {
  stopSessionAndWait: (sessionId: string, timeoutMs?: number) => Promise<void>
  resetAgentSession: (sessionId: string) => Promise<void>
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
    import('./session-service'),
    import('./session-web-preview-manager'),
    import('./workspace-watcher'),
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
    sessionRuntime,
    webPreview,
    watcher,
  ]) => ({
    stopSessionAndWait: sessionRuntime.stopSessionAndWait,
    resetAgentSession: agentRuntime.resetAgentSession,
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
  }))
  return defaultDepsPromise
}

/** 桌面 IPC 与 CLI 共用的 Session 删除事务，避免两条入口的清理语义继续漂移。 */
export async function deleteSessionWithCleanup(
  sessionId: string,
  deps?: SessionCleanupDeps,
): Promise<void> {
  const resolvedDeps = deps ?? await loadDefaultSessionCleanupDeps()
  await resolvedDeps.stopSessionAndWait(sessionId, 5000)
  await resolvedDeps.resetAgentSession(sessionId)
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
}
