/**
 * Pi 单次运行守卫。
 *
 * Pi 负责 Agent loop；Kila 负责产品级运行边界。守卫必须保持 per-query 状态，
 * 不能附着到可复用的 Pi AgentSession，避免上一轮预算/计数泄漏到下一轮。
 */

import type { AgentRunLimitKind, AgentRunLimits, AgentRuntimeLimitReached } from '@kila/shared'
import type { AssistantMessage } from '@earendil-works/pi-ai'

export interface PiRuntimeGuardOptions {
  limits?: AgentRunLimits
  onLimitReached: (limit: AgentRuntimeLimitReached) => void
}

export class PiRuntimeGuard {
  private readonly limits: NormalizedRunLimits
  private readonly onLimitReached: PiRuntimeGuardOptions['onLimitReached']
  private timer: ReturnType<typeof setTimeout> | undefined
  private turnCount = 0
  private toolCallCount = 0
  private costUsd = 0
  private reached: AgentRuntimeLimitReached | undefined

  constructor(options: PiRuntimeGuardOptions) {
    this.limits = normalizeRunLimits(options.limits)
    this.onLimitReached = options.onLimitReached
  }

  start(): void {
    if (!this.limits.maxDurationMs) return
    this.timer = setTimeout(() => {
      this.reach('max_duration_ms', this.limits.maxDurationMs!, this.limits.maxDurationMs!)
    }, this.limits.maxDurationMs)
  }

  dispose(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  get limitReached(): AgentRuntimeLimitReached | undefined {
    return this.reached
  }

  /** 第一个 turn 允许执行；达到上限后阻止下一个 Pi turn。 */
  onTurnStart(): boolean {
    if (this.reached) return false
    const maxTurns = this.limits.maxTurns
    if (maxTurns !== undefined && this.turnCount >= maxTurns) {
      this.reach('max_turns', maxTurns, this.turnCount)
      return false
    }
    this.turnCount += 1
    return true
  }

  /** 工具调用在真正执行前计数，保证 maxToolCalls 不会被并发/重试穿透。 */
  beforeToolCall(): boolean {
    if (this.reached) return false
    const maxToolCalls = this.limits.maxToolCalls
    if (maxToolCalls !== undefined && this.toolCallCount >= maxToolCalls) {
      this.reach('max_tool_calls', maxToolCalls, this.toolCallCount)
      return false
    }
    this.toolCallCount += 1
    return true
  }

  /** Pi assistant usage 中的 cost.total 是单条消息成本，运行内累计后用于预算判定。 */
  onAssistantMessage(message: AssistantMessage): boolean {
    if (this.reached) return false
    const cost = message.usage?.cost?.total
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) return true

    this.costUsd += cost
    const maxBudgetUsd = this.limits.maxBudgetUsd
    if (maxBudgetUsd !== undefined && this.costUsd >= maxBudgetUsd) {
      this.reach('max_budget_usd', maxBudgetUsd, this.costUsd)
      return false
    }
    return true
  }

  private reach(
    kind: AgentRunLimitKind,
    limit: number,
    observed: number,
  ): AgentRuntimeLimitReached {
    if (this.reached) return this.reached

    const reached: AgentRuntimeLimitReached = {
      kind,
      limit,
      observed,
      message: formatLimitMessage(kind, limit, observed),
    }
    this.reached = reached
    this.onLimitReached(reached)
    return reached
  }
}

interface NormalizedRunLimits {
  maxTurns?: number
  maxToolCalls?: number
  maxDurationMs?: number
  maxBudgetUsd?: number
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return Math.floor(value)
}

function normalizePositiveNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

export function normalizeRunLimits(limits?: AgentRunLimits): NormalizedRunLimits {
  return {
    maxTurns: normalizePositiveInteger(limits?.maxTurns),
    maxToolCalls: normalizePositiveInteger(limits?.maxToolCalls),
    maxDurationMs: normalizePositiveInteger(limits?.maxDurationMs),
    maxBudgetUsd: normalizePositiveNumber(limits?.maxBudgetUsd),
  }
}

function formatLimitMessage(kind: AgentRunLimitKind, limit: number, observed: number): string {
  switch (kind) {
    case 'max_turns':
      return `已达到本次运行最大轮次（${observed}/${limit}），已停止继续执行。`
    case 'max_tool_calls':
      return `已达到本次运行最大工具调用次数（${observed}/${limit}），已停止继续执行。`
    case 'max_duration_ms':
      return `已达到本次运行最长时长（${Math.round(observed / 1000)} 秒），已停止继续执行。`
    case 'max_budget_usd':
      return `已达到本次运行成本上限（$${observed.toFixed(4)} / $${limit.toFixed(4)}），已停止继续执行。`
  }
}
