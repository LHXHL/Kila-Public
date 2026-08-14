/**
 * 上下文压缩：参数推导与压缩语义纯函数
 *
 * Pi（`@earendil-works/pi-coding-agent`）的 compaction 设置是三个**绝对 token 数**：
 * `reserveTokens` / `keepRecentTokens` / `enabled`。而 Kila 支持的模型窗口跨度是 8K ~ 1M+，
 * 直接沿用 Pi 的 `DEFAULT_COMPACTION_SETTINGS`（16384 / 20000）会出现两个硬故障：
 *
 * 1. 窗口 ≤ reserveTokens 时可用预算 `window - reserve ≤ 0`，`shouldCompact()` 对空对话
 *    也返回 true —— 小窗口模型每轮都白跑一次摘要 LLM 调用，压完仍超预算。
 * 2. 窗口 < reserve + keepRecent 时，压缩后必然仍超预算，压缩没有任何收益。
 *
 * 另外 Pi 的 `estimateTokens()` 是纯 `chars / 4`，不区分语种。中文实际约 1 token/字，
 * 被低估约 4 倍：`findCutPoint()` 按 keepRecentTokens 往回累积时，中文会话「保留 20000 估算
 * token」实际保留约 80000 真实 token。SDK 内部估算改不了，只能通过下调 keepRecentTokens 补偿。
 *
 * 本模块全部是纯函数（`waitForCompactionToSettle` 除外，它只依赖结构化接口 + 计时器），
 * 便于单测覆盖各档窗口与各种语言特征。
 */

import type { Usage } from '@earendil-works/pi-ai'
import type { AgentEventUsage } from '@kila/shared'

// ============================================================================
// 上下文窗口
// ============================================================================

/**
 * 模型窗口非法（非正数）时的兜底值，供 deriveCompactionSettings 的 invalid-window 递归兜底使用。
 *
 * 注意：正常的「未知模型」窗口已由 shared 层 `inferContextWindow` 统一给 200K（单一数据源），
 * 这里不再承担「未知模型默认窗口」职责，只在窗口数值非法时兜底。
 */
export const FALLBACK_CONTEXT_WINDOW_TOKENS = 32768

// ============================================================================
// 压缩参数推导
// ============================================================================

/** Pi SettingsManager 的 compaction 段（与 pi-coding-agent 的 CompactionSettings 同构）。 */
export interface PiCompactionSettings {
  enabled: boolean
  reserveTokens: number
  keepRecentTokens: number
}

export type CompactionDisabledReason = 'window-too-small' | 'invalid-window'

export interface DerivedCompactionSettings extends PiCompactionSettings {
  /** 归一化后参与推导的窗口。 */
  contextWindowTokens: number
  /** CJK 补偿系数；1 表示纯拉丁文本无需下调。 */
  cjkKeepRecentScale: number
  /** 自动压缩被关闭的原因；`enabled` 为 true 时为 undefined。 */
  disabledReason?: CompactionDisabledReason
}

export interface DeriveCompactionSettingsInput {
  /** 模型有效上下文窗口（应先经 resolveEffectiveContextWindow 兜底）。 */
  contextWindowTokens: number
  /** 会话 CJK 字符占比 [0, 1]；省略按纯拉丁处理。 */
  cjkRatio?: number
}

/**
 * 低于此窗口关闭自动压缩。
 *
 * 注意：Pi 的 `_checkCompaction()` 在 `!settings.enabled` 时直接返回 false，
 * 这会**连 overflow 恢复一起关掉**（threshold 与 overflow 共用同一个开关）。
 * 这里仍然选择关闭，是因为窗口低于 8K 时 reserve 下限（2048）+ 摘要输出本身就吃掉
 * 近半预算，压缩后依然超预算 —— 每轮触发只是白烧一次摘要调用。手动 `/compact`
 * 不受影响：Pi 的 `compact()` 不检查 `enabled`。
 */
export const MIN_AUTO_COMPACTION_WINDOW_TOKENS = 8192

