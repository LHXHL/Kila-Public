/**
 * Unified session manager
 *
 * 统一管理单一 Session 的索引与消息持久化。
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type {
  SessionCreateInput,
  SessionMessage,
  SessionMessagesPageResult,
  SessionMeta,
  SessionMetaUpdates,
  SessionRecentMessagesResult,
} from '@kila/shared'
import {
  getAgentWorkspacesDir,
  getProjectProfilesDir,
  getSessionMessagesPath,
  getSessionsDir,
  getSessionsIndexPath,
} from './config-paths'
import { cleanupSessionProject, createSessionProjectFromPath, createTempSessionProject } from './session-project-manager'
import { cleanupSessionBoard } from './session-board-manager'
import { markSessionSearchIndexDirty } from './session-search-dirty'
import { getSettings, updateSettings } from './settings-service'
import { appendTextDurably, readJsonWithBackup, writeTextAtomic, writeTextAtomicWithBackup } from './safe-json-file'


import { createLogger } from './logger'
const log = createLogger('Session 管理')

interface SessionsIndex {
  version: number
  sessions: SessionMeta[]
}

interface SessionManagerPaths {
  indexPath: string
  sessionsDir: string
}

interface SessionManagerDeps {
  paths?: Partial<SessionManagerPaths>
}

const INDEX_VERSION = 1
const DEFAULT_SESSION_TITLE = '新会话'

/** 索引内存缓存（仅用于默认路径，测试 deps 注入不缓存） */
let cachedIndex: SessionsIndex | null = null

function readIndexCached(deps?: SessionManagerDeps): SessionsIndex {
  // 测试环境通过 deps 注入路径，不使用缓存
  if (deps?.paths) return readIndex(deps)
  if (cachedIndex) return cachedIndex
  cachedIndex = readIndex(deps)
  return cachedIndex
}

function invalidateCache(): void {
  cachedIndex = null
}

function normalizeSessionMeta(session: SessionMeta): SessionMeta {
  return {
    ...session,
    title: typeof session.title === 'string' && session.title.trim()
      ? session.title
      : DEFAULT_SESSION_TITLE,
    thinkingLevel: session.thinkingLevel ?? 'none',
  }
}

function stripUndefinedUpdates(updates: SessionMetaUpdates): SessionMetaUpdates {
  return Object.fromEntries(
    Object.entries(updates).filter(([, value]) => typeof value !== 'undefined'),
  ) as SessionMetaUpdates
}

function resolvePaths(paths?: Partial<SessionManagerPaths>): SessionManagerPaths {
  return {
    indexPath: paths?.indexPath ?? getSessionsIndexPath(),
    sessionsDir: paths?.sessionsDir ?? getSessionsDir(),
  }
}

function ensureSessionsDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function readIndex(deps?: SessionManagerDeps): SessionsIndex {
  const { indexPath } = resolvePaths(deps?.paths)
  if (!existsSync(indexPath)) {
    return { version: INDEX_VERSION, sessions: [] }
  }

  try {
    return readJsonWithBackup(indexPath, (raw) => {
      const parsed = JSON.parse(raw) as SessionsIndex
      return {
        version: parsed.version ?? INDEX_VERSION,
        sessions: Array.isArray(parsed.sessions)
          ? parsed.sessions.map((session) => normalizeSessionMeta(session))
          : [],
      }
    })
  } catch (error) {
    log.error('[Session 管理] 读取索引失败:', error)
    return { version: INDEX_VERSION, sessions: [] }
  }
}

function writeIndex(index: SessionsIndex, deps?: SessionManagerDeps): void {
  const { indexPath } = resolvePaths(deps?.paths)
  writeTextAtomicWithBackup(indexPath, JSON.stringify(index, null, 2))
  invalidateCache()
}

function getMessagePath(id: string, deps?: SessionManagerDeps): string {
  const { sessionsDir } = resolvePaths(deps?.paths)
  ensureSessionsDir(sessionsDir)
  return join(sessionsDir, `${id}.jsonl`)
}

function normalizeInteger(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.floor(value) : fallback
}

function normalizeMessageLimit(limit: number, fallback: number): number {
  return Math.max(1, Math.min(500, normalizeInteger(limit, fallback)))
}

interface CorruptJsonlLine {
  sessionId: string
  lineNumber: number
  error: string
  raw: string
}

interface SessionMessageOffsetEntry {
  id: string
  lineNumber: number
  byteOffset: number
  byteLength: number
  createdAt: number
  role: SessionMessage['role']
}

