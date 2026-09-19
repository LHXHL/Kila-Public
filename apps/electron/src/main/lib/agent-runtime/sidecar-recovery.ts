import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import type { AgentRunReceipt, PiRunJournalV1 } from '@kila/shared'
import {
  getPiSessionQuarantinePath,
  getPiSessionsDir,
  safePathSegment,
} from '../config-paths'
import {
  readAgentRunReceipt,
  readPiRunJournal,
  writePiRunJournal,
} from '../agent-run-receipt-store'
import { createRuntimeTypedError } from './runtime-errors'
import { reclaimStaleSessionRuntimeLease } from './session-runtime-lease'

export type SidecarRecoveryAction = 'clean' | 'repaired' | 'quarantined'

export interface SidecarRecoveryOptions {
  appBootId: string
  bootId: string
  generation: number
  now?: number
  isProductMessagePersisted?: (messageId: string) => boolean
  validateSidecar?: () => void
}

export interface SidecarRecoveryResult {
  action: SidecarRecoveryAction
  quarantinePath?: string
  safeProductMessageId?: string
  reason?: string
}

interface SidecarSnapshot {
  sidecarPath: string
  journal?: PiRunJournalV1
  journalError?: string
  receipt?: AgentRunReceipt
  receiptError?: string
  sidecarModifiedAt: number
}

/**
 * 在创建 Pi SessionManager 前检查并恢复 sidecar。
 *
 * 这里故意不尝试解析或修补 Pi 私有文件。只要安全边界无法证明，
 * 就把整个目录原子移入只读 quarantine，再从产品层安全消息边界重新开始。
 */
export function recoverPiSidecar(
  sessionId: string,
  options: SidecarRecoveryOptions,
): SidecarRecoveryResult {
  const now = options.now ?? Date.now()
  const snapshot = inspectSidecar(sessionId, options.validateSidecar)

  if (!snapshot.sidecarPath || !snapshot.sidecarModifiedAt) {
    ensureFreshSidecar(sessionId, options, undefined, now)
    return { action: 'clean' }
  }

  if (snapshot.receiptError) {
    return quarantineSidecar(sessionId, snapshot, options, now, 'receipt-corrupt')
  }

  if (snapshot.journalError) {
    return quarantineSidecar(sessionId, snapshot, options, now, 'journal-corrupt')
  }

  const journal = snapshot.journal
  if (!journal) {
    const receipt = snapshot.receipt
    if (receipt && isReceiptSafe(receipt, options) && snapshot.sidecarModifiedAt <= receipt.completedAt) {
      const safeProductMessageId = receipt.lastMessageId
      ensureFreshSidecar(sessionId, options, safeProductMessageId, now)
      return { action: 'repaired', safeProductMessageId, reason: 'journal-missing-before-last-receipt' }
    }
    return quarantineSidecar(sessionId, snapshot, options, now, 'journal-missing')
  }

  if (journal.state === 'clean') {
    return { action: 'clean', safeProductMessageId: journal.safeProductMessageId }
  }

  const safeProductMessageId = getSafeBoundaryMessageId(snapshot, options)
  if (journal.state === 'settled-awaiting-persist' && safeProductMessageId) {
    ensureFreshSidecar(sessionId, options, safeProductMessageId, now)
    return { action: 'repaired', safeProductMessageId, reason: 'settled-boundary-already-persisted' }
  }

  return quarantineSidecar(
    sessionId,
    snapshot,
    options,
    now,
    `journal-${journal.state}`,
  )
}