/** reserveTokens 同时是摘要输出预算（Pi 取 `0.8 * reserveTokens` 作为 maxTokens）。 */
const RESERVE_RATIO = 0.12
const RESERVE_MIN_TOKENS = 2048
const RESERVE_MAX_TOKENS = 16384

const KEEP_RECENT_RATIO = 0.25
const KEEP_RECENT_MIN_TOKENS = 2000
const KEEP_RECENT_MAX_TOKENS = 20000

/**
 * `reserve + keepRecent` 占窗口的硬上限。
 *
 * 剩下的 40% 才是压缩真正能回收的收益空间；超过上限就等比缩小，
 * 保证任何窗口下都满足 `reserve + keepRecent < window`。
 */
const MAX_BUDGET_RATIO = 0.6

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * CJK 占比 → keepRecentTokens 缩放系数。
 *
 * Pi 用 `chars / 4` 估算，即 0.25 token/字符；中文实际约 1 token/字。
 * 于是低估倍数 ≈ `(r * 1 + (1 - r) * 0.25) / 0.25 = 1 + 3r`，补偿系数取其倒数。
 * 下限 0.3：再低会把最近上下文砍得过短，反而伤对话连续性。
 */
export function cjkKeepRecentScale(cjkRatio: number | undefined): number {
  if (typeof cjkRatio !== 'number' || !Number.isFinite(cjkRatio) || cjkRatio <= 0) return 1
  const ratio = clamp(cjkRatio, 0, 1)
  return clamp(1 / (1 + 3 * ratio), 0.3, 1)
}

/**
 * 按模型窗口比例推导 Pi compaction 参数，并按会话语言特征补偿 CJK 低估。
 */
export function deriveCompactionSettings(
  input: DeriveCompactionSettingsInput,
): DerivedCompactionSettings {
  const rawWindow = Math.floor(input.contextWindowTokens)
  const cjkScale = cjkKeepRecentScale(input.cjkRatio)

  if (!Number.isFinite(rawWindow) || rawWindow <= 0) {
    // 窗口非法说明调用方没有先做兜底；退回保守窗口并关闭自动压缩，绝不按 0 预算狂压。
    const fallback = deriveCompactionSettings({
      contextWindowTokens: FALLBACK_CONTEXT_WINDOW_TOKENS,
      cjkRatio: input.cjkRatio,
    })
    return { ...fallback, enabled: false, disabledReason: 'invalid-window' }
  }

  const reserveBase = clamp(Math.round(rawWindow * RESERVE_RATIO), RESERVE_MIN_TOKENS, RESERVE_MAX_TOKENS)
  const keepRecentBase = clamp(
    Math.round(rawWindow * KEEP_RECENT_RATIO),
    KEEP_RECENT_MIN_TOKENS,
    KEEP_RECENT_MAX_TOKENS,
  )

  let reserveTokens = reserveBase
  let keepRecentTokens = Math.max(1, Math.round(keepRecentBase * cjkScale))

  // 硬不变量：预算必须显著小于窗口，否则「压缩后仍超预算」会退化成无限压缩循环。
  const budgetCeiling = Math.max(2, Math.floor(rawWindow * MAX_BUDGET_RATIO))
  const budget = reserveTokens + keepRecentTokens
  if (budget > budgetCeiling) {
    const shrink = budgetCeiling / budget
    reserveTokens = Math.max(1, Math.floor(reserveTokens * shrink))
    keepRecentTokens = Math.max(1, Math.floor(keepRecentTokens * shrink))
  }

  const tooSmall = rawWindow < MIN_AUTO_COMPACTION_WINDOW_TOKENS
  return {
    enabled: !tooSmall,
    reserveTokens,
    keepRecentTokens,
    contextWindowTokens: rawWindow,
    cjkKeepRecentScale: cjkScale,
    disabledReason: tooSmall ? 'window-too-small' : undefined,
  }
}

/** 剥掉诊断字段，得到可直接喂给 `SettingsManager.inMemory` / `applyOverrides` 的配置。 */
export function toPiCompactionSettings(derived: DerivedCompactionSettings): PiCompactionSettings {
  return {
    enabled: derived.enabled,
    reserveTokens: derived.reserveTokens,
    keepRecentTokens: derived.keepRecentTokens,
  }
}

