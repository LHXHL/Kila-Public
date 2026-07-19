import { createLogger } from '../logger'
import { syncSessionThreadTail } from './thread-sync'
import { pendingMemoryWriteBuffer } from './pending-write-buffer'
import { memoryProviderManager } from './provider-manager'
import { memorySnapshotManager } from './snapshot'
import { memoryStateStore } from './state-store'

const log = createLogger('Memory Post Run')

interface MemorySourceMessage {
  role: string
  content: string
}

export interface PostRunMemoryFlushDeps {
  drainWrites: typeof pendingMemoryWriteBuffer.drain
  acknowledgeWrite: typeof pendingMemoryWriteBuffer.acknowledge
  failWrite: typeof pendingMemoryWriteBuffer.markFailed
  writeMemory: typeof memoryProviderManager.write
  appendRuntimeEvent: typeof memoryStateStore.appendRuntimeEvent
  rebuildSnapshot: typeof memorySnapshotManager.rebuild
  captureThread: typeof syncSessionThreadTail
}

const defaultDeps: PostRunMemoryFlushDeps = {
  drainWrites: pendingMemoryWriteBuffer.drain.bind(pendingMemoryWriteBuffer),
  acknowledgeWrite: pendingMemoryWriteBuffer.acknowledge.bind(pendingMemoryWriteBuffer),
  failWrite: pendingMemoryWriteBuffer.markFailed.bind(pendingMemoryWriteBuffer),
  writeMemory: memoryProviderManager.write.bind(memoryProviderManager),
  appendRuntimeEvent: memoryStateStore.appendRuntimeEvent.bind(memoryStateStore),
  rebuildSnapshot: memorySnapshotManager.rebuild.bind(memorySnapshotManager),
  captureThread: syncSessionThreadTail,
}

export interface MemoryFlushResult {
  status: 'written' | 'failed'
  writtenCount: number
  error?: string
}

const pendingFlushes = new Map<string, Promise<MemoryFlushResult>>()
const deletingSessions = new Set<string>()

export async function postRunMemoryFlush(input: {
  sessionId: string
  projectPath?: string
  messages: MemorySourceMessage[]
}, deps: PostRunMemoryFlushDeps = defaultDeps): Promise<MemoryFlushResult> {
  if (deletingSessions.has(input.sessionId)) return { status: 'written', writtenCount: 0 }

  const writes = deps.drainWrites(input.sessionId)
  let writtenCount = 0

  try {
    for (const entry of writes) {
      try {
        await deps.writeMemory(entry)
        deps.acknowledgeWrite(input.sessionId, entry.queueId)
        writtenCount += 1
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        deps.failWrite(input.sessionId, entry.queueId, detail)
        throw error
      }
    }

    // 会话线程归档是附加能力；失败不回滚已经写入当前长期记忆后端的条目。
    await deps.captureThread({
      sessionId: input.sessionId,
      projectPath: input.projectPath,
      messages: input.messages,
    }).catch((error) => {
      deps.appendRuntimeEvent({
        sessionId: input.sessionId,
        threadId: input.sessionId,
        eventType: 'nowledge_thread_sync_failed',
        status: 'warn',
        detail: error instanceof Error ? error.message : String(error),
      })
    })
    await deps.rebuildSnapshot({ sessionId: input.sessionId, projectPath: input.projectPath, messages: input.messages })
    return { status: 'written', writtenCount }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    deps.appendRuntimeEvent({
      sessionId: input.sessionId,
      threadId: input.sessionId,
      eventType: 'post_run_flush_failed',
      status: 'error',
      detail,
    })
    log.warn('[Memory Post Run] flush failed:', error)
    return { status: 'failed', writtenCount, error: detail }
  }
}

export function triggerPostRunMemoryFlush(input: {
  sessionId: string
  projectPath?: string
  messages: MemorySourceMessage[]
}, deps: PostRunMemoryFlushDeps = defaultDeps): Promise<MemoryFlushResult> {
  if (deletingSessions.has(input.sessionId)) return Promise.resolve({ status: 'written', writtenCount: 0 })

  // 同一会话可能在上一轮记忆刷写尚未结束时开始下一轮。串行化可避免
  // drain、snapshot rebuild 与删除等待只跟踪到最后一个 Promise 的竞态。
  const previous = pendingFlushes.get(input.sessionId)
  const task = (previous
    ? previous.then(() => postRunMemoryFlush(input))
    : postRunMemoryFlush(input)
  ).finally(() => {
    if (pendingFlushes.get(input.sessionId) === task) pendingFlushes.delete(input.sessionId)
  })
  pendingFlushes.set(input.sessionId, task)
  return task
}

export function markSessionMemoryDeleting(sessionId: string): void {
  deletingSessions.add(sessionId)
}

export async function waitForSessionPostRunMemoryFlush(sessionId: string): Promise<void> {
  const task = pendingFlushes.get(sessionId)
  if (!task) return
  await task
}