interface SessionMessageOffsetIndex {
  version: 1
  sessionId: string
  messageCount: number
  lineCount: number
  fileSize: number
  offsets: SessionMessageOffsetEntry[]
  updatedAt: number
}

function readUsableSessionOffsetIndex(
  filePath: string,
  sessionId: string,
): SessionMessageOffsetIndex | null {
  const indexPath = `${filePath}.offsets.json`
  if (!existsSync(filePath) || !existsSync(indexPath)) return null

  try {
    const parsed = JSON.parse(readFileSync(indexPath, 'utf-8')) as Partial<SessionMessageOffsetIndex>
    const fileSize = statSync(filePath).size
    if (
      parsed.version !== 1
      || parsed.sessionId !== sessionId
      || parsed.fileSize !== fileSize
      || !Number.isInteger(parsed.lineCount)
      || !Array.isArray(parsed.offsets)
      || parsed.messageCount !== parsed.offsets.length
    ) {
      return null
    }

    let previousEnd = 0
    for (const entry of parsed.offsets) {
      if (
        !entry
        || typeof entry.id !== 'string'
        || !Number.isInteger(entry.byteOffset)
        || !Number.isInteger(entry.byteLength)
        || entry.byteOffset < previousEnd
        || entry.byteLength <= 0
        || entry.byteOffset + entry.byteLength > fileSize
      ) {
        return null
      }
      previousEnd = entry.byteOffset + entry.byteLength
    }

    return parsed as SessionMessageOffsetIndex
  } catch {
    return null
  }
}

function readMessagesAtOffsets(
  filePath: string,
  offsets: readonly SessionMessageOffsetEntry[],
): SessionMessage[] {
  if (offsets.length === 0) return []
  const firstOffset = offsets[0]!.byteOffset
  const lastOffset = offsets.at(-1)!
  const byteLength = lastOffset.byteOffset + lastOffset.byteLength - firstOffset
  const buffer = Buffer.allocUnsafe(byteLength)
  const fd = openSync(filePath, 'r')
  try {
    let bytesRead = 0
    while (bytesRead < byteLength) {
      const count = readSync(fd, buffer, bytesRead, byteLength - bytesRead, firstOffset + bytesRead)
      if (count === 0) break
      bytesRead += count
    }
    if (bytesRead !== byteLength) {
      throw new Error(`消息索引读取不完整: ${firstOffset}-${firstOffset + byteLength}`)
    }
  } finally {
    closeSync(fd)
  }

  return offsets.map((entry) => {
    const start = entry.byteOffset - firstOffset
    return JSON.parse(buffer.subarray(start, start + entry.byteLength).toString('utf-8').trim()) as SessionMessage
  })
}

function readSessionMessageLines(filePath: string, sessionId: string): { messages: SessionMessage[], corrupt: CorruptJsonlLine[] } {
  const lines = readFileSync(filePath, 'utf-8').split('\n')
  const messages: SessionMessage[] = []
  const corrupt: CorruptJsonlLine[] = []
  const offsets: SessionMessageOffsetEntry[] = []
  let byteOffset = 0

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]!
    const hasLineBreak = index < lines.length - 1
    const byteLength = Buffer.byteLength(raw) + (hasLineBreak ? 1 : 0)
    if (!raw.trim()) {
      byteOffset += byteLength
      continue
    }
    try {
      const message = JSON.parse(raw) as SessionMessage
      messages.push(message)
      offsets.push({
        id: message.id,
        lineNumber: index + 1,
        byteOffset,
        byteLength,
        createdAt: message.createdAt,
        role: message.role,
      })
    } catch (error) {
      corrupt.push({
        sessionId,
        lineNumber: index + 1,
        error: error instanceof Error ? error.message : String(error),
        raw,
      })
    }
    byteOffset += byteLength
  }

  persistCorruptSessionLines(filePath, corrupt)
  const lineCount = lines.length - (lines.at(-1) === '' ? 1 : 0)
  persistSessionOffsetIndex(filePath, sessionId, offsets, lineCount, byteOffset)
  if (corrupt.length > 0) {
    log.warn(`[Session 管理] 已隔离 ${corrupt.length} 条损坏消息行 (${sessionId})`)
  }

  return { messages, corrupt }
}

