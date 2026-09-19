import { closeSync, existsSync, fsyncSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import type { PiRunJournalV1 } from '@kila/shared'
import { getPiSessionDir, getPiSessionRuntimeLockPath } from '../config-paths'
import {
  isSameProcessStartTime,
  readProcessIdentity,
  type ProcessIdentity,
} from './process-identity'

export interface RuntimeLockMetadata {
  pid: number
  parentPid: number
  processStartTime: number
  appBootId: string
  bootId: string
  generation: number
}

export interface SessionRuntimeLease {
  sessionId: string
  lockPath: string
  metadata: RuntimeLockMetadata
  release: () => void
}

export function acquireSessionRuntimeLease(
  sessionId: string,
  metadata: RuntimeLockMetadata,
): SessionRuntimeLease {
  getPiSessionDir(sessionId)
  const lockPath = getPiSessionRuntimeLockPath(sessionId)
  const payload = JSON.stringify(metadata)
  let fd: number
  try {
    fd = openSync(lockPath, 'wx', 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('runtime_sidecar_locked: sidecar runtime.lock 已存在')
    }
    throw error
  }

  try {
    writeFileSync(fd, payload, 'utf8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }

  let released = false
  return {
    sessionId,
    lockPath,
    metadata,
    release: () => {
      if (released) return
      released = true
      if (!existsSync(lockPath)) return
      if (!sameLockMetadata(readLockMetadata(lockPath), metadata)) {
        throw new Error('runtime_sidecar_locked: runtime.lock 所有权已变化，拒绝删除')
      }
      unlinkSync(lockPath)
    },
  }
}

export function readSessionRuntimeLock(sessionId: string): RuntimeLockMetadata | undefined {
  const lockPath = getPiSessionRuntimeLockPath(sessionId)
  if (!existsSync(lockPath)) return undefined
  return readLockMetadata(lockPath)
}

export function isSessionRuntimeLeaseOwnedBy(
  sessionId: string,
  metadata: RuntimeLockMetadata,
): boolean {
  const current = readSessionRuntimeLock(sessionId)
  return current ? sameLockMetadata(current, metadata) : false
}

/**
 * 只有在 lock 内容完整且 owner PID 已确认退出时才回收 stale lock。
 * PID 仍存活或内容损坏都 fail-closed，避免 PID 复用时误删别的 Runtime 的锁。
 */
export function reclaimStaleSessionRuntimeLease(
  sessionId: string,
  options: { readProcessIdentity?: (pid: number) => ProcessIdentity | undefined } = {},
): boolean {
  const lockPath = getPiSessionRuntimeLockPath(sessionId)
  if (!existsSync(lockPath)) return false
  const metadata = readLockMetadata(lockPath)
  try {
    process.kill(metadata.pid, 0)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false
    unlinkSync(lockPath)
    return true
  }

  const identity = (options.readProcessIdentity ?? readProcessIdentity)(metadata.pid)
  if (!identity) return false

  // 启动时间不同说明 PID 已被复用，旧 Runtime 不可能再持有这把锁。
  if (!isSameProcessStartTime(metadata.processStartTime, identity.processStartTime)) {
    unlinkSync(lockPath)
    return true
  }

  // 启动时间相同仍是同一个进程；即使父进程发生变化，也不能冒险回收活锁。
  if (identity.parentPid !== metadata.parentPid) return false
  return false
}

export function isPiJournalDirty(journal: PiRunJournalV1 | undefined): boolean {
  if (!journal) return false
  return journal.state !== 'clean'
}

function readLockMetadata(path: string): RuntimeLockMetadata {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<RuntimeLockMetadata>
    if (
      typeof value.pid !== 'number'
      || typeof value.parentPid !== 'number'
      || typeof value.processStartTime !== 'number'
      || typeof value.appBootId !== 'string'
      || typeof value.bootId !== 'string'
      || typeof value.generation !== 'number'
    ) {
      throw new Error('字段缺失')
    }
    return value as RuntimeLockMetadata
  } catch (error) {
    throw new Error(`runtime_sidecar_locked: runtime.lock 损坏，无法确认 stale: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function sameLockMetadata(left: RuntimeLockMetadata, right: RuntimeLockMetadata): boolean {
  return left.pid === right.pid
    && left.parentPid === right.parentPid
    && left.processStartTime === right.processStartTime
    && left.appBootId === right.appBootId
    && left.bootId === right.bootId
    && left.generation === right.generation
}