function inspectSidecar(sessionId: string, validateSidecar?: () => void): SidecarSnapshot {
  const sidecarPath = join(getPiSessionsDir(), safePathSegment(sessionId))
  if (!existsSync(sidecarPath)) {
    return { sidecarPath: '', sidecarModifiedAt: 0 }
  }

  const sidecarStat = lstatSync(sidecarPath)
  if (!sidecarStat.isDirectory() || sidecarStat.isSymbolicLink()) {
    throw createRuntimeTypedError('runtime_sidecar_corrupt', 'Pi sidecar 不是安全的普通目录')
  }
  if (existsSync(join(sidecarPath, 'runtime.lock'))) {
    try {
      if (!reclaimStaleSessionRuntimeLease(sessionId)) {
        throw createRuntimeTypedError('runtime_sidecar_locked', 'Pi sidecar 仍被 Runtime 占用')
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error
      throw createRuntimeTypedError('runtime_sidecar_locked', 'runtime.lock 损坏，拒绝猜测 stale')
    }
  }

  const entries = readdirSync(sidecarPath)
  if (entries.length === 0) {
    return { sidecarPath, sidecarModifiedAt: 0 }
  }

  try {
    validateSidecar?.()
  } catch (error) {
    return {
      sidecarPath,
      sidecarModifiedAt: sidecarStat.mtimeMs,
      journalError: `Pi sidecar 解析失败: ${formatError(error)}`,
    }
  }

  let journal: PiRunJournalV1 | undefined
  let journalError: string | undefined
  try {
    journal = readPiRunJournal(sessionId)
    if (journal) validateJournal(journal, sessionId)
  } catch (error) {
    journalError = formatError(error)
  }

  let receipt: AgentRunReceipt | undefined
  let receiptError: string | undefined
  try {
    receipt = readAgentRunReceipt(sessionId)
    if (receipt) validateReceipt(receipt, sessionId)
  } catch (error) {
    receiptError = formatError(error)
  }

  return {
    sidecarPath,
    journal,
    journalError,
    receipt,
    receiptError,
    sidecarModifiedAt: statSidecarContentModifiedAt(sidecarPath, sidecarStat.mtimeMs),
  }
}

function quarantineSidecar(
  sessionId: string,
  snapshot: SidecarSnapshot,
  options: SidecarRecoveryOptions,
  now: number,
  reason: string,
): SidecarRecoveryResult {
  if (existsSync(join(snapshot.sidecarPath, 'runtime.lock'))) {
    throw createRuntimeTypedError('runtime_sidecar_locked', 'Pi sidecar 仍被 Runtime 占用')
  }

  const runId = snapshot.journal?.runId ?? snapshot.receipt?.runId ?? 'unknown'
  const suffix = `${formatTimestamp(now)}-${safePathSegment(runId)}`
  const quarantinePath = createUniqueQuarantinePath(sessionId, suffix)
  renameSync(snapshot.sidecarPath, quarantinePath)
  makeReadOnly(quarantinePath)

  const safeProductMessageId = getSafeBoundaryMessageId(snapshot, options)
  ensureFreshSidecar(sessionId, options, safeProductMessageId, now)
  return {
    action: 'quarantined',
    quarantinePath,
    safeProductMessageId,
    reason,
  }
}

function ensureFreshSidecar(
  sessionId: string,
  options: SidecarRecoveryOptions,
  safeProductMessageId: string | undefined,
  now: number,
): void {
  const sidecarPath = join(getPiSessionsDir(), safePathSegment(sessionId))
  mkdirSync(sidecarPath, { recursive: true, mode: 0o700 })
  writePiRunJournal(sessionId, {
    version: 1,
    sessionId,
    state: 'clean',
    safeProductMessageId,
    appBootId: options.appBootId,
    bootId: options.bootId,
    generation: options.generation,
    updatedAt: now,
  })
}

function getSafeBoundaryMessageId(
  snapshot: SidecarSnapshot,
  options: SidecarRecoveryOptions,
): string | undefined {
  const journalMessageId = snapshot.journal?.safeProductMessageId
  // settled-awaiting-persist 表示 Runtime 已完成本轮，但主进程可能尚未把
  // persisted 发回。此时 receipt 若同时证明本轮已经完整落盘且 Runtime settled，
  // 它比 journal 中 run 开始前保存的旧边界更新，应当成为新的安全边界。
  if (
    snapshot.journal?.state === 'settled-awaiting-persist'
    && snapshot.receipt
    && isReceiptSafe(snapshot.receipt, options)
  ) {
    return snapshot.receipt.lastMessageId
  }
  const journalPointsAtUnsettledReceipt = Boolean(
    journalMessageId
    && snapshot.receipt
    && snapshot.receipt.lastMessageId === journalMessageId
    && !isReceiptSafe(snapshot.receipt, options),
  )
  if (journalMessageId && !journalPointsAtUnsettledReceipt && (options.isProductMessagePersisted?.(journalMessageId) ?? true)) {
    return journalMessageId
  }

  const receipt = snapshot.receipt
  if (receipt && isReceiptSafe(receipt, options)) return receipt.lastMessageId
  return undefined
}

function isReceiptSafe(receipt: AgentRunReceipt, options: SidecarRecoveryOptions): boolean {
  return receipt.runtimeSettled
    && receipt.fullyPersisted
    && receipt.lastMessageId.length > 0
    && (options.isProductMessagePersisted?.(receipt.lastMessageId) ?? true)
}

function isMessageSafe(
  messageId: string,
  receipt: AgentRunReceipt | undefined,
  options: SidecarRecoveryOptions,
): boolean {
  return Boolean(
    receipt
    && receipt.runtimeSettled
    && receipt.fullyPersisted
    && receipt.lastMessageId === messageId
    && (options.isProductMessagePersisted?.(messageId) ?? true),
  )
}

function createUniqueQuarantinePath(sessionId: string, suffix: string): string {
  const basePath = getPiSessionQuarantinePath(sessionId, suffix)
  mkdirSync(dirname(basePath), { recursive: true, mode: 0o700 })
  if (!existsSync(basePath)) return basePath

  let counter = 1
  while (existsSync(`${basePath}-${counter}`)) counter += 1
  return `${basePath}-${counter}`
}

function makeReadOnly(path: string): void {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) return
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) makeReadOnly(join(path, entry))
    chmodSync(path, 0o555)
    return
  }
  chmodSync(path, 0o444)
}

