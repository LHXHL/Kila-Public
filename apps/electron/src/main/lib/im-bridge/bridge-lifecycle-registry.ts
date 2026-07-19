import type { BridgeChannelStatus, BridgeChannelType, BridgeConfig, BridgeConnectionStatus } from '@kila/shared'
import type { BridgeAdapter } from './adapters/base-adapter'

export interface BridgeSecretState {
  telegram?: string
  discord?: string
  feishu?: string
}

export interface BridgeLifecycleHealth {
  channel: BridgeChannelType
  enabled: boolean
  configured: boolean
  healthy: boolean
  status: BridgeConnectionStatus
  lastConnectedAt?: number
  errorMessage?: string
}

interface RegistryEntry {
  channel: BridgeChannelType
  adapter: BridgeAdapter
  isConfigured: (config: BridgeConfig, secrets: BridgeSecretState) => boolean
  isEnabled: (config: BridgeConfig) => boolean
}

interface RetryState {
  attempt: number
  nextRetryAt?: number
  timer?: ReturnType<typeof setTimeout>
}

const RETRY_BASE_DELAY_MS = 5_000
const RETRY_MAX_DELAY_MS = 60_000
const RETRY_MAX_ATTEMPTS = 8

export class BridgeLifecycleRegistry {
  private readonly entries: RegistryEntry[] = []
  private readonly retries = new Map<BridgeChannelType, RetryState>()

  register(entry: RegistryEntry): void {
    this.entries.push(entry)
  }

  async startEnabled(config: BridgeConfig, secrets: BridgeSecretState): Promise<number> {
    const tasks: Promise<boolean>[] = []
    for (const entry of this.entries) {
      if (!entry.isEnabled(config) || !entry.isConfigured(config, secrets)) {
        this.clearRetry(entry.channel)
        continue
      }
      tasks.push(this.startEntry(entry, config, secrets))
    }
    await Promise.allSettled(tasks)
    return tasks.length
  }

  stopAll(): void {
    for (const entry of this.entries) {
      this.clearRetry(entry.channel)
    }
    for (const entry of this.entries) {
      entry.adapter.stop()
    }
  }

  handleStatusChanged(channel: BridgeChannelType, config: BridgeConfig, secrets: BridgeSecretState): void {
    const entry = this.entries.find((item) => item.channel === channel)
    if (!entry) return
    const status = entry.adapter.getStatus()
    if (status.status === 'connected') {
      this.clearRetry(channel)
      return
    }
    if (status.status !== 'error') return
    if (!entry.isEnabled(config) || !entry.isConfigured(config, secrets)) return
    this.scheduleRetry(entry, config, secrets)
  }

  getChannelStatuses(config: BridgeConfig): Record<BridgeChannelType, BridgeChannelStatus> {
    return Object.fromEntries(this.entries.map((entry) => {
      const status = entry.adapter.getStatus()
      const retry = this.retries.get(entry.channel)
      return [entry.channel, {
        channel: entry.channel,
        enabled: entry.isEnabled(config),
        status: status.status,
        connectedAt: status.connectedAt,
        lastConnectedAt: status.lastConnectedAt,
        errorMessage: status.errorMessage,
        retryAttempt: retry?.attempt,
        nextRetryAt: retry?.nextRetryAt,
      }]
    })) as Record<BridgeChannelType, BridgeChannelStatus>
  }

  getHealth(config: BridgeConfig, secrets: BridgeSecretState): BridgeLifecycleHealth[] {
    return this.entries.map((entry) => {
      const status = entry.adapter.getStatus()
      const enabled = entry.isEnabled(config)
      const configured = entry.isConfigured(config, secrets)
      const retry = this.retries.get(entry.channel)
      return {
        channel: entry.channel,
        enabled,
        configured,
        healthy: !enabled || (configured && status.status !== 'error'),
        status: status.status,
        lastConnectedAt: status.lastConnectedAt,
        errorMessage: status.errorMessage,
        retryAttempt: retry?.attempt,
        nextRetryAt: retry?.nextRetryAt,
      }
    })
  }

  private async startEntry(entry: RegistryEntry, config: BridgeConfig, secrets: BridgeSecretState): Promise<boolean> {
    try {
      await entry.adapter.start()
      this.clearRetry(entry.channel)
      return true
    } catch {
      this.scheduleRetry(entry, config, secrets)
      return false
    }
  }

  private scheduleRetry(entry: RegistryEntry, config: BridgeConfig, secrets: BridgeSecretState): void {
    const current = this.retries.get(entry.channel)
    if (current?.timer) return
    if ((current?.attempt ?? 0) >= RETRY_MAX_ATTEMPTS) return
    const nextAttempt = (current?.attempt ?? 0) + 1

    const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** (nextAttempt - 1), RETRY_MAX_DELAY_MS)
    const nextRetryAt = Date.now() + delay
    const timer = setTimeout(() => {
      const retry = this.retries.get(entry.channel)
      if (retry) {
        retry.timer = undefined
      }
      if (!entry.isEnabled(config) || !entry.isConfigured(config, secrets)) {
        this.clearRetry(entry.channel)
        return
      }
      void this.startEntry(entry, config, secrets)
    }, delay)
    if (typeof timer.unref === 'function') {
      timer.unref()
    }

    this.retries.set(entry.channel, {
      attempt: nextAttempt,
      nextRetryAt,
      timer,
    })
  }

  private clearRetry(channel: BridgeChannelType): void {
    const retry = this.retries.get(channel)
    if (retry?.timer) {
      clearTimeout(retry.timer)
    }
    this.retries.delete(channel)
  }
}
