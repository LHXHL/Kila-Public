/**
 * MCP 服务器条目归一化与连接指纹
 *
 * 纯函数模块（只依赖 logger），便于脱离 Electron 主进程单测。
 * 覆盖三件事：
 * - 按 transport 类型校验必填字段，把「缺 command / 缺 url」挡在归一化阶段
 * - 生成连接指纹，用于 reload 时判断已启用服务器的连接参数是否变更
 * - 生成 session 级自定义服务器在连接池里的注册键
 */

import type { McpServerEntry } from '@kila/shared'
import { createLogger } from './logger'

const log = createLogger('MCP 配置')

/** 归一化结果：失败时带上具体原因，方便日志与测试断言 */
export type McpServerEntryNormalization =
  | { ok: true; entry: McpServerEntry }
  | { ok: false; reason: string }

function normalizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') return undefined

  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string') {
      result[key] = item
    }
  }

  return Object.keys(result).length > 0 ? result : undefined
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const result = value.filter((item): item is string => typeof item === 'string')
  return result.length > 0 ? result : undefined
}

/**
 * 归一化单个 MCP 服务器条目
 *
 * 旧实现不按 type 校验必填字段：stdio 缺 command、http/sse 缺 url 都能通过，
 * 一直到 createMcpTransport 里 `new URL('')` 才抛 Invalid URL，报错位置离配置很远。
 * 现在在归一化阶段就拒绝并给出原因。
 */
export function normalizeMcpServerEntry(value: unknown): McpServerEntryNormalization {
  if (!value || typeof value !== 'object') {
    return { ok: false, reason: '配置不是对象' }
  }

  const entry = value as Record<string, unknown>
  const type = entry.type
  if (type !== 'stdio' && type !== 'http' && type !== 'sse') {
    return { ok: false, reason: `未知的传输类型: ${String(type)}` }
  }

  const normalized: McpServerEntry = {
    type,
    enabled: typeof entry.enabled === 'boolean' ? entry.enabled : true,
  }

  if (typeof entry.command === 'string' && entry.command.trim()) normalized.command = entry.command
  if (typeof entry.url === 'string' && entry.url.trim()) normalized.url = entry.url

  const args = normalizeStringArray(entry.args)
  if (args) normalized.args = args

  const env = normalizeStringRecord(entry.env)
  if (env) normalized.env = env

  const headers = normalizeStringRecord(entry.headers)
  if (headers) normalized.headers = headers

  if (typeof entry.timeout === 'number' && Number.isFinite(entry.timeout)) {
    normalized.timeout = entry.timeout
  }

  if (type === 'stdio' && !normalized.command) {
    return { ok: false, reason: 'stdio 类型缺少 command 字段' }
  }
  if ((type === 'http' || type === 'sse') && !normalized.url) {
    return { ok: false, reason: `${type} 类型缺少 url 字段` }
  }

  return { ok: true, entry: normalized }
}

/** 归一化 session 级自定义 MCP 配置，无效条目跳过并记录原因 */
export function normalizeCustomMcpServers(
  servers?: Record<string, unknown>,
): Record<string, McpServerEntry> {
  if (!servers) return {}

  const result: Record<string, McpServerEntry> = {}
  for (const [name, entry] of Object.entries(servers)) {
    const normalized = normalizeMcpServerEntry(entry)
    if (normalized.ok) {
      result[name] = normalized.entry
    } else {
      log.warn(`[MCP 配置] 忽略无效的 session 级 MCP 配置 ${name}: ${normalized.reason}`)
    }
  }
  return result
}

function sortedRecord(record?: Record<string, string>): Array<[string, string]> {
  if (!record) return []
  return Object.entries(record).sort(([a], [b]) => a.localeCompare(b))
}

/**
 * 生成连接指纹：只包含真正决定连接行为的字段。
 *
 * `enabled` 由上层的启停分支处理，`lastTestResult` / `isBuiltin` 属于展示与元信息，
 * 都不能参与比较，否则一次连通性测试就会触发无谓重连。
 */
export function buildMcpConnectionSignature(entry: McpServerEntry): string {
  return JSON.stringify({
    type: entry.type,
    command: entry.command ?? null,
    args: entry.args ?? [],
    env: sortedRecord(entry.env),
    url: entry.url ?? null,
    headers: sortedRecord(entry.headers),
    timeout: entry.timeout ?? null,
  })
}

/** session 级自定义 MCP 服务器在连接池里的键前缀 */
export const CUSTOM_MCP_REGISTRY_PREFIX = 'custom:'

/**
 * 构造自定义服务器的注册键。
 *
 * 加前缀是为了和全局 MCP 服务器区分：reload 只按全局配置增删全局条目，
 * 自定义连接必须跳过，否则会被当成「配置里已移除」而误停。
 */
export function buildCustomMcpRegistryKey(sessionId: string | undefined, name: string): string {
  return `${CUSTOM_MCP_REGISTRY_PREFIX}${sessionId ?? 'shared'}:${name}`
}

/** 判断连接池里的键是否属于 session 级自定义服务器 */
export function isCustomMcpRegistryKey(key: string): boolean {
  return key.startsWith(CUSTOM_MCP_REGISTRY_PREFIX)
}
