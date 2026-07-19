import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { getMemoryWriteJournalPath } from '../config-paths'
import type { MemoryWriteInput } from './types'

export interface QueuedMemoryWrite extends MemoryWriteInput {
  queueId: string
  sourceSessionId: string
}

interface WriteJournalEvent {
  event: 'queued' | 'applied' | 'failed' | 'discarded'
  queueId: string
  sessionId: string
  createdAt: number
  entry?: QueuedMemoryWrite
  error?: string
}

export class PendingWriteBuffer {
  private readonly writes = new Map<string, QueuedMemoryWrite[]>()
  private loaded = false

  constructor(private readonly journalPath = getMemoryWriteJournalPath()) {}

  append(sessionId: string, entry: Omit<QueuedMemoryWrite, 'queueId'> & { queueId?: string }): number {
    this.ensureLoaded()
    const queued: QueuedMemoryWrite = { ...entry, queueId: entry.queueId ?? randomUUID() }
    const current = this.writes.get(sessionId) ?? []
    current.push(queued)
    this.writes.set(sessionId, current)
    this.appendEvent({ event: 'queued', queueId: queued.queueId, sessionId, createdAt: Date.now(), entry: queued })
    return current.length
  }

  /** 返回当前待写项但不删除；只有逐项 ack 后才从队列移除。 */
  drain(sessionId: string): QueuedMemoryWrite[] {
    this.ensureLoaded()
    return [...(this.writes.get(sessionId) ?? [])]
  }

  acknowledge(sessionId: string, queueId: string): void {
    this.ensureLoaded()
    this.remove(sessionId, queueId)
    this.appendEvent({ event: 'applied', queueId, sessionId, createdAt: Date.now() })
  }

  markFailed(sessionId: string, queueId: string, error: string): void {
    this.ensureLoaded()
    this.appendEvent({ event: 'failed', queueId, sessionId, createdAt: Date.now(), error })
  }

  size(sessionId: string): number {
    this.ensureLoaded()
    return this.writes.get(sessionId)?.length ?? 0
  }

  list(sessionId?: string): QueuedMemoryWrite[] {
    this.ensureLoaded()
    if (sessionId) return [...(this.writes.get(sessionId) ?? [])]
    return Array.from(this.writes.values()).flatMap((entries) => entries)
  }

  clear(sessionId?: string): void {
    this.ensureLoaded()
    const targets = sessionId
      ? [[sessionId, this.writes.get(sessionId) ?? []] as const]
      : Array.from(this.writes.entries())
    for (const [targetSessionId, entries] of targets) {
      for (const entry of entries) {
        this.appendEvent({ event: 'discarded', queueId: entry.queueId, sessionId: targetSessionId, createdAt: Date.now() })
      }
      this.writes.delete(targetSessionId)
    }
  }

  private ensureLoaded(): void {
    if (this.loaded) return
    this.loaded = true
    const path = this.journalPath
    if (!existsSync(path)) return
    try {
      for (const line of readFileSync(path, 'utf-8').split('\n')) {
        if (!line.trim()) continue
        const event = JSON.parse(line) as WriteJournalEvent
        if (event.event === 'queued' && event.entry) {
          const current = this.writes.get(event.sessionId) ?? []
          if (!current.some((entry) => entry.queueId === event.queueId)) current.push(event.entry)
          this.writes.set(event.sessionId, current)
        } else if (event.event === 'applied' || event.event === 'discarded') {
          this.remove(event.sessionId, event.queueId)
        }
      }
    } catch {
      // 日志尾部损坏时保留此前成功解析的队列，主流程继续可用。
    }
  }

  private remove(sessionId: string, queueId: string): void {
    const current = this.writes.get(sessionId) ?? []
    const next = current.filter((entry) => entry.queueId !== queueId)
    if (next.length > 0) this.writes.set(sessionId, next)
    else this.writes.delete(sessionId)
  }

  private appendEvent(event: WriteJournalEvent): void {
    appendFileSync(this.journalPath, `${JSON.stringify(event)}\n`, 'utf-8')
  }
}

export const pendingMemoryWriteBuffer = new PendingWriteBuffer()
