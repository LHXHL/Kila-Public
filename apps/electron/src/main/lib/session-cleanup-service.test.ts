import { describe, expect, test } from 'bun:test'
import { deleteSessionWithCleanup, type SessionCleanupDeps } from './session-cleanup-service'

describe('Session 删除清理事务', () => {
  test('Given 一个可删除 Session, When 从统一服务删除, Then runtime、Pi sidecar 与所有旁路资源按序清理', async () => {
    const calls: string[] = []
    const record = (name: string) => (sessionId: string) => { calls.push(`${name}:${sessionId}`) }
    const recordAsync = (name: string) => async (sessionId: string) => { calls.push(`${name}:${sessionId}`) }
    const deps: SessionCleanupDeps = {
      stopSessionAndWait: async (sessionId, timeoutMs) => { calls.push(`stop:${sessionId}:${timeoutMs}`) },
      resetAgentSession: recordAsync('runtime'),
      clearPiSessionState: record('pi'),
      clearProcesses: record('process'),
      clearProjectRunChanges: record('changes'),
      beforeDeleteMemory: recordAsync('memory'),
      stopWebPreview: recordAsync('preview'),
      clearPermissionWhitelist: record('permission-whitelist'),
      clearPermissionPending: record('permission-pending'),
      clearAskUserPending: record('ask-user'),
      unwatchProject: record('watcher'),
      deleteAttachments: record('attachments'),
      deleteSession: record('session'),
    }

    await deleteSessionWithCleanup('session-1', deps)

    expect(calls).toEqual([
      'stop:session-1:5000',
      'runtime:session-1',
      'pi:session-1',
      'process:session-1',
      'changes:session-1',
      'memory:session-1',
      'preview:session-1',
      'permission-whitelist:session-1',
      'permission-pending:session-1',
      'ask-user:session-1',
      'watcher:session-1',
      'attachments:session-1',
      'session:session-1',
    ])
  })
})
