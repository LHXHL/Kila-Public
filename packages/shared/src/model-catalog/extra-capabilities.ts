/**
 * 扩展能力 schema —— 移植自 ThinkInAIXYZ/PublicProviderConf
 *
 * 与 legacy `ModelAbilities`（boolean 维度）并存，承载细粒度推理控制：
 * - mode: budget / effort / level / fixed / mixed
 * - effort / verbosity / level 多种触发方式
 * - visibility / continuation / interleaved / summaries 等运行时控制
 *
 * 设计原则（来自上游）：
 * - 同一模型在不同 provider 上尽量保持一致的 reasoning 画像
 * - 默认值可以是客户端友好的起点，不必与上游 provider 原生默认对齐
 * - 未被画像注册表覆盖的模型，`extra_capabilities.reasoning` 省略
 */

/** 推理控制模式 */
export type ReasoningMode = 'budget' | 'effort' | 'level' | 'fixed' | 'mixed'

/**
 * 推理内容可见性（跨 provider 归一化）
 * - hidden: 通用不暴露
 * - summary: 暴露摘要
 * - full: 完整暴露
 * - mixed: 多模式混合
 * - omitted: Anthropic 特有的 omitted thinking display
 * - summarized: 部分上游使用的同义标签
 */
export type ReasoningVisibility =
  | 'hidden'
  | 'summary'
  | 'full'
  | 'mixed'
  | 'omitted'
  | 'summarized'

/** token-budget 风格的推理控制 */
export interface ReasoningBudget {
  min?: number
  max?: number
  default?: number
  auto?: number
  off?: number
  unit?: 'tokens'
}

/** 细粒度推理画像 */
export interface ExtraCapabilitiesReasoning {
  /** 是否支持推理 */
  supported?: boolean
  /** 客户端默认是否应开启推理 */
  default_enabled?: boolean
  /** 推理控制模式 */
  mode?: ReasoningMode
  /** token-budget 配置（mode=budget/mixed 时使用） */
  budget?: ReasoningBudget
  /** 默认 effort（mode=effort/mixed 时使用） */
  effort?: string
  /** 支持的 effort 选项 */
  effort_options?: string[]
  /** 默认 verbosity */
  verbosity?: string
  /** 支持的 verbosity 选项 */
  verbosity_options?: string[]
  /** 默认 level（mode=level 时使用，例如 Gemini 3 的 'low'/'high'） */
  level?: string
  /** 支持的 level 选项 */
  level_options?: string[]
  /** 是否支持交错推理 */
  interleaved?: boolean
  /** 是否暴露推理摘要 */
  summaries?: boolean
  /** 推理内容可见性 */
  visibility?: ReasoningVisibility
  /** 推理延续机制：thinking_blocks / thought_signatures 等 */
  continuation?: string[]
  /** 实现层面的提示（例如 Anthropic adaptive 强制要求） */
  notes?: string[]
  [key: string]: unknown
}

/** 模型扩展能力集合，未来可扩展非 reasoning 维度 */
export interface ExtraCapabilities {
  reasoning?: ExtraCapabilitiesReasoning
  [key: string]: unknown
}

/** 合法的 reasoning effort 取值（用于 sanitize 白名单） */
export const REASONING_EFFORT_VALUES = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

/** 合法的 verbosity 取值 */
export const REASONING_VERBOSITY_VALUES = ['low', 'medium', 'high'] as const

/** 合法的 reasoning mode 取值 */
export const REASONING_MODE_VALUES: readonly ReasoningMode[] = [
  'budget',
  'effort',
  'level',
  'fixed',
  'mixed',
]

/** 合法的 visibility 取值 */
export const REASONING_VISIBILITY_VALUES: readonly ReasoningVisibility[] = [
  'hidden',
  'summary',
  'full',
  'mixed',
  'omitted',
  'summarized',
]

/** 深拷贝 reasoning 画像，避免共享内部数组引用 */
export function cloneReasoningPortrait(
  portrait?: ExtraCapabilitiesReasoning,
): ExtraCapabilitiesReasoning | undefined {
  if (!portrait) return undefined
  return {
    ...portrait,
    budget: portrait.budget ? { ...portrait.budget } : undefined,
    effort_options: portrait.effort_options ? [...portrait.effort_options] : undefined,
    verbosity_options: portrait.verbosity_options ? [...portrait.verbosity_options] : undefined,
    level_options: portrait.level_options ? [...portrait.level_options] : undefined,
    continuation: portrait.continuation ? [...portrait.continuation] : undefined,
    notes: portrait.notes ? [...portrait.notes] : undefined,
  }
}

/** 深拷贝 ExtraCapabilities */
export function cloneExtraCapabilities(
  extra?: ExtraCapabilities,
): ExtraCapabilities | undefined {
  if (!extra) return undefined
  const cloned: ExtraCapabilities = { ...extra }
  if (extra.reasoning) {
    cloned.reasoning = cloneReasoningPortrait(extra.reasoning)
  }
  return cloned
}
