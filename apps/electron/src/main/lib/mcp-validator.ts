/**
 * MCP 服务器验证器
 *
 * 在将 MCP 服务器配置桥接到 Agent 运行时之前，验证其可用性：
 * - stdio 类型：检查命令是否存在
 * - http/sse 类型：可选地 ping URL
 *
 * 避免配置错误的 MCP 服务器导致整个 Agent 运行时无法建立工具桥接。
 */

import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import type { McpServerEntry } from '@kila/shared'
import { getAuditLogPath } from './config-paths'
import { appendTextDurably } from './safe-json-file'

/**
 * MCP 验证结果
 */
export interface McpValidationResult {
  /** 服务器名称 */
  name: string
  /** 是否验证通过 */
  valid: boolean
  /** 失败原因（如果 valid 为 false） */
  reason?: string
}

function maskSecret(value: unknown): unknown {
  if (typeof value !== 'string') return value
  if (!value.trim()) return value
  return value.length <= 6 ? '***' : `${value.slice(0, 2)}***${value.slice(-2)}`
}

function sanitizeMcpEntry(entry: McpServerEntry): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {
    type: entry.type,
    command: entry.type === 'stdio' ? entry.command : undefined,
    url: entry.type === 'http' || entry.type === 'sse' ? entry.url?.replace(/\/\/([^/@]+)@/, '//***@') : undefined,
  }
  if (entry.headers) {
    sanitized.headers = Object.fromEntries(Object.entries(entry.headers).map(([key, value]) => [
      key,
      /authorization|token|key|secret|cookie/i.test(key) ? maskSecret(value) : value,
    ]))
  }
  if (entry.env) {
    sanitized.env = Object.fromEntries(Object.entries(entry.env).map(([key, value]) => [
      key,
      /token|key|secret|password|credential/i.test(key) ? maskSecret(value) : value,
    ]))
  }
  return sanitized
}

function appendMcpAuditLog(input: {
  name: string
  action: string
  result: 'allow' | 'deny'
  reason?: string
  entry: McpServerEntry
}): void {
  appendTextDurably(getAuditLogPath(), `${JSON.stringify({
    kind: 'mcp_validator',
    actor: 'main',
    at: Date.now(),
    name: input.name,
    action: input.action,
    result: input.result,
    reason: input.reason,
    entry: sanitizeMcpEntry(input.entry),
  })}\n`)
}

/**
 * 验证单个 MCP 服务器配置
 *
 * @param name 服务器名称
 * @param entry MCP 服务器配置
 * @returns 验证结果
 */
export async function validateMcpServer(
  name: string,
  entry: McpServerEntry,
): Promise<McpValidationResult> {
  const deny = (reason: string): McpValidationResult => {
    appendMcpAuditLog({ name, action: `validate:${entry.type}`, result: 'deny', reason, entry })
    return { name, valid: false, reason }
  }
  const allow = (): McpValidationResult => {
    appendMcpAuditLog({ name, action: `validate:${entry.type}`, result: 'allow', entry })
    return { name, valid: true }
  }

  // stdio 类型：检查命令是否存在
  if (entry.type === 'stdio') {
    if (!entry.command) {
      return deny('缺少 command 字段')
    }

    if (!isSafeStdioCommand(entry.command)) {
      return deny(`不允许的 stdio command: ${entry.command}`)
    }

    // 检查命令是否可执行
    const commandValid = await isCommandAvailable(entry.command)
    if (!commandValid) {
      return deny(`命令不存在或不可执行: ${entry.command}`)
    }

    return allow()
  }

  // http/sse 类型：检查 URL 格式
  if (entry.type === 'http' || entry.type === 'sse') {
    if (!entry.url) {
      return deny('缺少 url 字段')
    }

    // 验证 URL 格式
    try {
      const parsedUrl = new URL(entry.url)
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return deny(`MCP URL 只允许 http/https 协议: ${entry.url}`)
      }
      if (isBlockedMcpHost(parsedUrl.hostname)) {
        return deny(`MCP URL 指向受限地址: ${parsedUrl.hostname}`)
      }
    } catch {
      return deny(`无效的 URL 格式: ${entry.url}`)
    }

    // 可选：ping URL（简单的 HEAD 请求）
    // 由于可能会增加启动延迟，暂时跳过网络验证
    // 只做基本的格式检查

    return allow()
  }

  return deny(`未知的传输类型: ${entry.type}`)
}

function isSafeStdioCommand(command: string): boolean {
  const trimmed = command.trim()
  if (!trimmed || /[\s;&|`$<>]/.test(trimmed)) return false
  const basename = trimmed.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  return !new Set(['sh', 'bash', 'zsh', 'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe']).has(basename)
}

function isIpv4(value: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)
}

function isBlockedMcpHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'metadata.google.internal') return true
  if (host.endsWith('.local')) return true
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false
  if (host === '169.254.169.254') return true
  if (!isIpv4(host)) return false

  const parts = host.split('.').map(Number)
  if (parts.some((part) => part < 0 || part > 255)) return true
  const [a, b] = parts as [number, number, number, number]
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  return false
}

/**
 * 检查命令是否可用
 *
 * 策略：
 * 1. 如果是绝对路径，检查文件是否存在
 * 2. 如果是相对命令（如 npx），使用 which 查找
 */
async function isCommandAvailable(command: string): Promise<boolean> {
  // 绝对路径
  if (command.startsWith('/') || command.startsWith('\\') || /^[A-Z]:/i.test(command)) {
    return existsSync(command)
  }

  // 相对命令：使用 which 查找
  try {
    // 跨平台 which 查找
    const whichCommand = process.platform === 'win32' ? 'where' : 'which'
    execFileSync(whichCommand, [command], { stdio: 'ignore', windowsHide: true })
    return true
  } catch {
    return false
  }
}

/**
 * 批量验证 MCP 服务器配置
 *
 * @param servers MCP 服务器配置对象
 * @returns 验证结果数组
 */
export async function validateMcpServers(
  servers: Record<string, McpServerEntry>,
): Promise<McpValidationResult[]> {
  const results: McpValidationResult[] = []

  for (const [name, entry] of Object.entries(servers)) {
    // 跳过未启用的服务器
    if (!entry.enabled) continue

    const result = await validateMcpServer(name, entry)
    results.push(result)
  }

  return results
}
