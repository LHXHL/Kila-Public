import type { AgentEvent, RuntimeConfigV1 } from '@kila/shared'
import type { PiAgentQueryOptions } from './agent-query-types'
import type { AnyAgentTool } from './agent-tool-names'

export interface RemoteRun {
  sessionId: string
  runId: string
  generation: number
  bootId: string
  query: PiAgentQueryOptions
  tools: Map<string, AnyAgentTool>
  abortController: AbortController
  queue: AgentEvent[]
  done: boolean
  notify?: () => void
  eventSequence: number
  toolUpdateSequences: Map<string, number>
  toolUpdateWaiters: Map<string, Map<number, ToolUpdateWaiter>>
  pendingToolUpdateBytes: Map<string, number>
  pendingToolStarts: Map<string, ToolStartEvent>
  approvedToolInputs: Map<string, Record<string, unknown>>
  settledReceived: boolean
  abortHandler: () => void
  bundlePath?: string
  unsubscribe: () => void
  unsubscribeExit: () => void
  persistedWaiter?: PersistedWaiter
}

export interface ToolUpdateWaiter {
  bytes: number
  resolve: () => void
  reject: (error: Error) => void
  promise: Promise<void>
  timer: ReturnType<typeof setTimeout>
}

export interface PersistedWaiter {
  resolve: () => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export type ToolStartEvent = Extract<AgentEvent, { type: 'tool_start' }>

export interface SessionRuntimeConfig extends RuntimeConfigV1 {
  apiKeyFingerprint: string
}
