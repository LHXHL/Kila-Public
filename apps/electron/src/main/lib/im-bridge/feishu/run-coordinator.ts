/**
 * Per-scope 串行执行 + 全局并发限制
 *
 * 保证同一个飞书群（scope）同一时间只有一个 Agent 运行，
 * 同时限制全局最大并发数，防止资源耗尽。
 */

interface ActiveRunHandle {
  sessionId: string
  abortController: AbortController
}

export class RunCoordinator {
  private readonly active = new Map<string, ActiveRunHandle>()
  private readonly waiters: Array<{ scope: string; sessionId: string; resolve: (release: () => void) => void }> = []

  constructor(private readonly maxConcurrent: number | (() => number) = 5) {
    this.maxConcurrent = typeof maxConcurrent === 'function' ? maxConcurrent : () => maxConcurrent
  }

  /** 获取 scope 的执行权。若已达上限则排队等待 */
  async acquire(scope: string, sessionId: string, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      throw new Error('已取消')
    }

    // 同 scope 内旧运行已存在 → 终止旧运行
    const existing = this.active.get(scope)
    if (existing) {
      existing.abortController.abort()
      this.active.delete(scope)
    }

    // 全局并发已满 → 排队
    const maxConcurrent = typeof this.maxConcurrent === 'function' ? this.maxConcurrent() : this.maxConcurrent
    if (this.active.size >= maxConcurrent) {
      return new Promise<() => void>((resolve) => {
        this.waiters.push({ scope, sessionId, resolve })
      })
    }

    return this.createSlot(scope, sessionId)
  }

  /** 强制终止 scope 的运行 */
  abort(scope: string): boolean {
    const handle = this.active.get(scope)
    if (!handle) return false
    handle.abortController.abort()
    this.active.delete(scope)
    this.drainWaiters()
    return true
  }

  /** 终止所有运行 */
  abortAll(): void {
    for (const [, handle] of this.active) {
      handle.abortController.abort()
    }
    this.active.clear()
    for (const waiter of this.waiters) {
      waiter.resolve(() => {})
    }
    this.waiters.length = 0
  }

  isActive(scope: string): boolean {
    return this.active.has(scope)
  }

  get size(): number {
    return this.active.size
  }

  private createSlot(scope: string, sessionId: string): () => void {
    const ac = new AbortController()
    this.active.set(scope, { sessionId, abortController: ac })
    let released = false
    return () => {
      if (released) return
      released = true
      this.active.delete(scope)
      this.drainWaiters()
    }
  }

  private drainWaiters(): void {
    const maxConcurrent = typeof this.maxConcurrent === 'function' ? this.maxConcurrent() : this.maxConcurrent
    while (this.waiters.length > 0 && this.active.size < maxConcurrent) {
      const waiter = this.waiters.shift()!
      const release = this.createSlot(waiter.scope, waiter.sessionId)
      waiter.resolve(release)
    }
  }
}
