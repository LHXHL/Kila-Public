interface RateLimiterOptions {
  limit?: number
  windowMs?: number
  now?: () => number
  /** 触发惰性 GC 的调用间隔 */
  gcIntervalMs?: number
}

export class BridgeRateLimiter {
  private readonly records = new Map<string, number[]>()
  private readonly limit: number
  private readonly windowMs: number
  private readonly now: () => number
  private readonly gcIntervalMs: number
  private lastGcAt = 0

  constructor(options?: RateLimiterOptions) {
    this.limit = options?.limit ?? 6
    this.windowMs = options?.windowMs ?? 30_000
    this.now = options?.now ?? (() => Date.now())
    this.gcIntervalMs = options?.gcIntervalMs ?? 5 * 60_000
  }

  allow(key: string): boolean {
    const now = this.now()
    this.collectExpired(now)

    const values = (this.records.get(key) ?? []).filter((timestamp) => now - timestamp <= this.windowMs)
    if (values.length >= this.limit) {
      this.records.set(key, values)
      return false
    }

    values.push(now)
    this.records.set(key, values)
    return true
  }

  /** 惰性 GC：records 只增不删会随 endpointKey 数量无限增长 */
  private collectExpired(now: number): void {
    if ((now - this.lastGcAt) < this.gcIntervalMs) return
    this.lastGcAt = now

    for (const [key, timestamps] of this.records) {
      const alive = timestamps.filter((timestamp) => now - timestamp <= this.windowMs)
      if (alive.length === 0) {
        this.records.delete(key)
      } else if (alive.length !== timestamps.length) {
        this.records.set(key, alive)
      }
    }
  }

  /** 测试与诊断用：当前正在跟踪的 endpoint 数量 */
  get trackedKeyCount(): number {
    return this.records.size
  }
}
