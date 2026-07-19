import { existsSync, readFileSync, statSync } from 'node:fs'
import { Worker } from 'node:worker_threads'
import type {
  SessionMessage,
  SessionMeta,
  SessionSearchInput,
  SessionSearchResult,
  SessionSearchResults,
} from '@kila/shared'
import { getSearchIndexPath, getSessionMessagesPath, getSessionsDir } from './config-paths'
import { createLogger } from './logger'
import { writeTextAtomic } from './safe-json-file'
import {
  consumeSessionSearchIndexDirtyState,
  markSessionSearchIndexDirty,
} from './session-search-dirty'
import { listSessions } from './session-manager'

interface IndexedMessage {
  id: string
  role: SessionMessage['role']
  text: string
  createdAt: number
}

interface SessionSearchIndexEntry {
  fileSize: number
  messages: IndexedMessage[]
}

interface SessionSearchIndexSnapshot {
  version: 1
  sessions: Record<string, SessionSearchIndexEntry>
}

interface WorkerSessionInput {
  id: string
}

interface WorkerResult {
  entries: Record<string, SessionSearchIndexEntry>
}

const INDEX_VERSION = 1
const DEFAULT_LIMIT_PER_TYPE = 20
const MAX_LIMIT_PER_TYPE = 100
const MAX_REFRESH_ATTEMPTS = 4
const SNIPPET_RADIUS = 80
const SAFE_SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/
const SESSION_MESSAGE_ROLES = new Set<SessionMessage['role']>(['user', 'assistant', 'system', 'status', 'tool'])
const log = createLogger('会话搜索')

let cachedPath: string | null = null
let snapshot: SessionSearchIndexSnapshot | null = null
let snapshotValidated = false
let activeWorker: Worker | null = null
let activeRefresh: Promise<boolean> | null = null

/**
 * Worker 只提取 JSONL 顶层的可搜索字段，不解析体积可能很大的 events。
 * 这样旧数据的首次建索引也不会阻塞 Electron 主进程。
 */
const SEARCH_INDEX_WORKER_SOURCE = String.raw`
const { createReadStream, existsSync, statSync } = require('node:fs')
const { join } = require('node:path')
const { createInterface } = require('node:readline')
const { parentPort, workerData } = require('node:worker_threads')

function skipWhitespace(line, start) {
  let index = start
  while (index < line.length && /\s/.test(line[index])) index += 1
  return index
}

function scanStringEnd(line, start) {
  if (line[start] !== '"') return -1
  let escaped = false
  for (let index = start + 1; index < line.length; index += 1) {
    const char = line[index]
    if (escaped) {
      escaped = false
    } else if (char === '\\') {
      escaped = true
    } else if (char === '"') {
      return index + 1
    }
  }
  return -1
}

function scanCompositeEnd(line, start) {
  const stack = [line[start]]
  let inString = false
  let escaped = false
  for (let index = start + 1; index < line.length; index += 1) {
    const char = line[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{' || char === '[') {
      stack.push(char)
      continue
    }
    if (char !== '}' && char !== ']') continue
    const expected = char === '}' ? '{' : '['
    if (stack[stack.length - 1] !== expected) return -1
    stack.pop()
    if (stack.length === 0) return index + 1
  }
  return -1
}

function scanValueEnd(line, start) {
  if (line[start] === '"') return scanStringEnd(line, start)
  if (line[start] === '{' || line[start] === '[') return scanCompositeEnd(line, start)

  let end = start
  while (end < line.length && line[end] !== ',' && line[end] !== '}') end += 1
  while (end > start && /\s/.test(line[end - 1])) end -= 1
  return end > start ? end : -1
}

function readTopLevelField(line, key) {
  let index = skipWhitespace(line, 0)
  if (line[index] !== '{') return undefined
  index = skipWhitespace(line, index + 1)

  while (index < line.length && line[index] !== '}') {
    const keyEnd = scanStringEnd(line, index)
    if (keyEnd < 0) return undefined
    let propertyKey
    try {
      propertyKey = JSON.parse(line.slice(index, keyEnd))
    } catch {
      return undefined
    }
    index = skipWhitespace(line, keyEnd)
    if (line[index] !== ':') return undefined
    const valueStart = skipWhitespace(line, index + 1)
    const valueEnd = scanValueEnd(line, valueStart)
    if (valueEnd < 0) return undefined
    if (propertyKey === key) return line.slice(valueStart, valueEnd)

    index = skipWhitespace(line, valueEnd)
    if (line[index] === ',') {
      index = skipWhitespace(line, index + 1)
      continue
    }
    if (line[index] === '}') return undefined
    return undefined
  }
  return undefined
}

function readStringField(line, key) {
  const raw = readTopLevelField(line, key)
  if (!raw || raw[0] !== '"') return undefined
  const value = JSON.parse(raw)
  return typeof value === 'string' ? value : undefined
}

function readNumberField(line, key) {
  const raw = readTopLevelField(line, key)
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

function readArrayField(line, key) {
  const raw = readTopLevelField(line, key)
  if (!raw || raw[0] !== '[') return undefined
  return JSON.parse(raw)
}

async function indexSession(sessionsDir, session) {
  const filePath = join(sessionsDir, session.id + '.jsonl')
  if (!existsSync(filePath)) return { fileSize: 0, messages: [] }

  const messages = []
  const lines = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  })
  for await (const line of lines) {
    if (!line.trim()) continue
    try {
      const id = readStringField(line, 'id')
      const role = readStringField(line, 'role')
      const content = readStringField(line, 'content')
      const createdAt = readNumberField(line, 'createdAt')
      if (!id || !role || typeof content !== 'string' || typeof createdAt !== 'number') continue
      const attachments = readArrayField(line, 'attachments')
      const attachmentNames = Array.isArray(attachments)
        ? attachments.map((attachment) => attachment && attachment.filename).filter(Boolean).join(' ')
        : ''
      messages.push({
        id,
        role,
        text: (content + ' ' + attachmentNames).trim(),
        createdAt,
      })
    } catch {
      // 损坏行由 Session 管理器负责隔离，搜索索引仅跳过。
    }
  }
  return { fileSize: statSync(filePath).size, messages }
}

async function main() {
  const entries = Object.create(null)
  for (const session of workerData.sessions) {
    entries[session.id] = await indexSession(workerData.sessionsDir, session)
  }
  parentPort.postMessage({ entries })
}

main().catch((error) => {
  throw error
})
`

