import type { SessionMessage, SessionMeta } from '@kila/shared'
import { getSessionMessages, listSessions } from '../session-manager'
import { getMemoryRuntimeConfig, isNowledgeConfigured } from './config'
import { memoryStateStore } from './state-store'
import type { MemoryDistillThreadMessage, NowledgeThreadState } from './types'

const KILA_THREAD_SOURCE = 'kila'
const DEFAULT_PAGE_SIZE = 100
const DEFAULT_TIMEOUT_MS = 30_000

export interface ReconcileThreadOptions {
  apply?: boolean
  cascadeDeleteMemories?: boolean
  pageSize?: number
}

export interface ReconcileSessionRecord {
  sessionId: string
  sessionTitle: string
  projectPath?: string
  threadTitle?: string
  distillMessages: MemoryDistillThreadMessage[]
  rawMessageCount: number
}

export interface ReconcileRemoteThreadRecord {
  threadId: string
  title?: string
  source?: string
  messageCount: number
}

export interface CreateRemoteThreadAction {
  kind: 'create_remote_thread'
  sessionId: string
  threadId: string
  threadTitle?: string
  projectPath?: string
  messages: MemoryDistillThreadMessage[]
  reason: string
}

export interface UpsertLocalThreadStateAction {
  kind: 'upsert_local_thread_state'
  state: NowledgeThreadState
  reason: string
}

export interface DeleteLocalThreadStateAction {
  kind: 'delete_local_thread_state'
  sessionId: string
  threadId: string
  deleteMode: 'thread' | 'session'
  reason: string
}

export interface DeleteRemoteThreadAction {
  kind: 'delete_remote_thread'
  threadId: string
  cascadeDeleteMemories: boolean
  reason: string
}

export interface ThreadNormalizationPlan {
  createRemoteThreads: CreateRemoteThreadAction[]
  upsertLocalThreadStates: UpsertLocalThreadStateAction[]
  deleteLocalThreadStates: DeleteLocalThreadStateAction[]
}

export interface RemoteThreadDeletionPlan {
  deleteRemoteThreads: DeleteRemoteThreadAction[]
}

export interface ReconcileSnapshot {
  sessions: ReconcileSessionRecord[]
  localStates: NowledgeThreadState[]
  remoteThreads: ReconcileRemoteThreadRecord[]
}

export interface AppliedActionResult {
  kind: string
  target: string
  status: 'applied' | 'skipped' | 'failed'
  detail: string
}

export interface ReconcileThreadReport {
  apply: boolean
  cascadeDeleteMemories: boolean
  initialSnapshot: {
    sessions: number
    localStates: number
    remoteThreads: number
  }
  normalizationPlan: {
    createRemoteThreads: number
    upsertLocalThreadStates: number
    deleteLocalThreadStates: number
  }
  remoteDeletionPlan: {
    deleteRemoteThreads: number
  }
  normalizationResults: AppliedActionResult[]
  remoteDeletionResults: AppliedActionResult[]
  finalSnapshot?: {
    sessions: number
    localStates: number
    remoteThreads: number
  }
}

interface NowledgeThreadClient {
  listThreads(input: { source: string; limit: number; offset: number }): Promise<{
    threads: ReconcileRemoteThreadRecord[]
    hasMore: boolean
  }>
  createThread(input: {
    threadId: string
    threadTitle?: string
    projectPath?: string
    messages: MemoryDistillThreadMessage[]
  }): Promise<void>
  deleteThread(input: {
    threadId: string
    cascadeDeleteMemories: boolean
  }): Promise<void>
}

function normalizeText(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function isDistillRole(message: SessionMessage): message is SessionMessage & { role: 'user' | 'assistant' } {
  return message.role === 'user' || message.role === 'assistant'
}

function toDistillMessages(messages: SessionMessage[]): MemoryDistillThreadMessage[] {
  return messages
    .filter(isDistillRole)
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }))
    .filter((message) => message.content)
}

function toThreadTitle(messages: SessionMessage[]): string | undefined {
  const firstUserMessage = messages.find((message) => (
    message.role === 'user' && typeof message.content === 'string' && message.content.trim()
  ))
  if (!firstUserMessage) return undefined
  const normalized = firstUserMessage.content.replace(/\s+/g, ' ').trim()
  return normalized ? normalized.slice(0, 120) : undefined
}

function buildSessionRecord(session: SessionMeta): ReconcileSessionRecord {
  const messages = getSessionMessages(session.id)
  return {
    sessionId: session.id,
    sessionTitle: session.title,
    projectPath: session.project.path,
    threadTitle: toThreadTitle(messages),
    distillMessages: toDistillMessages(messages),
    rawMessageCount: messages.length,
  }
}

