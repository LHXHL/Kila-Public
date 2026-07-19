interface RateLimiterOptions {
  limit?: number
  windowMs?: number
  now?: () => number
}

export class BridgeRateLimiter {
  private readonly records = new Map<string, number[]>()
  private readonly limit: number
  private readonly windowMs: number
  private readonly now: () => number

  constructor(options?: RateLimiterOptions) {
    this.limit = options?.limit ?? 6
    this.windowMs = options?.windowMs ?? 30_000
    this.now = options?.now ?? (() => Date.now())
  }

  allow(key: string): boolean {
    const now = this.now()
    const values = (this.records.get(key) ?? []).filter((timestamp) => now - timestamp <= this.windowMs)
    if (values.length >= this.limit) {
      this.records.set(key, values)
      return false
    }

    values.push(now)
    this.records.set(key, values)
    return true
  }
}