function emptySnapshot(): SessionSearchIndexSnapshot {
  return { version: INDEX_VERSION, sessions: {} }
}

function isIndexEntry(value: unknown): value is SessionSearchIndexEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<SessionSearchIndexEntry>
  return (
    Number.isInteger(entry.fileSize)
    && (entry.fileSize ?? -1) >= 0
    && Array.isArray(entry.messages)
    && entry.messages.every((message) => (
      message
      && typeof message.id === 'string'
      && SESSION_MESSAGE_ROLES.has(message.role)
      && typeof message.text === 'string'
      && Number.isFinite(message.createdAt)
    ))
  )
}

function loadSnapshot(): SessionSearchIndexSnapshot {
  const indexPath = getSearchIndexPath()
  if (cachedPath !== indexPath) {
    activeWorker?.terminate().catch(() => {})
    cachedPath = indexPath
    snapshot = null
    snapshotValidated = false
    activeWorker = null
    activeRefresh = null
  }
  if (snapshot) return snapshot
  if (!existsSync(indexPath)) {
    snapshot = emptySnapshot()
    return snapshot
  }

  try {
    const parsed = JSON.parse(readFileSync(indexPath, 'utf-8')) as Partial<SessionSearchIndexSnapshot>
    if (parsed.version !== INDEX_VERSION || !parsed.sessions || typeof parsed.sessions !== 'object') {
      snapshot = emptySnapshot()
      return snapshot
    }
    const sessions = Object.fromEntries(
      Object.entries(parsed.sessions).filter(([, entry]) => isIndexEntry(entry)),
    )
    snapshot = { version: INDEX_VERSION, sessions }
  } catch {
    snapshot = emptySnapshot()
  }
  return snapshot
}

function currentMessageFileSize(sessionId: string): number {
  if (!SAFE_SESSION_ID_PATTERN.test(sessionId)) return 0
  const filePath = getSessionMessagesPath(sessionId)
  return existsSync(filePath) ? statSync(filePath).size : 0
}

function persistSnapshot(): void {
  const current = loadSnapshot()
  writeTextAtomic(getSearchIndexPath(), JSON.stringify(current))
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT_PER_TYPE
  const value = Math.floor(limit as number)
  if (value < 1) return DEFAULT_LIMIT_PER_TYPE
  return Math.min(value, MAX_LIMIT_PER_TYPE)
}

function createSnippet(text: string, query: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  const index = compact.toLowerCase().indexOf(query)
  if (index < 0) return compact.slice(0, SNIPPET_RADIUS * 2)
  const start = Math.max(0, index - SNIPPET_RADIUS)
  const end = Math.min(compact.length, index + query.length + SNIPPET_RADIUS)
  return `${start > 0 ? '...' : ''}${compact.slice(start, end)}${end < compact.length ? '...' : ''}`
}

function scoreText(text: string, query: string, base: number): number {
  const normalized = text.toLowerCase()
  if (normalized === query) return base + 100
  if (normalized.startsWith(query)) return base + 50
  if (normalized.includes(query)) return base + 10
  return 0
}

function pushLimited(bucket: SessionSearchResult[], result: SessionSearchResult, limit: number): void {
  bucket.push(result)
  bucket.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt)
  if (bucket.length > limit) bucket.length = limit
}

function startWorker(sessions: WorkerSessionInput[]): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(SEARCH_INDEX_WORKER_SOURCE, {
      eval: true,
      workerData: { sessions, sessionsDir: getSessionsDir() },
    })
    activeWorker = worker
    worker.once('message', (result: WorkerResult) => resolve(result))
    worker.once('error', reject)
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`搜索索引 Worker 异常退出: ${code}`))
    })
  })
}