function summarizeSnapshot(snapshot: ReconcileSnapshot): {
  sessions: number
  localStates: number
  remoteThreads: number
} {
  return {
    sessions: snapshot.sessions.length,
    localStates: snapshot.localStates.length,
    remoteThreads: snapshot.remoteThreads.length,
  }
}

export function planThreadNormalization(snapshot: ReconcileSnapshot): ThreadNormalizationPlan {
  const createRemoteThreads: CreateRemoteThreadAction[] = []
  const upsertLocalThreadStates: UpsertLocalThreadStateAction[] = []
  const deleteLocalThreadStates: DeleteLocalThreadStateAction[] = []

  const sessionIds = new Set(snapshot.sessions.map((session) => session.sessionId))
  const localBySessionId = new Map(snapshot.localStates.map((state) => [state.sessionId, state]))
  const remoteByThreadId = new Map(snapshot.remoteThreads.map((thread) => [thread.threadId, thread]))

  for (const state of snapshot.localStates) {
    if (!sessionIds.has(state.sessionId)) {
      deleteLocalThreadStates.push({
        kind: 'delete_local_thread_state',
        sessionId: state.sessionId,
        threadId: state.threadId,
        deleteMode: 'session',
        reason: 'local thread state points to a deleted session',
      })
    }
  }

  for (const session of snapshot.sessions) {
    const localState = localBySessionId.get(session.sessionId)
    const remoteThread = remoteByThreadId.get(session.sessionId)
    const transcriptCount = session.distillMessages.length

    if (!remoteThread && transcriptCount > 0) {
      createRemoteThreads.push({
        kind: 'create_remote_thread',
        sessionId: session.sessionId,
        threadId: session.sessionId,
        threadTitle: session.threadTitle,
        projectPath: session.projectPath,
        messages: session.distillMessages,
        reason: 'session has transcript but remote thread is missing',
      })
    }

    if (transcriptCount === 0 && !remoteThread) {
      if (localState) {
        deleteLocalThreadStates.push({
          kind: 'delete_local_thread_state',
          sessionId: localState.sessionId,
          threadId: localState.threadId,
          deleteMode: 'thread',
          reason: 'session has no replayable transcript and no remote thread',
        })
      }
      continue
    }

    const resolvedTitle = normalizeText(session.threadTitle)
      ?? normalizeText(remoteThread?.title)
      ?? normalizeText(localState?.threadTitle)
      ?? normalizeText(session.sessionTitle)

    const nextLastAppended = Math.max(
      transcriptCount,
      remoteThread?.messageCount ?? 0,
      localState?.lastAppendedMessageSeq ?? 0,
    )
    const nextLastDistilled = localState
      ? Math.min(localState.lastDistilledMessageSeq, nextLastAppended)
      : remoteThread
        ? nextLastAppended
        : 0

    const nextState: NowledgeThreadState = {
      sessionId: session.sessionId,
      threadId: session.sessionId,
      threadTitle: resolvedTitle,
      projectPath: normalizeText(session.projectPath),
      lastAppendedMessageSeq: nextLastAppended,
      lastDistilledMessageSeq: nextLastDistilled,
      lastDistilledAt: localState?.lastDistilledAt,
      lastTriageAt: localState?.lastTriageAt,
      lastTriageResultJson: localState?.lastTriageResultJson,
      lastError: localState?.lastError,
      updatedAt: Date.now(),
    }

    const needsUpsert = !localState
      || localState.threadId !== nextState.threadId
      || normalizeText(localState.threadTitle) !== nextState.threadTitle
      || normalizeText(localState.projectPath) !== nextState.projectPath
      || localState.lastAppendedMessageSeq !== nextState.lastAppendedMessageSeq
      || localState.lastDistilledMessageSeq !== nextState.lastDistilledMessageSeq

    if (needsUpsert) {
      upsertLocalThreadStates.push({
        kind: 'upsert_local_thread_state',
        state: nextState,
        reason: localState
          ? 'local thread state drifted from the canonical session thread mapping'
          : 'session is missing local thread state',
      })
    }
  }

  return {
    createRemoteThreads,
    upsertLocalThreadStates,
    deleteLocalThreadStates,
  }
}

export function simulateLocalThreadStatesAfterNormalization(
  snapshot: ReconcileSnapshot,
  plan: ThreadNormalizationPlan,
): NowledgeThreadState[] {
  const stateMap = new Map(snapshot.localStates.map((state) => [state.sessionId, state]))

  for (const action of plan.deleteLocalThreadStates) {
    stateMap.delete(action.sessionId)
  }

  for (const action of plan.upsertLocalThreadStates) {
    stateMap.set(action.state.sessionId, action.state)
  }

  return [...stateMap.values()]
}