// ============================================================================
// 会话语言特征
// ============================================================================

/**
 * CJK 字符范围：中日韩统一表意文字（含扩展 A）、兼容表意文字、日文假名、韩文音节。
 * 不含全角标点 —— 标点在中英文本里都很常见，计入会高估占比。
 */
const CJK_CHAR_PATTERN = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF66-\uFF9F\uAC00-\uD7AF]/

/** 采样上限，避免超长历史把语言特征估算变成 O(全量历史)。 */
const CJK_SAMPLE_MAX_CHARS = 20000

/**
 * 估算文本样本里的 CJK 字符占比（分母只算非空白字符）。
 *
 * 调用方从 prompt + 最近若干条历史消息里取样即可；结果直接喂给
 * `deriveCompactionSettings({ cjkRatio })`，保持推导本身是纯函数。
 */
export function estimateCjkRatio(samples: ReadonlyArray<string | undefined>): number {
  let cjkChars = 0
  let countedChars = 0

  for (const sample of samples) {
    if (!sample) continue
    for (const char of sample) {
      if (countedChars >= CJK_SAMPLE_MAX_CHARS) return countedChars > 0 ? cjkChars / countedChars : 0
      if (/\s/.test(char)) continue
      countedChars += 1
      if (CJK_CHAR_PATTERN.test(char)) cjkChars += 1
    }
  }

  return countedChars > 0 ? cjkChars / countedChars : 0
}

// ============================================================================
// 压缩语义辅助
// ============================================================================

/** 从 rawPrompt 解析手动 `/compact [自定义说明]`；非压缩命令返回 null。 */
export function parseManualCompactCommand(rawPrompt: string | undefined): string | null {
  const trimmed = rawPrompt?.trim() ?? ''
  const match = trimmed.match(/^\/compact(?:\s+([\s\S]+))?$/i)
  if (!match) return null
  return match[1]?.trim() ?? ''
}

/**
 * Pi 把「无需压缩」建模为 reject 而不是单独的结果类型。
 * Kila 将其还原为良性空操作，确保流正常结束且不会伪造 compact_complete。
 */
export function getCompactionNoopMessage(error: unknown): string | null {
  const raw = typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : ''
  if (/nothing to compact/i.test(raw)) return '当前上下文较小，暂时无需压缩。'
  if (/already compacted/i.test(raw)) return '当前上下文已经压缩过，无需重复压缩。'
  return null
}

/**
 * Pi 摘要调用的 usage → Kila AgentEventUsage。
 *
 * 压缩本身要跑一次模型调用，长会话里可能是几万 token；此前这部分完全不进计费统计，
 * 压缩越频繁月度用量偏差越大。`contextInputTokens` 刻意不填：摘要调用是独立请求，
 * 它的 input 不代表主对话的上下文占用，混进上下文校准会污染进度条。
 */
export function mapPiUsageToAgentEventUsage(
  usage: Usage | undefined,
  contextWindow?: number,
): AgentEventUsage | undefined {
  if (!usage) return undefined
  return {
    inputTokens: usage.input + usage.cacheRead + usage.cacheWrite,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheCreationTokens: usage.cacheWrite,
    costUsd: usage.cost?.total,
    contextWindow,
  }
}

/** `waitForCompactionToSettle` 只需要压缩状态与中止能力，用结构化接口避免耦合 AgentSession。 */
export interface CompactableSession {
  readonly isCompacting: boolean
  abortCompaction(): void
}

/** 等待 Pi 压缩落定；超时或收到 abort 时主动中止，避免会话永久卡在 isCompacting。 */
export async function waitForCompactionToSettle(
  session: CompactableSession,
  timeoutMs = 120_000,
  abortSignal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  await new Promise((resolve) => setTimeout(resolve, 25))
  while (session.isCompacting) {
    if (abortSignal?.aborted) {
      session.abortCompaction()
      return
    }
    if (Date.now() >= deadline) {
      session.abortCompaction()
      throw new Error(`Pi 上下文压缩在 ${timeoutMs}ms 内未完成，已中止以避免会话永久卡住`)
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