function collectRefreshTargets(sessions: SessionMeta[]): { ids: string[]; changed: boolean } {
  const current = loadSnapshot()
  const sessionIds = new Set(sessions.map((session) => session.id))
  const dirty = consumeSessionSearchIndexDirtyState()
  const targets = new Set<string>()
  let changed = false

  for (const indexedId of Object.keys(current.sessions)) {
    if (!sessionIds.has(indexedId) || !SAFE_SESSION_ID_PATTERN.test(indexedId)) {
      delete current.sessions[indexedId]
      changed = true
    }
  }

  if (dirty.fullRebuild) {
    for (const session of sessions) {
      if (SAFE_SESSION_ID_PATTERN.test(session.id)) targets.add(session.id)
    }
  } else {
    for (const sessionId of dirty.sessionIds) {
      if (sessionIds.has(sessionId) && SAFE_SESSION_ID_PATTERN.test(sessionId)) targets.add(sessionId)
    }
  }

  if (!snapshotValidated) {
    for (const session of sessions) {
      const entry = current.sessions[session.id]
      if (
        SAFE_SESSION_ID_PATTERN.test(session.id)
        && (!entry || entry.fileSize !== currentMessageFileSize(session.id))
      ) {
        targets.add(session.id)
      }
    }
    snapshotValidated = true
  }

  return { ids: Array.from(targets), changed }
}

async function refreshIndex(): Promise<boolean> {
  if (activeRefresh) return activeRefresh
  const sessions = listSessions()
  const { ids, changed } = collectRefreshTargets(sessions)
  if (ids.length === 0) {
    if (changed) persistSnapshot()
    return changed
  }

  const sessionById = new Map(sessions.map((session) => [session.id, session]))
  const targets = ids
    .map((id) => sessionById.get(id))
    .filter((session): session is SessionMeta => Boolean(session))
    .map((session) => ({ id: session.id }))

  activeRefresh = startWorker(targets)
    .then((result) => {
      const current = loadSnapshot()
      for (const id of ids) {
        const entry = result.entries[id]
        if (entry) current.sessions[id] = entry
      }
      persistSnapshot()
      return true
    })
    .catch((error) => {
      for (const id of ids) markSessionSearchIndexDirty(id)
      log.error('[会话搜索] 构建索引失败:', error)
      return true
    })
    .finally(() => {
      activeWorker = null
      activeRefresh = null
    })

  return activeRefresh
}

async function refreshIndexUntilStable(): Promise<void> {
  for (let attempt = 0; attempt < MAX_REFRESH_ATTEMPTS; attempt += 1) {
    const refreshed = await refreshIndex()
    if (!refreshed) return
  }
}

export async function searchSessionsWithIndex(input: SessionSearchInput): Promise<SessionSearchResults> {
  const rawQuery = input.query.trim()
  const query = rawQuery.toLowerCase()
  if (!query) return { query: input.query, results: [] }

  await refreshIndexUntilStable()
  const current = loadSnapshot()
  const limit = normalizeLimit(input.limitPerType)
  const sessionResults: SessionSearchResult[] = []
  const projectResults: SessionSearchResult[] = []
  const messageResults: SessionSearchResult[] = []

  for (const session of listSessions()) {
    const titleScore = scoreText(session.title, query, 300)
    if (titleScore > 0) {
      pushLimited(sessionResults, {
        type: 'session',
        sessionId: session.id,
        title: session.title,
        subtitle: session.project.path,
        snippet: createSnippet(session.title, query),
        score: titleScore,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      }, limit)
    }

    const projectText = `${session.project.name} ${session.project.path}`
    const projectScore = scoreText(projectText, query, 200)
    if (projectScore > 0) {
      pushLimited(projectResults, {
        type: 'project',
        sessionId: session.id,
        title: session.title,
        subtitle: session.project.path,
        snippet: createSnippet(projectText, query),
        score: projectScore,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      }, limit)
    }

    for (const message of current.sessions[session.id]?.messages ?? []) {
      const messageScore = scoreText(message.text, query, 100)
      if (messageScore <= 0) continue
      pushLimited(messageResults, {
        type: 'message',
        sessionId: session.id,
        messageId: message.id,
        role: message.role,
        title: session.title,
        subtitle: session.project.path,
        snippet: createSnippet(message.text, query),
        score: messageScore,
        createdAt: message.createdAt,
        updatedAt: session.updatedAt,
      }, limit)
    }
  }

  return {
    query: input.query,
    results: [...sessionResults, ...projectResults, ...messageResults],
  }
}

export async function warmSessionSearchIndex(): Promise<void> {
  await refreshIndexUntilStable()
}

export function disposeSessionSearchIndex(): void {
  activeWorker?.terminate().catch(() => {})
  cachedPath = null
  snapshot = null
  snapshotValidated = false
  activeWorker = null
  activeRefresh = null
}