export function planRemoteThreadDeletion(input: {
  sessions: ReconcileSessionRecord[]
  localStates: NowledgeThreadState[]
  remoteThreads: ReconcileRemoteThreadRecord[]
  cascadeDeleteMemories: boolean
}): RemoteThreadDeletionPlan {
  const sessionIds = new Set(input.sessions.map((session) => session.sessionId))
  const referencedThreadIds = new Set(input.localStates.map((state) => state.threadId))

  return {
    deleteRemoteThreads: input.remoteThreads
      .filter((thread) => !sessionIds.has(thread.threadId) && !referencedThreadIds.has(thread.threadId))
      .map((thread) => ({
        kind: 'delete_remote_thread',
        threadId: thread.threadId,
        cascadeDeleteMemories: input.cascadeDeleteMemories,
        reason: 'remote kila thread is not referenced by any live session or local thread state',
      })),
  }
}

function createNowledgeThreadClient(): NowledgeThreadClient {
  const config = getMemoryRuntimeConfig()
  if (!isNowledgeConfigured(config) || !config.nowledgeBaseUrl) {
    throw new Error('Nowledge 未配置，无法执行 thread reconcile。')
  }

  async function request(pathname: string, options: {
    method: 'GET' | 'POST' | 'DELETE'
    body?: Record<string, unknown>
  }): Promise<any> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), Math.max(config.nowledgeTimeoutMs, DEFAULT_TIMEOUT_MS))

    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      }
      if (config.nowledgeApiKey?.trim()) {
        headers.authorization = `Bearer ${config.nowledgeApiKey}`
        headers['x-nmem-api-key'] = config.nowledgeApiKey
      }

      const response = await fetch(new URL(pathname, config.nowledgeBaseUrl).toString(), {
        method: options.method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Nowledge request failed: ${response.status} ${text}`)
      }

      if (response.status === 204) return {}
      return await response.json()
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    async listThreads(input) {
      const params = new URLSearchParams({
        source: input.source,
        limit: String(input.limit),
        offset: String(input.offset),
      })
      const response = await request(`/threads?${params.toString()}`, { method: 'GET' })
      const rawThreads = Array.isArray(response.threads) ? response.threads : []
      const pagination = typeof response.pagination === 'object' && response.pagination
        ? response.pagination as Record<string, unknown>
        : {}
      return {
        threads: rawThreads
          .map((item: any) => ({
            threadId: String(item.id ?? item.thread_id ?? '').trim(),
            title: normalizeText(typeof item.title === 'string' ? item.title : undefined),
            source: normalizeText(typeof item.source === 'string' ? item.source : undefined),
            messageCount: Number(item.messages ?? item.message_count ?? 0),
          }))
          .filter((item: ReconcileRemoteThreadRecord) => item.threadId),
        hasMore: Boolean(pagination.has_more),
      }
    },
    async createThread(input) {
      try {
        await request('/threads', {
          method: 'POST',
          body: {
            thread_id: input.threadId,
            title: input.threadTitle,
            messages: input.messages,
            source: KILA_THREAD_SOURCE,
            project: input.projectPath,
            workspace: input.projectPath,
          },
        })
      } catch (error) {
        if (error instanceof Error && (error.message.includes('409') || error.message.toLowerCase().includes('already exists'))) {
          return
        }
        throw error
      }
    },
    async deleteThread(input) {
      const params = new URLSearchParams({
        cascade_delete_memories: input.cascadeDeleteMemories ? 'true' : 'false',
      })
      await request(`/threads/${encodeURIComponent(input.threadId)}?${params.toString()}`, {
        method: 'DELETE',
      })
    },
  }
}

async function collectSnapshot(pageSize: number): Promise<ReconcileSnapshot> {
  const client = createNowledgeThreadClient()
  const sessions = listSessions().map(buildSessionRecord)
  const localStates = memoryStateStore.listThreadStates()
  const remoteThreads: ReconcileRemoteThreadRecord[] = []

  let offset = 0
  while (true) {
    const page = await client.listThreads({
      source: KILA_THREAD_SOURCE,
      limit: pageSize,
      offset,
    })
    remoteThreads.push(...page.threads)
    if (!page.hasMore || page.threads.length === 0) break
    offset += page.threads.length
  }

  return {
    sessions,
    localStates,
    remoteThreads,
  }
}

async function applyNormalizationPlan(
  plan: ThreadNormalizationPlan,
  client: NowledgeThreadClient,
): Promise<AppliedActionResult[]> {
  const results: AppliedActionResult[] = []
  const failedCreateSessionIds = new Set<string>()
  const sessionsRequiringCreate = new Set(plan.createRemoteThreads.map((action) => action.sessionId))

  for (const action of plan.createRemoteThreads) {
    try {
      await client.createThread(action)
      results.push({
        kind: action.kind,
        target: action.threadId,
        status: 'applied',
        detail: action.reason,
      })
    } catch (error) {
      failedCreateSessionIds.add(action.sessionId)
      results.push({
        kind: action.kind,
        target: action.threadId,
        status: 'failed',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  for (const action of plan.upsertLocalThreadStates) {
    if (sessionsRequiringCreate.has(action.state.sessionId) && failedCreateSessionIds.has(action.state.sessionId)) {
      results.push({
        kind: action.kind,
        target: action.state.sessionId,
        status: 'skipped',
        detail: 'skipped because remote thread creation failed for this session',
      })
      continue
    }

    try {
      memoryStateStore.upsertThreadState(action.state)
      results.push({
        kind: action.kind,
        target: action.state.sessionId,
        status: 'applied',
        detail: action.reason,
      })
    } catch (error) {
      results.push({
        kind: action.kind,
        target: action.state.sessionId,
        status: 'failed',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  for (const action of plan.deleteLocalThreadStates) {
    try {
      if (action.deleteMode === 'session') {
        memoryStateStore.deleteSessionState(action.sessionId)
      } else {
        memoryStateStore.deleteThreadState(action.sessionId)
      }
      results.push({
        kind: action.kind,
        target: action.sessionId,
        status: 'applied',
        detail: action.reason,
      })
    } catch (error) {
      results.push({
        kind: action.kind,
        target: action.sessionId,
        status: 'failed',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return results
}

async function applyRemoteDeletionPlan(
  plan: RemoteThreadDeletionPlan,
  client: NowledgeThreadClient,
): Promise<AppliedActionResult[]> {
  const results: AppliedActionResult[] = []

  for (const action of plan.deleteRemoteThreads) {
    try {
      await client.deleteThread(action)
      results.push({
        kind: action.kind,
        target: action.threadId,
        status: 'applied',
        detail: action.reason,
      })
    } catch (error) {
      results.push({
        kind: action.kind,
        target: action.threadId,
        status: 'failed',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return results
}

export async function runMemoryThreadReconciliation(options: ReconcileThreadOptions = {}): Promise<ReconcileThreadReport> {
  const apply = options.apply === true
  const cascadeDeleteMemories = options.cascadeDeleteMemories !== false
  const pageSize = Math.min(Math.max(options.pageSize ?? DEFAULT_PAGE_SIZE, 1), 200)

  const client = createNowledgeThreadClient()
  const initialSnapshot = await collectSnapshot(pageSize)
  const normalizationPlan = planThreadNormalization(initialSnapshot)
  const projectedLocalStates = simulateLocalThreadStatesAfterNormalization(initialSnapshot, normalizationPlan)
  const projectedRemoteDeletionPlan = planRemoteThreadDeletion({
    sessions: initialSnapshot.sessions,
    localStates: projectedLocalStates,
    remoteThreads: initialSnapshot.remoteThreads,
    cascadeDeleteMemories,
  })

  if (!apply) {
    return {
      apply,
      cascadeDeleteMemories,
      initialSnapshot: summarizeSnapshot(initialSnapshot),
      normalizationPlan: {
        createRemoteThreads: normalizationPlan.createRemoteThreads.length,
        upsertLocalThreadStates: normalizationPlan.upsertLocalThreadStates.length,
        deleteLocalThreadStates: normalizationPlan.deleteLocalThreadStates.length,
      },
      remoteDeletionPlan: {
        deleteRemoteThreads: projectedRemoteDeletionPlan.deleteRemoteThreads.length,
      },
      normalizationResults: [],
      remoteDeletionResults: [],
    }
  }

  const normalizationResults = await applyNormalizationPlan(normalizationPlan, client)
  const refreshedSnapshot = await collectSnapshot(pageSize)
  const remoteDeletionPlan = planRemoteThreadDeletion({
    sessions: refreshedSnapshot.sessions,
    localStates: refreshedSnapshot.localStates,
    remoteThreads: refreshedSnapshot.remoteThreads,
    cascadeDeleteMemories,
  })
  const remoteDeletionResults = await applyRemoteDeletionPlan(remoteDeletionPlan, client)
  const finalSnapshot = await collectSnapshot(pageSize)

  return {
    apply,
    cascadeDeleteMemories,
    initialSnapshot: summarizeSnapshot(initialSnapshot),
    normalizationPlan: {
      createRemoteThreads: normalizationPlan.createRemoteThreads.length,
      upsertLocalThreadStates: normalizationPlan.upsertLocalThreadStates.length,
      deleteLocalThreadStates: normalizationPlan.deleteLocalThreadStates.length,
    },
    remoteDeletionPlan: {
      deleteRemoteThreads: remoteDeletionPlan.deleteRemoteThreads.length,
    },
    normalizationResults,
    remoteDeletionResults,
    finalSnapshot: summarizeSnapshot(finalSnapshot),
  }
}
