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
  readdirSync,
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
import { getSettings, isSettingsDegraded, updateSettings } from './settings-service'
import { appendTextDurably, readJsonWithBackup, writeTextAtomic, writeTextAtomicWithBackup } from './safe-json-file'
import { createDegradedConfigRegistry, degradeCorruptConfig } from './config-file-guard'


import { createLogger } from './logger'
const log = createLogger('Session 管理')

/**
 * 索引降级只读登记表。
 *
 * sessions.json 主备双双解析失败时，内存里只有一个空列表；此时任何 writeIndex
 * 都会把空列表连同 .bak 一起写死，销毁唯一恢复源。登记后本进程拒绝所有覆盖写。
 */
const degradedIndexes = createDegradedConfigRegistry()

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

/**
 * 会话完整消息的进程内缓存，按文件 mtime + size 失效。
 *
 * getSessionMessages 每次都 readFileSync + split + 逐行 JSON.parse，
 * 而编排器单轮内会多次全量读取同一 transcript（上下文装配、完成收敛、记忆回填）。
 * 追加写会改变 mtime/size，缓存自动失效，无需手动 invalidate；仅默认路径启用，测试注入 deps 不缓存。
 */
interface CachedMessages {
  mtimeMs: number
  size: number
  messages: SessionMessage[]
}
const MESSAGE_CACHE_MAX_ENTRIES = 32
const messageCache = new Map<string, CachedMessages>()

function invalidateMessageCache(sessionId: string): void {
  messageCache.delete(sessionId)
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
  // 文件不存在是可信的首次运行，允许后续写入；「存在但读不出来」才是不可信状态。
  if (!existsSync(indexPath)) {
    return { version: INDEX_VERSION, sessions: [] }
  }

  try {
    return readJsonWithBackup(indexPath, (raw) => {
      const parsed = JSON.parse(raw) as SessionsIndex
      if (!Array.isArray(parsed.sessions)) {
        throw new Error('sessions 字段缺失或不是数组')
      }
      return {
        version: parsed.version ?? INDEX_VERSION,
        sessions: parsed.sessions.map((session) => normalizeSessionMeta(session)),
      }
    })
  } catch (error) {
    degradeCorruptConfig(degradedIndexes, { filePath: indexPath, label: '会话索引', error })
    return { version: INDEX_VERSION, sessions: [] }
  }
}

function writeIndex(index: SessionsIndex, deps?: SessionManagerDeps): void {
  const { indexPath } = resolvePaths(deps?.paths)
  const degradedReason = degradedIndexes.getDegradedReason(indexPath)
  if (degradedReason) {
    // 内存里的索引是兜底空值，写回等于永久删除全部会话元数据，必须显式失败。
    log.error(`[Session 管理] 索引处于降级只读模式，已拒绝写入: ${degradedReason}`)
    throw new Error(`会话索引处于降级只读模式，已拒绝写入以避免会话丢失（${degradedReason}）`)
  }

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
  invalidateMessageCache(id)
  if (!deps?.paths) markSessionSearchIndexDirty(id)
}

export function getSessionMessages(id: string, deps?: SessionManagerDeps): SessionMessage[] {
  const filePath = getMessagePath(id, deps)
  if (!existsSync(filePath)) {
    return []
  }

  // 测试注入 deps 时不走缓存，避免跨用例串扰。
  const useCache = !deps?.paths

  try {
    if (useCache) {
      const stat = statSync(filePath)
      const cached = messageCache.get(id)
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return cached.messages
      }
      const messages = readSessionMessageLines(filePath, id).messages
      // 简单 FIFO 淘汰，避免缓存无界增长。
      if (messageCache.size >= MESSAGE_CACHE_MAX_ENTRIES) {
        const oldestKey = messageCache.keys().next().value
        if (oldestKey !== undefined) messageCache.delete(oldestKey)
      }
      messageCache.set(id, { mtimeMs: stat.mtimeMs, size: stat.size, messages })
      return messages
    }
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
  invalidateMessageCache(id)
  if (!deps?.paths) markSessionSearchIndexDirty(id)
}

export function saveSessionMessages(id: string, messages: SessionMessage[], deps?: SessionManagerDeps): void {
  const filePath = getMessagePath(id, deps)
  const content = messages.map((message) => JSON.stringify(message)).join('\n')
  writeTextAtomic(filePath, content ? `${content}\n` : '')
  if (existsSync(filePath)) {
    readSessionMessageLines(filePath, id)
  }
  invalidateMessageCache(id)
  if (!deps?.paths) markSessionSearchIndexDirty(id)
}

/**
 * 判断磁盘上是否已经存在统一 Session 数据。
 *
 * 只要索引文件存在，或 sessions/ 目录里还有任何文件，就说明这是老用户而非首装。
 * 注意 getSessionsDir() 会自动创建空目录，所以目录存在本身不能作为判据。
 */
function hasExistingUnifiedSessionData(): boolean {
  const { indexPath, sessionsDir } = resolvePaths()

  if (existsSync(indexPath)) return true
  if (!existsSync(sessionsDir)) return false

  try {
    return readdirSync(sessionsDir).length > 0
  } catch (error) {
    // 目录存在却读不出来时按「有数据」处理：宁可不清理，也不能误删。
    log.error('[Session 管理] 扫描 Session 目录失败，按已有数据处理:', error)
    return true
  }
}

export function bootstrapUnifiedSessions(): void {
  const settings = getSettings()
  if (settings.unifiedSessionsBootstrapped && settings.sessionProjectModelBootstrapped) {
    return
  }

  // 护栏一：设置文件不可信时，bootstrapped 标志同样不可信，绝不执行破坏性清理。
  if (isSettingsDegraded()) {
    log.error('[Session 管理] 应用设置处于降级状态，已跳过首次引导的数据清理')
    return
  }

  // 护栏二：磁盘上已有 Session 数据说明是老用户，只补标志，不清理任何目录。
  if (hasExistingUnifiedSessionData()) {
    log.warn('[Session 管理] 检测到已有 Session 数据，跳过首次引导清理并直接标记为已引导')
    updateSettings({
      unifiedSessionsBootstrapped: true,
      sessionProjectModelBootstrapped: true,
    })
    markSessionSearchIndexDirty()
    return
  }

  // 清理旧数据（仅确认首次运行时执行）
  const projectModelTargets = [
    resolvePaths().indexPath,
    resolvePaths().sessionsDir,
    getAgentWorkspacesDir(),
    getProjectProfilesDir(),
  ]

  for (const target of projectModelTargets) {
    if (!existsSync(target)) continue
    log.warn(`[Session 管理] 首次引导清理旧数据: ${target}`)
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