function statSidecarContentModifiedAt(path: string, fallback: number): number {
  let latest = fallback
  for (const entry of readdirSync(path)) {
    const entryPath = join(path, entry)
    const stat = lstatSync(entryPath)
    if (stat.isSymbolicLink()) continue
    latest = Math.max(latest, stat.mtimeMs)
    if (stat.isDirectory()) latest = Math.max(latest, statSidecarContentModifiedAt(entryPath, stat.mtimeMs))
  }
  return latest
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().replace(/[:.]/g, '-')
}

function validateJournal(journal: PiRunJournalV1, sessionId: string): void {
  if (
    journal.version !== 1
    || journal.sessionId !== sessionId
    || !['clean', 'preparing', 'submitted', 'settled-awaiting-persist', 'dirty'].includes(journal.state)
    || typeof journal.appBootId !== 'string'
    || journal.appBootId.length === 0
    || typeof journal.bootId !== 'string'
    || journal.bootId.length === 0
    || !Number.isInteger(journal.generation)
    || journal.generation < 0
    || !Number.isFinite(journal.updatedAt)
    || (journal.runId !== undefined && typeof journal.runId !== 'string')
    || (journal.safeProductMessageId !== undefined && typeof journal.safeProductMessageId !== 'string')
  ) {
    throw createRuntimeTypedError('runtime_sidecar_corrupt', 'Pi run journal 字段非法')
  }
}

function validateReceipt(receipt: AgentRunReceipt, sessionId: string): void {
  if (
    receipt.sessionId !== sessionId
    || typeof receipt.runId !== 'string'
    || receipt.runId.length === 0
    || !['success', 'stopped', 'error'].includes(receipt.outcome)
    || typeof receipt.lastMessageId !== 'string'
    || typeof receipt.fullyPersisted !== 'boolean'
    || typeof receipt.runtimeSettled !== 'boolean'
    || !Number.isFinite(receipt.completedAt)
  ) {
    throw createRuntimeTypedError('runtime_sidecar_corrupt', 'Agent run receipt 字段非法')
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
