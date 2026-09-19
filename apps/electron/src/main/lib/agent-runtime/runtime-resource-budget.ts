export interface RuntimeResourceBudgetOptions {
  sampleIntervalMs?: number
  softLimitBytes?: number
  hardLimitBytes?: number
}

export interface RuntimeResourceBudgetConfig {
  sampleIntervalMs: number
  softLimitBytes: number
  hardLimitBytes: number
}

export type RuntimeResourceState = 'running' | 'hot-idle'
export type RuntimeResourceAction = 'warn' | 'dispose-hot-idle' | 'abort-and-kill'

export interface RuntimeResourceSampleResult {
  sessionId: string
  rssBytes: number
  softLimitExceeded: boolean
  hardLimitExceeded: boolean
  softOverLimitSamples: number
  hardOverLimitSamples: number
  actions: RuntimeResourceAction[]
}

const MIB = 1024 * 1024

const DEFAULT_CONFIG: RuntimeResourceBudgetConfig = {
  sampleIntervalMs: 10_000,
  softLimitBytes: 512 * MIB,
  hardLimitBytes: 1024 * MIB,
}

export function normalizeRuntimeResourceBudgetOptions(
  options: RuntimeResourceBudgetOptions = {},
): RuntimeResourceBudgetConfig {
  const softLimitBytes = clampBytes(options.softLimitBytes, DEFAULT_CONFIG.softLimitBytes, 256 * MIB, 2048 * MIB)
  const hardLimitBytes = clampBytes(options.hardLimitBytes, DEFAULT_CONFIG.hardLimitBytes, 512 * MIB, 4096 * MIB)
  return {
    sampleIntervalMs: clampInteger(options.sampleIntervalMs, DEFAULT_CONFIG.sampleIntervalMs, 5_000, 60_000),
    softLimitBytes,
    hardLimitBytes: Math.max(softLimitBytes + 1, hardLimitBytes),
  }
}

interface RuntimeResourceRecord {
  state: RuntimeResourceState
  softOverLimitSamples: number
  hardOverLimitSamples: number
}

export class RuntimeResourceBudget {
  readonly config: RuntimeResourceBudgetConfig
  private readonly records = new Map<string, RuntimeResourceRecord>()

  constructor(options: RuntimeResourceBudgetOptions = {}) {
    this.config = normalizeRuntimeResourceBudgetOptions(options)
  }

  register(sessionId: string, state: RuntimeResourceState = 'running'): void {
    this.records.set(sessionId, { state, softOverLimitSamples: 0, hardOverLimitSamples: 0 })
  }

  setState(sessionId: string, state: RuntimeResourceState): boolean {
    const record = this.records.get(sessionId)
    if (!record) return false
    record.state = state
    return true
  }

  unregister(sessionId: string): void {
    this.records.delete(sessionId)
  }

  sample(sessionId: string, rssBytes: number): RuntimeResourceSampleResult {
    const record = this.records.get(sessionId) ?? {
      state: 'running' as const,
      softOverLimitSamples: 0,
      hardOverLimitSamples: 0,
    }
    this.records.set(sessionId, record)

    const safeRssBytes = Number.isFinite(rssBytes) && rssBytes >= 0 ? rssBytes : 0
    const softLimitExceeded = safeRssBytes > this.config.softLimitBytes
    const hardLimitExceeded = safeRssBytes > this.config.hardLimitBytes
    record.softOverLimitSamples = softLimitExceeded ? record.softOverLimitSamples + 1 : 0
    record.hardOverLimitSamples = hardLimitExceeded ? record.hardOverLimitSamples + 1 : 0

    const actions: RuntimeResourceAction[] = []
    if (hardLimitExceeded && record.hardOverLimitSamples >= 2) {
      actions.push('abort-and-kill')
    } else if (record.state === 'hot-idle' && softLimitExceeded) {
      actions.push('dispose-hot-idle')
    } else if (record.state === 'running' && softLimitExceeded && record.softOverLimitSamples >= 3) {
      actions.push('warn')
    }

    return {
      sessionId,
      rssBytes: safeRssBytes,
      softLimitExceeded,
      hardLimitExceeded,
      softOverLimitSamples: record.softOverLimitSamples,
      hardOverLimitSamples: record.hardOverLimitSamples,
      actions,
    }
  }
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function clampBytes(value: number | undefined, fallback: number, min: number, max: number): number {
  return clampInteger(value, fallback, min, max)
}
