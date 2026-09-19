import type {
  RuntimeToolCallV1,
  RuntimeToolIdentityV1,
  RuntimeToolResultV1,
  RuntimeToolUpdateV1,
} from '@kila/shared'

export interface ToolRegistryExecutionInput extends RuntimeToolCallV1 {
  signal: AbortSignal
  onUpdate: (update: RuntimeToolUpdateV1) => Promise<void> | void
}

export interface ToolRegistryExecutor {
  execute: (input: ToolRegistryExecutionInput) => Promise<RuntimeToolResultV1>
}

export type ToolRegistryStatus = 'pending' | 'terminal'

interface ToolRegistryEntry {
  identity: RuntimeToolIdentityV1
  controller: AbortController
  status: ToolRegistryStatus
  promise: Promise<RuntimeToolResultV1>
  result?: RuntimeToolResultV1
}

export function buildToolRegistryKey(identity: RuntimeToolIdentityV1): string {
  return [
    identity.appBootId,
    identity.bootId,
    identity.sessionId,
    identity.generation,
    identity.runId,
    identity.toolId,
    identity.toolCallId,
  ].map((part) => String(part).replaceAll(':', '%3A')).join(':')
}

export class ToolRegistry {
  private readonly entries = new Map<string, ToolRegistryEntry>()

  execute(
    input: RuntimeToolCallV1 & {
      signal?: AbortSignal
      onUpdate?: (update: RuntimeToolUpdateV1) => Promise<void> | void
    },
    executor: ToolRegistryExecutor,
  ): Promise<RuntimeToolResultV1> {
    const key = buildToolRegistryKey(input)
    const existing = this.entries.get(key)
    if (existing) return existing.promise

    const controller = new AbortController()
    const abortRelay = (): void => controller.abort(input.signal?.reason)
    if (input.signal) {
      if (input.signal.aborted) abortRelay()
      else input.signal.addEventListener('abort', abortRelay, { once: true })
    }

    const entry: ToolRegistryEntry = {
      identity: input,
      controller,
      status: 'pending',
      promise: Promise.resolve({ text: '', isError: true }),
    }
    const promise = executor.execute({
      ...input,
      signal: controller.signal,
      onUpdate: input.onUpdate ?? (() => undefined),
    }).then((result) => {
      entry.status = 'terminal'
      entry.result = result
      return result
    }).finally(() => {
      input.signal?.removeEventListener('abort', abortRelay)
    })
    entry.promise = promise
    this.entries.set(key, entry)
    return promise
  }

  cancel(identity: RuntimeToolIdentityV1): boolean {
    const entry = this.entries.get(buildToolRegistryKey(identity))
    if (!entry || entry.status !== 'pending') return false
    entry.controller.abort()
    return true
  }

  get(identity: RuntimeToolIdentityV1): { status: ToolRegistryStatus; result?: RuntimeToolResultV1 } | undefined {
    const entry = this.entries.get(buildToolRegistryKey(identity))
    if (!entry) return undefined
    return { status: entry.status, result: entry.result }
  }

  clearRun(runId: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.identity.runId !== runId) continue
      if (entry.status === 'pending') entry.controller.abort()
      this.entries.delete(key)
    }
  }

  clearSession(sessionId: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.identity.sessionId !== sessionId) continue
      if (entry.status === 'pending') entry.controller.abort()
      this.entries.delete(key)
    }
  }
}

