export interface RuntimeCapacityOptions {
  maxRunning?: number
  maxSpawnConcurrency?: number
  maxHotIdle?: number
  hotIdleMs?: number
}

export interface RuntimeCapacityConfig {
  maxRunning: number
  maxSpawnConcurrency: number
  maxHotIdle: number
  hotIdleMs: number
}

export type RuntimeCapacityState = 'running' | 'hot-idle' | 'queued'

interface RuntimeSlot {
  sessionId: string
  state: Exclude<RuntimeCapacityState, 'queued'>
  lastUsedAt: number
}

export interface RuntimeCapacitySnapshot {
  running: string[]
  hotIdle: string[]
  queued: string[]
  spawning: number
}

const DEFAULT_CONFIG: RuntimeCapacityConfig = {
  maxRunning: 4,
  maxSpawnConcurrency: 2,
  maxHotIdle: 2,
  hotIdleMs: 300_000,
}

export function normalizeRuntimeCapacityOptions(options: RuntimeCapacityOptions = {}): RuntimeCapacityConfig {
  const maxRunning = clampInteger(options.maxRunning, 4, 1, 8)
  const maxSpawnConcurrency = clampInteger(options.maxSpawnConcurrency, 2, 1, 4)
  const maxHotIdle = clampInteger(options.maxHotIdle, 2, 0, 4)
  const hotIdleMs = clampInteger(options.hotIdleMs, 300_000, 30_000, 1_800_000)
  return { maxRunning, maxSpawnConcurrency, maxHotIdle, hotIdleMs }
}

export class RuntimeCapacityController {
  readonly config: RuntimeCapacityConfig
  private readonly slots = new Map<string, RuntimeSlot>()
  private readonly queue: string[] = []
  private readonly spawnQueue: string[] = []
  private spawning = 0

  constructor(options: RuntimeCapacityOptions = {}) {
    this.config = { ...DEFAULT_CONFIG, ...normalizeRuntimeCapacityOptions(options) }
  }

  requestRun(sessionId: string, now = Date.now()): 'running' | 'queued' {
    const existing = this.slots.get(sessionId)
    if (existing?.state === 'hot-idle') {
      // hot-idle 也必须服从已有 FIFO 队列；否则一个旧 Session 可以在
      // running 已满时重新占用 slot，导致实际运行数超过预算。
      this.promoteNext()
      if (this.runningCount() >= this.config.maxRunning) {
        if (!this.queue.includes(sessionId)) this.queue.push(sessionId)
        return 'queued'
      }
      existing.state = 'running'
      existing.lastUsedAt = now
      return 'running'
    }
    if (existing?.state === 'running') {
      existing.lastUsedAt = now
      return 'running'
    }
    // 先让已经等待的 Session 占用空出的 running slot，防止新请求插队。
    this.promoteNext()
    const promoted = this.slots.get(sessionId)
    if (promoted) {
      promoted.state = 'running'
      promoted.lastUsedAt = now
      return 'running'
    }
    if (this.queue.length > 0) {
      if (!this.queue.includes(sessionId)) this.queue.push(sessionId)
      return 'queued'
    }
    if (this.runningCount() < this.config.maxRunning) {
      this.slots.set(sessionId, { sessionId, state: 'running', lastUsedAt: now })
      return 'running'
    }
    if (!this.queue.includes(sessionId)) this.queue.push(sessionId)
    return 'queued'
  }

  beginSpawn(sessionId?: string): boolean {
    if (sessionId && !this.spawnQueue.includes(sessionId) && (this.spawning >= this.config.maxSpawnConcurrency || this.spawnQueue.length > 0)) {
      this.spawnQueue.push(sessionId)
    }
    if (this.spawning >= this.config.maxSpawnConcurrency) return false
    if (sessionId && this.spawnQueue.length > 0 && this.spawnQueue[0] !== sessionId) return false
    if (sessionId && this.spawnQueue[0] === sessionId) this.spawnQueue.shift()
    this.spawning += 1
    return true
  }

  finishSpawn(_sessionId?: string): void {
    this.spawning = Math.max(0, this.spawning - 1)
  }

  markHotIdle(sessionId: string, now = Date.now()): string[] {
    const slot = this.slots.get(sessionId)
    if (!slot) return []
    slot.state = 'hot-idle'
    slot.lastUsedAt = now
    const hotIdle = [...this.slots.values()]
      .filter((candidate) => candidate.state === 'hot-idle')
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt)
    const evicted = hotIdle
      .slice(0, Math.max(0, hotIdle.length - this.config.maxHotIdle))
      .map((candidate) => candidate.sessionId)
    for (const evictedSessionId of evicted) this.slots.delete(evictedSessionId)
    this.promoteNext()
    return evicted
  }

  markRunning(sessionId: string, now = Date.now()): boolean {
    const slot = this.slots.get(sessionId)
    if (!slot) return false
    slot.state = 'running'
    slot.lastUsedAt = now
    return true
  }

  release(sessionId: string): string | undefined {
    this.slots.delete(sessionId)
    const index = this.queue.indexOf(sessionId)
    if (index >= 0) this.queue.splice(index, 1)
    const spawnIndex = this.spawnQueue.indexOf(sessionId)
    if (spawnIndex >= 0) this.spawnQueue.splice(spawnIndex, 1)
    return this.promoteNext()
  }

  takeExpiredHotIdle(now = Date.now()): string[] {
    const expired = [...this.slots.values()]
      .filter((slot) => slot.state === 'hot-idle' && now - slot.lastUsedAt >= this.config.hotIdleMs)
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt)
      .map((slot) => slot.sessionId)
    for (const sessionId of expired) this.slots.delete(sessionId)
    this.promoteNext()
    return expired
  }

  takeLruHotIdle(count = 1, excludedSessionId?: string): string[] {
    const candidates = [...this.slots.values()]
      .filter((slot) => slot.state === 'hot-idle' && slot.sessionId !== excludedSessionId)
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt)
      .slice(0, Math.max(0, count))
      .map((slot) => slot.sessionId)
    for (const sessionId of candidates) this.slots.delete(sessionId)
    this.promoteNext()
    return candidates
  }

  snapshot(): RuntimeCapacitySnapshot {
    return {
      running: [...this.slots.values()].filter((slot) => slot.state === 'running').map((slot) => slot.sessionId),
      hotIdle: [...this.slots.values()].filter((slot) => slot.state === 'hot-idle').map((slot) => slot.sessionId),
      queued: [...this.queue],
      spawning: this.spawning,
    }
  }

  private runningCount(): number {
    return [...this.slots.values()].filter((slot) => slot.state === 'running').length
  }

  private promoteNext(): string | undefined {
    if (this.runningCount() >= this.config.maxRunning) return undefined
    const next = this.queue.shift()
    if (!next) return undefined
    this.slots.set(next, { sessionId: next, state: 'running', lastUsedAt: Date.now() })
    return next
  }
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}
