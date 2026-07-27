/**
 * 长轮询失败退避与错误分级
 *
 * 历史缺陷（telegram-adapter / wechat account-runtime 同构）：
 *   catch → status=error → setTimeout(1500) → status=connected
 * 固定 1.5s 重试在 401/429 时会打成重试风暴；更糟的是把状态谎报成 connected，
 * 导致 `bridge-lifecycle-registry` 看到 connected 就 clearRetry，外层指数退避永远不生效。
 *
 * 现在：指数退避 1s → 2s → … → 60s（带抖动），并区分可重试与不可重试错误。
 */

const BASE_DELAY_MS = 1_000
const MAX_DELAY_MS = 60_000

/** 认证/授权类错误重试无意义，必须停止轮询并置 error */
const NON_RETRYABLE_STATUSES = new Set([401, 403, 404, 410])

/** 携带 HTTP 状态码的桥接错误，便于精确分级 */
export class BridgeHttpError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'BridgeHttpError'
    this.status = status
  }
}

export interface PollFailureClassification {
  retryable: boolean
  status?: number
}

function readStatus(error: unknown): number | undefined {
  if (error instanceof BridgeHttpError && typeof error.status === 'number') {
    return error.status
  }

  const candidate = error as { status?: unknown; statusCode?: unknown } | null
  if (typeof candidate?.status === 'number') return candidate.status
  if (typeof candidate?.statusCode === 'number') return candidate.statusCode

  // 兜底：从 "xxx失败 (401: Unauthorized)" 这类消息里抽状态码
  const message = error instanceof Error ? error.message : String(error ?? '')
  const matched = /\((\d{3})[:)]/.exec(message)
  return matched ? Number(matched[1]) : undefined
}

/**
 * 分级：
 * - 401/403/404/410 → 不可重试（凭证失效或配置错误）
 * - 其余（含 5xx、429、网络抖动） → 可重试
 */
export function classifyPollFailure(error: unknown): PollFailureClassification {
  const status = readStatus(error)
  if (typeof status === 'number' && NON_RETRYABLE_STATUSES.has(status)) {
    return { retryable: false, status }
  }

  const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase()
  if (message.includes('unauthorized') || message.includes('forbidden') || message.includes('invalid token')) {
    return { retryable: false, status }
  }

  return { retryable: true, status }
}

export interface PollBackoffOptions {
  baseDelayMs?: number
  maxDelayMs?: number
  /** 返回 [0,1)，注入后测试可确定性断言 */
  random?: () => number
}

/** 第 attempt 次失败（从 1 开始）的退避时长，带 ±20% 抖动 */
export function computePollBackoffDelayMs(attempt: number, options?: PollBackoffOptions): number {
  const base = options?.baseDelayMs ?? BASE_DELAY_MS
  const max = options?.maxDelayMs ?? MAX_DELAY_MS
  const safeAttempt = Math.max(1, Math.floor(attempt))
  const exponential = Math.min(max, base * 2 ** (safeAttempt - 1))
  const random = options?.random ?? Math.random
  const jitter = (random() * 0.4) - 0.2
  return Math.max(base, Math.min(max, Math.round(exponential * (1 + jitter))))
}

/** 可被 AbortSignal 提前唤醒的 sleep，避免 stop() 后仍挂着定时器 */
export function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve()

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    if (typeof timer.unref === 'function') timer.unref()

    function onAbort(): void {
      clearTimeout(timer)
      resolve()
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
