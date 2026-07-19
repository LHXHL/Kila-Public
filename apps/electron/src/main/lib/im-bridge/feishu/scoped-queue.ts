/**
 * Per-scope 消息聚合队列
 *
 * 飞书群聊高频消息场景下，短时间内可能产生多条消息，逐条触发 Agent 运行会造成：
 * 1. 上下文碎片化 — Agent 无法看到完整语境
 * 2. 资源浪费 — 多次并发运行挤占有限槽位
 *
 * ScopedQueue 在 600ms 静默窗口内合并同 scope 消息，一次性投递。
 */

interface PendingEntry<T> {
  items: T[]
  timer: ReturnType<typeof setTimeout> | null
  resolve: ((items: T[]) => void) | null
}

export interface ScopedQueueOptions {
  /** 静默窗口时长（ms），默认 600 */
  quietWindowMs?: number
  /** 每次交付的最大条目数，超出则分批 */
  maxBatchSize?: number
}

export class ScopedQueue<T> {
  private readonly map = new Map<string, PendingEntry<T>>()
  private readonly blocked = new Set<string>()
  private readonly quietWindowMs: number
  private readonly maxBatchSize: number

  constructor(private readonly onFlush: (scope: string, items: T[]) => void, opts?: ScopedQueueOptions) {
    this.quietWindowMs = opts?.quietWindowMs ?? 600
    this.maxBatchSize = opts?.maxBatchSize ?? 20
  }

  /** 向 scope 推入一条 payload，重置静默计时器。
   *  被 block 时仍累积消息，但不启动 timer（等 unblock 后再 arm）。 */
  push(scope: string, payload: T): number {
    let entry = this.map.get(scope)
    if (!entry) {
      entry = { items: [], timer: null, resolve: null }
      this.map.set(scope, entry)
    }

    entry.items.push(payload)

    if (!this.blocked.has(scope)) {
      this.armTimer(scope, entry)
    }
    return entry.items.length
  }

  /** 取消 scope 的所有待处理条目，返回已累积的内容 */
  cancel(scope: string): T[] {
    const entry = this.map.get(scope)
    if (!entry) return []

    if (entry.timer) clearTimeout(entry.timer)
    this.map.delete(scope)
    this.blocked.delete(scope)
    return entry.items
  }

  /** 取消所有 scope */
  cancelAll(): void {
    for (const [, entry] of this.map) {
      if (entry.timer) clearTimeout(entry.timer)
    }
    this.map.clear()
    this.blocked.clear()
  }

  /** 阻止 scope — Agent 运行期间暂停计时 */
  block(scope: string): void {
    const entry = this.map.get(scope)
    if (entry?.timer) {
      clearTimeout(entry.timer)
      entry.timer = null
    }
    this.blocked.add(scope)
  }

  /** 解除阻塞 — Agent 运行结束后恢复计时 */
  unblock(scope: string): void {
    this.blocked.delete(scope)
    const entry = this.map.get(scope)
    if (entry && entry.items.length > 0) {
      this.armTimer(scope, entry)
    }
  }

  hasPending(scope: string): boolean {
    const entry = this.map.get(scope)
    return Boolean(entry && entry.items.length > 0)
  }

  private armTimer(scope: string, entry: PendingEntry<T>): void {
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      entry.timer = null
      const items = entry.items.splice(0, this.maxBatchSize)
      if (items.length > 0) {
        this.onFlush(scope, items)
      }
      if (entry.items.length > 0) {
        this.armTimer(scope, entry)
      } else {
        this.map.delete(scope)
      }
    }, this.quietWindowMs)
  }
}
