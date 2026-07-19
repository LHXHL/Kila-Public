/**
 * 统一日志封装
 *
 * 为主进程提供模块化的日志输出，支持按级别过滤，并在输出前统一脱敏。
 * 生产构建中 debug 级别默认被抑制。
 *
 * 用法：
 *   import { createLogger } from './logger'
 *   const log = createLogger('渠道管理')
 *   log.info('[渠道管理] 已创建渠道:', channel.name)
 *   log.warn('[渠道管理] 加密不可用')
 *   log.error('[渠道管理] 操作失败:', error)
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const SENSITIVE_KEY = /(api[-_]?key|secret|token|password|authorization|license|credential|private[-_]?key)/i
const MAX_SANITIZE_DEPTH = 8
const MAX_JSON_STRING_LENGTH = 100_000

let minLevel: LogLevel = 'info'

export function setLogLevel(level: LogLevel): void {
  minLevel = level
}

export interface Logger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

function redactSensitiveString(value: string): string {
  const trimmed = value.trim()
  if (value.length <= MAX_JSON_STRING_LENGTH && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
    try {
      return JSON.stringify(sanitizeLogValue(JSON.parse(value)))
    } catch {
      // 不是合法 JSON 时继续做文本级脱敏。
    }
  }

  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|nmem|token|key)[-_][A-Za-z0-9._-]{8,}\b/gi, '[REDACTED]')
    .replace(/\b(api[-_]?key|secret|token|password|authorization|credential)\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+):([^\s/@]+)@/gi, '$1$2:[REDACTED]@')
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function sanitizeLogValue(
  value: unknown,
  key = '',
  seen = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]'
  if (typeof value === 'string') return redactSensitiveString(value)
  if (!value || typeof value !== 'object') return value
  if (depth >= MAX_SANITIZE_DEPTH) return '[MaxDepth]'
  if (seen.has(value)) return '[Circular]'

  if (value instanceof Error) {
    seen.add(value)
    return {
      name: value.name,
      message: redactSensitiveString(value.message),
      stack: value.stack ? redactSensitiveString(value.stack) : undefined,
    }
  }

  if (Array.isArray(value)) {
    seen.add(value)
    return value.map((entry) => sanitizeLogValue(entry, '', seen, depth + 1))
  }

  if (!isPlainRecord(value)) return value

  seen.add(value)
  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      sanitizeLogValue(childValue, childKey, seen, depth + 1),
    ]),
  )
}

function sanitizeArgs(args: unknown[]): unknown[] {
  return args.map((arg) => sanitizeLogValue(arg))
}

export function createLogger(_module: string): Logger {
  function shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel]
  }

  return {
    debug: (...args: unknown[]) => {
      if (shouldLog('debug')) console.log(...sanitizeArgs(args))
    },
    info: (...args: unknown[]) => {
      if (shouldLog('info')) console.log(...sanitizeArgs(args))
    },
    warn: (...args: unknown[]) => {
      if (shouldLog('warn')) console.warn(...sanitizeArgs(args))
    },
    error: (...args: unknown[]) => {
      if (shouldLog('error')) console.error(...sanitizeArgs(args))
    },
  }
}

export const loggerInternals = {
  sanitizeLogValue,
}
