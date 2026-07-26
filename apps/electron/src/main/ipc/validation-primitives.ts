/**
 * IPC 边界通用校验原语
 *
 * 与领域无关的断言/校验帮助函数，供 validation.ts 及各领域校验模块复用。
 * 从 validation.ts 拆出以控制单文件体积；仅纯函数，无领域类型依赖。
 */

export function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`)
  }
  return value as Record<string, unknown>
}

export function assertString(
  value: unknown,
  label: string,
  options: { optional?: boolean; max?: number; nonEmpty?: boolean } = {}
): string {
  if (value === undefined || value === null) {
    if (options.optional) return ''
    throw new Error(`${label} 必须是字符串`)
  }
  if (typeof value !== 'string') {
    throw new Error(`${label} 必须是字符串`)
  }
  if (options.nonEmpty && value.trim() === '') {
    throw new Error(`${label} 不能为空`)
  }
  if (options.max !== undefined && value.length > options.max) {
    throw new Error(`${label} 过长`)
  }
  return value
}

export function assertOptionalString(
  value: unknown,
  label: string,
  max = 4096
): string | undefined {
  if (value === undefined || value === null) return undefined
  return assertString(value, label, { max })
}

export function assertBoolean(
  value: unknown,
  label: string,
  fallback?: boolean
): boolean {
  if (value === undefined || value === null) {
    if (fallback !== undefined) return fallback
    throw new Error(`${label} 必须是布尔值`)
  }
  if (typeof value !== 'boolean') {
    throw new Error(`${label} 必须是布尔值`)
  }
  return value
}

export function assertOptionalBoolean(
  value: unknown,
  label: string
): boolean | undefined {
  if (value === undefined || value === null) return undefined
  return assertBoolean(value, label)
}

export function assertNumber(
  value: unknown,
  label: string,
  options: {
    optional?: boolean
    min?: number
    max?: number
    integer?: boolean
  } = {}
): number {
  if (value === undefined || value === null) {
    if (options.optional) return 0
    throw new Error(`${label} 必须是数字`)
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} 必须是有限数字`)
  }
  if (options.integer && !Number.isInteger(value)) {
    throw new Error(`${label} 必须是整数`)
  }
  if (options.min !== undefined && value < options.min) {
    throw new Error(`${label} 不能小于 ${options.min}`)
  }
  if (options.max !== undefined && value > options.max) {
    throw new Error(`${label} 不能大于 ${options.max}`)
  }
  return value
}

export function assertOptionalNumber(
  value: unknown,
  label: string,
  options: { min?: number; max?: number; integer?: boolean } = {}
): number | undefined {
  if (value === undefined || value === null) return undefined
  return assertNumber(value, label, options)
}

export function assertStringArray(
  value: unknown,
  label: string,
  options: {
    optional?: boolean
    maxItems?: number
    maxItemLength?: number
  } = {}
): string[] {
  if (value === undefined || value === null) {
    if (options.optional) return []
    throw new Error(`${label} 必须是字符串数组`)
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} 必须是字符串数组`)
  }
  if (options.maxItems !== undefined && value.length > options.maxItems) {
    throw new Error(`${label} 条目过多`)
  }
  return value.map((item, index) =>
    assertString(item, `${label}[${index}]`, {
      max: options.maxItemLength ?? 4096,
    })
  )
}

export function optionalStringArray(
  value: unknown,
  label: string,
  maxItems = 200
): string[] | undefined {
  if (value === undefined || value === null) return undefined
  return assertStringArray(value, label, { maxItems, maxItemLength: 4096 })
}

export function assertEnum<T extends string>(
  value: unknown,
  label: string,
  values: Set<T>
): T {
  if (typeof value !== 'string' || !values.has(value as T)) {
    throw new Error(`${label} 无效`)
  }
  return value as T
}
