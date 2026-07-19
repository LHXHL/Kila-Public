import type { AgentEffort, ThinkingConfig, ThinkingLevel } from '../types/agent'

interface ResolveThinkingLevelInput {
  thinkingLevel?: ThinkingLevel
  thinkingEnabled?: boolean
  thinking?: ThinkingConfig
  effort?: AgentEffort
}

const THINKING_BUDGET_TOKENS: Record<Exclude<ThinkingLevel, 'none'>, number> = {
  low: 4096,
  medium: 16384,
  high: 32768,
  xhigh: 65536,
}

/**
 * 将新旧思考配置统一收口到单一的 ThinkingLevel。
 */
export function resolveThinkingLevel(input: ResolveThinkingLevelInput = {}): ThinkingLevel {
  const { thinkingLevel, thinkingEnabled, thinking, effort } = input

  if (thinkingLevel) return thinkingLevel
  if (thinking?.type === 'disabled') return 'none'

  if (effort === 'low') return 'low'
  if (effort === 'medium') return 'medium'
  if (effort === 'high') return 'high'
  if (effort === 'max') return 'xhigh'

  if (thinking?.type === 'adaptive' || thinking?.type === 'enabled' || thinkingEnabled) {
    return 'medium'
  }

  return 'none'
}

/**
 * 将统一 ThinkingLevel 映射回旧 Agent 配置，兼容历史设置和 Pi 适配器。
 */
export function thinkingLevelToLegacyAgentSettings(
  level: ThinkingLevel,
): { thinking: ThinkingConfig; effort: AgentEffort | undefined } {
  if (level === 'none') {
    return {
      thinking: { type: 'disabled' },
      effort: undefined,
    }
  }

  if (level === 'xhigh') {
    return {
      thinking: { type: 'adaptive' },
      effort: 'max',
    }
  }

  return {
    thinking: { type: 'adaptive' },
    effort: level,
  }
}

export function getThinkingBudgetTokens(level: ThinkingLevel): number | undefined {
  if (level === 'none') return undefined
  return THINKING_BUDGET_TOKENS[level]
}

export function isThinkingLevelEnabled(level: ThinkingLevel): boolean {
  return level !== 'none'
}

// ===== 高级推理配置解析（基于 extra_capabilities.reasoning 画像） =====

import type {
  ExtraCapabilitiesReasoning,
  ReasoningMode,
  ReasoningVisibility,
} from '../model-catalog/extra-capabilities'

/**
 * 合并"用户偏好（ThinkingLevel）"与"模型能力画像（extra_capabilities.reasoning）"
 * 后的实际推理参数，供各 Provider adapter 消费。
 *
 * 优先级：用户 ThinkingLevel 显式覆盖 > 画像默认值。
 * - level='none' 时强制 disable（即使画像 default_enabled=true）
 * - level='low'/'medium'/'high'/'xhigh' 时映射到 effort_options，画像不支持则降级到 budget
 */
export interface ResolvedThinkingConfig {
  /** 是否启用推理 */
  enabled: boolean
  /** API 下发的 mode */
  mode?: ReasoningMode
  /** API 下发的 effort（mode=effort/mixed） */
  effort?: string
  /** API 下发的 budget tokens（mode=budget/mixed） */
  budget?: number
  /** API 下发的 level（mode=level，例如 Gemini 3） */
  level?: string
  /** 推理内容可见性 */
  visibility?: ReasoningVisibility
  /** 是否交错推理 */
  interleaved?: boolean
  /** 是否暴露推理摘要 */
  summaries?: boolean
}

/** 把 ThinkingLevel 映射到画像的 effort_options，找不到时降级 */
function matchEffortOption(
  level: Exclude<ThinkingLevel, 'none'>,
  options?: string[],
): string | undefined {
  if (!options || options.length === 0) return undefined
  // 直接匹配
  if (options.includes(level)) return level
  // xhigh → max（Kila 内部档位与上游命名的兜底映射）
  if (level === 'xhigh') {
    if (options.includes('max')) return 'max'
    if (options.includes('xhigh')) return 'xhigh'
  }
  // 取最接近的：low < medium < high < xhigh < max
  const order = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  const targetIdx = order.indexOf(level)
  for (let i = targetIdx; i >= 0; i--) {
    if (options.includes(order[i]!)) return order[i]
  }
  return options[0]
}

export function resolveThinkingConfig(
  level: ThinkingLevel,
  portrait?: ExtraCapabilitiesReasoning,
): ResolvedThinkingConfig {
  // 无画像 → 老逻辑（budget 表）
  if (!portrait) {
    if (level === 'none') return { enabled: false }
    return {
      enabled: true,
      mode: 'budget',
      budget: THINKING_BUDGET_TOKENS[level],
    }
  }

  // 有画像但显式关闭
  if (level === 'none' || portrait.supported === false) {
    return { enabled: false }
  }

  const mode = portrait.mode ?? 'budget'
  const result: ResolvedThinkingConfig = {
    enabled: true,
    mode,
    visibility: portrait.visibility,
    interleaved: portrait.interleaved,
    summaries: portrait.summaries,
  }

  if (mode === 'effort' || mode === 'mixed') {
    const effort = matchEffortOption(level, portrait.effort_options) ?? portrait.effort ?? level
    result.effort = effort
  }

  if (mode === 'budget' || mode === 'mixed') {
    // 优先用用户档位 token 数，其次画像默认 budget
    const fromLevel = THINKING_BUDGET_TOKENS[level]
    const fromPortrait = portrait.budget?.default
    result.budget = fromLevel ?? fromPortrait
    if (portrait.budget?.max !== undefined && result.budget && result.budget > portrait.budget.max) {
      result.budget = portrait.budget.max
    }
    if (portrait.budget?.min !== undefined && result.budget && result.budget < portrait.budget.min) {
      result.budget = portrait.budget.min
    }
  }

  if (mode === 'level') {
    result.level = matchEffortOption(level, portrait.level_options) ?? portrait.level
  }

  return result
}