function persistSessionOffsetIndex(
  filePath: string,
  sessionId: string,
  offsets: SessionMessageOffsetEntry[],
  lineCount: number,
  fileSize: number,
): void {
  writeTextAtomic(`${filePath}.offsets.json`, JSON.stringify({
    version: 1,
    sessionId,
    messageCount: offsets.length,
    lineCount,
    fileSize,
    offsets,
    updatedAt: Date.now(),
  }, null, 2))
}

function persistCorruptSessionLines(filePath: string, corrupt: CorruptJsonlLine[]): void {
  const corruptPath = `${filePath}.corrupt`
  if (corrupt.length === 0) {
    if (existsSync(corruptPath)) {
      unlinkSync(corruptPath)
    }
    return
  }

  const content = corrupt.map((entry) => JSON.stringify(entry)).join('\n')
  writeTextAtomic(corruptPath, `${content}\n`)
}

export function listSessions(deps?: SessionManagerDeps): SessionMeta[] {
  const index = readIndexCached(deps)
  return index.sessions.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getSessionMeta(id: string, deps?: SessionManagerDeps): SessionMeta | undefined {
  return readIndexCached(deps).sessions.find((session) => session.id === id)
}

export function createSession(input?: SessionCreateInput, deps?: SessionManagerDeps): SessionMeta {
  const index = readIndexCached(deps)
  const now = Date.now()
  const sessionId = randomUUID()
  const project = input?.projectPath
    ? createSessionProjectFromPath(input.projectPath, 'user')
    : createTempSessionProject(sessionId)
  const meta: SessionMeta = normalizeSessionMeta({
    id: sessionId,
    title: input?.title || '新会话',
    messageSource: input?.messageSource,
    messageSourceLabel: input?.messageSourceLabel,
    relatedTaskId: input?.relatedTaskId,
    parentSessionId: input?.parentSessionId,
    branchPointMessageId: input?.branchPointMessageId,
    branchedAt: input?.branchedAt,
    project,
    channelId: input?.channelId,
    modelId: input?.modelId,
    thinkingLevel: input?.thinkingLevel ?? 'medium',
    historyTurns: input?.historyTurns,
    enabledToolIds: input?.enabledToolIds,
    systemPromptId: input?.systemPromptId,
    createdAt: now,
    updatedAt: now,
  })

  index.sessions.push(meta)
  writeIndex(index, deps)
  if (!deps?.paths) markSessionSearchIndexDirty(sessionId)
  ensureSessionsDir(resolvePaths(deps?.paths).sessionsDir)
  return meta
}

export function updateSessionMeta(id: string, updates: SessionMetaUpdates, deps?: SessionManagerDeps): SessionMeta {
  const index = readIndexCached(deps)
  const idx = index.sessions.findIndex((session) => session.id === id)
  if (idx < 0) {
    throw new Error(`Session 不存在: ${id}`)
  }

  const sanitizedUpdates = stripUndefinedUpdates(updates)

  const updated: SessionMeta = normalizeSessionMeta({
    ...index.sessions[idx]!,
    ...sanitizedUpdates,
    updatedAt: Date.now(),
  })

  index.sessions[idx] = updated
  writeIndex(index, deps)
  if (!deps?.paths) markSessionSearchIndexDirty(id)
  return updated
}

export function deleteSession(id: string, deps?: SessionManagerDeps): void {
  const index = readIndexCached(deps)
  const idx = index.sessions.findIndex((session) => session.id === id)
  if (idx < 0) {
    throw new Error(`Session 不存在: ${id}`)
  }
  const removed = index.sessions[idx]!

  index.sessions.splice(idx, 1)
  writeIndex(index, deps)

  const filePath = getMessagePath(id, deps)
  for (const persistedPath of [filePath, `${filePath}.offsets.json`, `${filePath}.corrupt`]) {
    if (existsSync(persistedPath)) {
      unlinkSync(persistedPath)
    }
  }

  cleanupSessionProject(removed.project)
  cleanupSessionBoard(id)
  if (!deps?.paths) markSessionSearchIndexDirty(id)
}

export function getSessionMessages(id: string, deps?: SessionManagerDeps): SessionMessage[] {
  const filePath = getMessagePath(id, deps)
  if (!existsSync(filePath)) {
    return []
  }

  try {
    return readSessionMessageLines(filePath, id).messages
  } catch (error) {
    log.error(`[Session 管理] 读取消息失败 (${id}):`, error)
    return []
  }
}

export function getRecentSessionMessages(id: string, limit: number, deps?: SessionManagerDeps): SessionRecentMessagesResult {
  const filePath = getMessagePath(id, deps)
  if (!existsSync(filePath)) {
    return { messages: [], total: 0, hasMore: false }
  }

  const safeLimit = normalizeMessageLimit(limit, 100)
  const index = readUsableSessionOffsetIndex(filePath, id)
    ?? (() => {
      readSessionMessageLines(filePath, id)
      return readUsableSessionOffsetIndex(filePath, id)
    })()
  if (!index) return { messages: [], total: 0, hasMore: false }
  const total = index.messageCount
  const selectedOffsets = total <= safeLimit ? index.offsets : index.offsets.slice(-safeLimit)

  return {
    messages: readMessagesAtOffsets(filePath, selectedOffsets),
    total,
    hasMore: total > safeLimit,
  }
}

export function getSessionMessagesPage(id: string, offset = 0, limit = 100, deps?: SessionManagerDeps): SessionMessagesPageResult {
  const filePath = getMessagePath(id, deps)
  if (!existsSync(filePath)) {
    return { messages: [], total: 0, offset: 0, limit: normalizeMessageLimit(limit, 100), hasMore: false }
  }

  const index = readUsableSessionOffsetIndex(filePath, id)
    ?? (() => {
      readSessionMessageLines(filePath, id)
      return readUsableSessionOffsetIndex(filePath, id)
    })()
  const safeLimit = normalizeMessageLimit(limit, 100)
  if (!index) {
    return { messages: [], total: 0, offset: 0, limit: safeLimit, hasMore: false }
  }
  const total = index.messageCount
  const safeOffset = Math.max(0, Math.min(total, normalizeInteger(offset, 0)))
  const selectedOffsets = index.offsets.slice(safeOffset, safeOffset + safeLimit)

  return {
    messages: readMessagesAtOffsets(filePath, selectedOffsets),
    total,
    offset: safeOffset,
    limit: safeLimit,
    hasMore: safeOffset + selectedOffsets.length < total,
  }
}

export function appendSessionMessage(id: string, message: SessionMessage, deps?: SessionManagerDeps): void {
  const filePath = getMessagePath(id, deps)
  const existed = existsSync(filePath)
  const previousSize = existed ? statSync(filePath).size : 0
  const previousIndex = existed
    ? readUsableSessionOffsetIndex(filePath, id)
    : {
      version: 1 as const,
      sessionId: id,
      messageCount: 0,
      lineCount: 0,
      fileSize: 0,
      offsets: [],
      updatedAt: Date.now(),
    }
  const line = `${JSON.stringify(message)}\n`
  const byteLength = Buffer.byteLength(line)
  appendTextDurably(filePath, line)

  if (previousIndex && previousIndex.fileSize === previousSize) {
    persistSessionOffsetIndex(filePath, id, [
      ...previousIndex.offsets,
      {
        id: message.id,
        lineNumber: previousIndex.lineCount + 1,
        byteOffset: previousSize,
        byteLength,
        createdAt: message.createdAt,
        role: message.role,
      },
    ], previousIndex.lineCount + 1, previousSize + byteLength)
  } else {
    readSessionMessageLines(filePath, id)
  }
  if (!deps?.paths) markSessionSearchIndexDirty(id)
}

export function saveSessionMessages(id: string, messages: SessionMessage[], deps?: SessionManagerDeps): void {
  const filePath = getMessagePath(id, deps)
  const content = messages.map((message) => JSON.stringify(message)).join('\n')
  writeTextAtomic(filePath, content ? `${content}\n` : '')
  if (existsSync(filePath)) {
    readSessionMessageLines(filePath, id)
  }
  if (!deps?.paths) markSessionSearchIndexDirty(id)
}

export function bootstrapUnifiedSessions(): void {
  const settings = getSettings()
  if (settings.unifiedSessionsBootstrapped && settings.sessionProjectModelBootstrapped) {
    return
  }

  // 清理旧数据（仅首次运行时执行）
  const projectModelTargets = [
    resolvePaths().indexPath,
    resolvePaths().sessionsDir,
    getAgentWorkspacesDir(),
    getProjectProfilesDir(),
  ]

  for (const target of projectModelTargets) {
    if (!existsSync(target)) continue
    rmSync(target, { recursive: true, force: true })
  }

  updateSettings({
    unifiedSessionsBootstrapped: true,
    sessionProjectModelBootstrapped: true,
    agentWorkspaceId: undefined,
    tabState: undefined,
  })
  markSessionSearchIndexDirty()
}
