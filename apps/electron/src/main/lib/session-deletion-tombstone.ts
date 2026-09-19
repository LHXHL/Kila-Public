import { existsSync } from 'node:fs'
import type { SessionDeletionTombstone } from '@kila/shared'
import { getSessionDeletionTombstonesPath } from './config-paths'
import { createLogger } from './logger'
import { readJsonWithBackup, writeTextAtomicWithBackup } from './safe-json-file'

const log = createLogger('Session 删除事务')

interface SessionDeletionTombstoneStore {
  version: 1
  tombstones: SessionDeletionTombstone[]
}

function readStore(): SessionDeletionTombstoneStore {
  const path = getSessionDeletionTombstonesPath()
  if (!existsSync(path)) {
    return { version: 1, tombstones: [] }
  }

  try {
    return readJsonWithBackup(path, (raw) => {
      const parsed = JSON.parse(raw) as Partial<SessionDeletionTombstoneStore>
      if (parsed.version !== 1 || !Array.isArray(parsed.tombstones)) {
        throw new Error('删除 tombstone 格式无效')
      }
      const tombstones = parsed.tombstones.map(normalizeTombstone)
      return { version: 1, tombstones }
    })
  } catch (error) {
    log.error('[Session 删除事务] tombstone 读取失败，拒绝静默重建:', error)
    throw new Error(`Session 删除 tombstone 不可读: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function normalizeTombstone(value: unknown): SessionDeletionTombstone {
  if (!value || typeof value !== 'object') throw new Error('删除 tombstone 不是对象')
  const candidate = value as Partial<SessionDeletionTombstone>
  const startedAt = candidate.startedAt
  const updatedAt = candidate.updatedAt
  if (
    typeof candidate.sessionId !== 'string'
    || candidate.sessionId.trim() === ''
    || (candidate.state !== 'deleting' && candidate.state !== 'failed')
    || typeof startedAt !== 'number'
    || !Number.isFinite(startedAt)
    || typeof updatedAt !== 'number'
    || !Number.isFinite(updatedAt)
  ) {
    throw new Error('删除 tombstone 字段无效')
  }
  return {
    sessionId: candidate.sessionId,
    state: candidate.state,
    startedAt,
    updatedAt,
    ...(typeof candidate.error === 'string' ? { error: candidate.error } : {}),
  }
}

function writeStore(store: SessionDeletionTombstoneStore): void {
  writeTextAtomicWithBackup(getSessionDeletionTombstonesPath(), JSON.stringify(store, null, 2))
}

function updateTombstone(
  sessionId: string,
  update: (current: SessionDeletionTombstone | undefined) => SessionDeletionTombstone | undefined,
): void {
  const store = readStore()
  const current = store.tombstones.find((item) => item.sessionId === sessionId)
  const next = update(current)
  const retained = store.tombstones.filter((item) => item.sessionId !== sessionId)
  if (next) retained.push(next)
  writeStore({ version: 1, tombstones: retained })
}

export function beginSessionDeletion(sessionId: string): void {
  const now = Date.now()
  updateTombstone(sessionId, (current) => ({
    sessionId,
    state: 'deleting',
    startedAt: current?.startedAt ?? now,
    updatedAt: now,
  }))
}

export function markSessionDeletionFailed(sessionId: string, error: unknown): void {
  const now = Date.now()
  const message = error instanceof Error ? error.message : String(error)
  updateTombstone(sessionId, (current) => ({
    sessionId,
    state: 'failed',
    startedAt: current?.startedAt ?? now,
    updatedAt: now,
    error: message.slice(0, 2000),
  }))
}

export function completeSessionDeletion(sessionId: string): void {
  updateTombstone(sessionId, () => undefined)
}

export function listPendingSessionDeletions(): SessionDeletionTombstone[] {
  return readStore().tombstones
}

export function isSessionDeletionPending(sessionId: string): boolean {
  return readStore().tombstones.some((item) => item.sessionId === sessionId)
}

export function assertSessionNotDeleting(sessionId: string): void {
  if (isSessionDeletionPending(sessionId)) {
    throw new Error('Session 正在删除，已拒绝新的运行请求')
  }
}
