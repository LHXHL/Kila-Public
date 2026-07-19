/**
 * MCP 服务器管理器（参考 deepchat ServerManager 模式）
 *
 * 进程级长连接池：每个 MCP 服务器维持一个 Client 实例，
 * 应用启动时连接 enabled 服务器，调用时按需检查/重连，
 * 不再 per-turn 创建和销毁连接。
 */

import { Client } from '@modelcontextprotocol/sdk/client'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { McpServerEntry, WorkspaceMcpConfig } from '@kila/shared'
import { getGlobalAgentConfigDir, getGlobalAgentMcpPath } from './config-paths'
import { getGlobalAgentMcpConfig, saveGlobalAgentMcpConfig } from './global-agent-config-manager'
import { validateMcpServer, type McpValidationResult } from './mcp-validator'
import { createLogger } from './logger'

const log = createLogger('MCP Manager')

// ===== 类型 =====

type McpTransport =
  | InstanceType<typeof StdioClientTransport>
  | InstanceType<typeof StreamableHTTPClientTransport>
  | InstanceType<typeof SSEClientTransport>

interface McpToolDescriptor {
  name: string
  title?: string
  description?: string
  inputSchema?: Record<string, unknown>
}

interface McpToolCallResult {
  content?: Array<Record<string, unknown>>
  structuredContent?: Record<string, unknown>
  isError?: boolean
  toolResult?: unknown
  _meta?: Record<string, unknown>
}

interface McpClientLike {
  listTools: (params?: { cursor?: string }) => Promise<{
    tools: McpToolDescriptor[]
    nextCursor?: string
  }>
  callTool: (params: {
    name: string
    arguments?: Record<string, unknown>
  }) => Promise<McpToolCallResult>
}

interface McpServerConnection {
  client: McpClientLike
  close: () => Promise<void>
}

interface McpServerConnectOptions {
  name: string
  entry: McpServerEntry
  baseDir?: string
}

// ===== Session 错误检测（参考 deepchat） =====

function isSessionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  const sessionErrorPatterns = [
    'session expired',
    'no valid session',
    'session not found',
    'invalid session',
    'session id',
    'mcp-session-id',
  ]
  return sessionErrorPatterns.some((pattern) => message.includes(pattern))
}

// ===== Transport 创建 =====

function mergeHeaders(
  headers: HeadersInit | undefined,
  extraHeaders: Record<string, string>,
): Headers {
  const merged = new Headers(headers)
  for (const [key, value] of Object.entries(extraHeaders)) {
    merged.set(key, value)
  }
  return merged
}

function resolveCommand(command: string, baseDir?: string): string {
  if (!baseDir) return command
  if (command.startsWith('.') || command.startsWith('/')) {
    return resolve(baseDir, command)
  }
  return command
}

/**
 * 创建 stdio 传输时合并系统环境变量
 * 参考 deepchat 做法：非 node 命令保留全部 process.env，
 * 自定义 env 追加到已有环境变量上而不是覆盖。
 */
function buildStdioEnv(entry: McpServerEntry): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>

  // 补充用户自定义环境变量
  if (entry.env) {
    for (const [key, value] of Object.entries(entry.env)) {
      if (value !== undefined) {
        const stringValue = String(value ?? '')
        // PATH 相关变量合并而不是覆盖
        if (['PATH', 'Path', 'path'].includes(key)) {
          const pathKey = process.platform === 'win32' ? 'Path' : 'PATH'
          const separator = process.platform === 'win32' ? ';' : ':'
          const existing = env[pathKey] ?? ''
          env[pathKey] = existing
            ? `${stringValue}${separator}${existing}`
            : stringValue
        } else {
          env[key] = stringValue
        }
      }
    }
  }

  return env
}

function createMcpTransport(
  entry: McpServerEntry,
  options: { baseDir?: string } = {},
): McpTransport {
  const { baseDir } = options

  if (entry.type === 'stdio') {
    return new StdioClientTransport({
      command: resolveCommand(entry.command ?? '', baseDir),
      args: entry.args,
      env: buildStdioEnv(entry),
      cwd: baseDir,
      stderr: 'inherit',
    })
  }

  const headers = entry.headers
  const requestInit = headers ? { headers } : undefined
  const url = new URL(entry.url ?? '')

  if (entry.type === 'http') {
    return new StreamableHTTPClientTransport(url, {
      requestInit,
    })
  }

  return new SSEClientTransport(url, {
    requestInit,
    eventSourceInit: headers
      ? {
          fetch: (input, init) => globalThis.fetch(input, {
            ...init,
            headers: mergeHeaders(init?.headers, headers),
          }),
        }
      : undefined,
  })
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// ===== 单个 MCP 客户端 =====

/**
 * 单个 MCP 服务器的长连接客户端
 * 参考 deepchat McpClient 模式：连接保持、按需重连、工具缓存
 */
export class McpServerClient {
  private client: McpClientLike & {
    close: () => Promise<void>
    connect: (transport: McpTransport) => Promise<void>
  } | null = null
  private transport: McpTransport | null = null
  private isConnected = false
  private connectionTimeout: ReturnType<typeof setTimeout> | null = null

  // Session 错误恢复（参考 deepchat checkAndHandleSessionError）
  private isRecovering = false
  private hasRestarted = false

  // 工具缓存
  private cachedTools: McpToolDescriptor[] | null = null
  private lastError: string | null = null

  constructor(
    readonly serverName: string,
    readonly entry: McpServerEntry,
    readonly baseDir?: string,
  ) {}

  async connect(): Promise<void> {
    if (this.isConnected && this.client) {
      return
    }

    try {
      log.info(`[MCP] 正在连接服务器 ${this.serverName}...`)

      const timeoutMs = this.entry.type === 'stdio'
        ? Math.max(1, this.entry.timeout ?? 30) * 1000
        : 30000

      this.client = new Client({ name: 'Kila', version: '0.1.0' }) as unknown as McpClientLike & {
        close: () => Promise<void>
        connect: (transport: McpTransport) => Promise<void>
      }
      this.transport = createMcpTransport(this.entry, { baseDir: this.baseDir })

      await withTimeout(
        this.client.connect(this.transport),
        timeoutMs,
        `连接 MCP 服务器超时: ${this.serverName}`,
      )

      this.isConnected = true
      this.lastError = null
      log.info(`[MCP] 服务器 ${this.serverName} 连接成功`)
    } catch (error) {
      log.warn(`[MCP] 连接服务器 ${this.serverName} 失败:`, error)
      this.lastError = error instanceof Error ? error.message : String(error)
      this.cleanupResources()
      throw error
    }
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected || !this.client) return
    try {
      await this.internalDisconnect()
    } catch (error) {
      log.warn(`[MCP] 断开服务器 ${this.serverName} 失败:`, error)
    }
  }

  private async internalDisconnect(): Promise<void> {
    this.cleanupResources()
    log.info(`[MCP] 已断开服务器 ${this.serverName}`)
  }

  private cleanupResources(): void {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout)
      this.connectionTimeout = null
    }
    this.client = null
    this.transport = null
    this.isConnected = false
    this.cachedTools = null
  }

  isRunning(): boolean {
    return this.isConnected && !!this.client
  }

  getLast(): string | null {
    return this.lastError
  }

  /** 调用工具，支持按需自动重连 */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    try {
      if (!this.isConnected) {
        await this.connect()
      }
      if (!this.client) {
        throw new Error(`MCP 客户端 ${this.serverName} 未初始化`)
      }

      const preparedArgs = await this.prepareToolArguments(toolName, args)
      if (!preparedArgs.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: preparedArgs.error }],
        }
      }

      const result = await this.client.callTool({
        name: toolName,
        arguments: preparedArgs.args,
      })

      // 成功后重置重启标志
      this.hasRestarted = false

      if (result.isError) {
        this.cachedTools = null
        return {
          isError: true,
          content: [{ type: 'text', text: this.extractErrorText(result) }],
        }
      }
      return result
    } catch (error) {
      await this.checkAndHandleSessionError(error)
      this.cachedTools = null
      throw error
    }
  }

  /** 列出工具，支持缓存和按需重连 */
  async listTools(): Promise<McpToolDescriptor[]> {
    if (this.cachedTools !== null) {
      return this.cachedTools
    }

    try {
      if (!this.isConnected) {
        await this.connect()
      }
      if (!this.client) {
        throw new Error(`MCP 客户端 ${this.serverName} 未初始化`)
      }

      const tools: McpToolDescriptor[] = []
      let cursor: string | undefined
      do {
        const page = await this.client.listTools(cursor ? { cursor } : undefined)
        tools.push(...(page.tools ?? []))
        cursor = page.nextCursor
      } while (cursor)

      this.hasRestarted = false
      this.cachedTools = tools
      return tools
    } catch (error) {
      await this.checkAndHandleSessionError(error)
      throw error
    }
  }

  /** 刷新工具缓存，下次 listTools 时重新获取 */
  refreshTools(): void {
    this.cachedTools = null
  }

  private extractErrorText(result: McpToolCallResult): string {
    for (const item of result.content ?? []) {
      if (item.type === 'text' && typeof item.text === 'string') {
        return item.text
      }
    }
    if (result.structuredContent) {
      try { return JSON.stringify(result.structuredContent) } catch { /* fallback */ }
    }
    return 'MCP 工具执行失败'
  }

  private async prepareToolArguments(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: true; args: Record<string, unknown> } | { ok: false; error: string }> {
    if (toolName !== 'launch_app' || process.platform !== 'win32' || this.serverName !== 'cua-driver') {
      return { ok: true, args }
    }

    return this.prepareCuaWindowsLaunchArgs(args)
  }

  private async prepareCuaWindowsLaunchArgs(
    args: Record<string, unknown>,
  ): Promise<{ ok: true; args: Record<string, unknown> } | { ok: false; error: string }> {
    const normalizedArgs = { ...args }
    const bundleId = this.readStringArg(normalizedArgs.bundle_id)
    const name = this.readStringArg(normalizedArgs.name)

    if (bundleId && !bundleId.includes('!') && this.isWindowsPathLike(bundleId)) {
      delete normalizedArgs.bundle_id
      if (!this.readStringArg(normalizedArgs.path) && !this.readStringArg(normalizedArgs.launch_path)) {
        normalizedArgs.path = bundleId
      }
      return { ok: true, args: normalizedArgs }
    }

    if (
      this.readStringArg(normalizedArgs.path) ||
      this.readStringArg(normalizedArgs.launch_path) ||
      this.readStringArg(normalizedArgs.aumid) ||
      (bundleId && bundleId.includes('!')) ||
      this.hasUrlLaunchTargets(normalizedArgs)
    ) {
      return { ok: true, args: normalizedArgs }
    }

    const target = bundleId || name
    if (!target) {
      return { ok: true, args: normalizedArgs }
    }

    const apps = await this.listCuaWindowsApps()
    if (!apps) {
      return {
        ok: false,
        error: 'Unable to validate the Windows app target before launching. Call list_apps first, then retry with a Windows name, path, launch_path, or aumid.',
      }
    }

    if (!this.matchesCuaWindowsApp(apps, target)) {
      return {
        ok: false,
        error: `Windows app target '${target}' was not found. Call list_apps first and use a Windows app name, path, launch_path, or aumid. Do not use macOS bundle ids on Windows.`,
      }
    }

    return { ok: true, args: normalizedArgs }
  }

  private readStringArg(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }

  private isWindowsPathLike(value: string): boolean {
    return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\') || /[\\/]/.test(value)
  }

  private hasUrlLaunchTargets(args: Record<string, unknown>): boolean {
    return Array.isArray(args.urls) && args.urls.some((item) => this.readStringArg(item))
  }

  private async listCuaWindowsApps(): Promise<Array<Record<string, unknown>> | null> {
    if (!this.client) return null

    try {
      const result = await this.client.callTool({
        name: 'list_apps',
        arguments: {},
      })
      if (
        result.structuredContent &&
        typeof result.structuredContent === 'object' &&
        Array.isArray((result.structuredContent as { apps?: unknown }).apps)
      ) {
        return (result.structuredContent as { apps: Array<Record<string, unknown>> }).apps
      }

      const parsed = this.parseToolResultJsonObject(result.content)
      if (parsed && Array.isArray(parsed.apps)) {
        return parsed.apps as Array<Record<string, unknown>>
      }
    } catch (error) {
      log.warn('[MCP] Failed to preflight CUA Windows launch target:', error)
    }
    return null
  }

  private parseToolResultJsonObject(content: unknown): Record<string, unknown> | null {
    const text = Array.isArray(content)
      ? content
          .map((item) => item && typeof item === 'object' && 'text' in item
            ? String((item as { text?: unknown }).text ?? '')
            : '')
          .join('\n')
      : typeof content === 'string'
        ? content
        : ''
    if (!text.trim()) return null

    try {
      const parsed = JSON.parse(text)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  private matchesCuaWindowsApp(apps: Array<Record<string, unknown>>, target: string): boolean {
    const normalizedTarget = this.normalizeWindowsAppIdentifier(target)
    return apps.some((app) => {
      const candidates = [app.name, app.bundle_id, app.launch_path, app.path, app.aumid].flatMap(
        (value) => this.windowsAppIdentifierCandidates(value),
      )
      return candidates.some(
        (candidate) =>
          candidate === normalizedTarget ||
          candidate.includes(normalizedTarget) ||
          normalizedTarget.includes(candidate),
      )
    })
  }

  private windowsAppIdentifierCandidates(value: unknown): string[] {
    const raw = this.readStringArg(value)
    if (!raw) return []

    const normalized = this.normalizeWindowsAppIdentifier(raw)
    const basename = raw.split(/[\\/]/).pop()
    return basename && basename !== raw
      ? [normalized, this.normalizeWindowsAppIdentifier(basename)]
      : [normalized]
  }

  private normalizeWindowsAppIdentifier(value: string): string {
    return value.trim().replace(/^"|"$/g, '').toLowerCase()
  }

  /**
   * Session 错误恢复（参考 deepchat checkAndHandleSessionError）
   * 检测到 session 过期 → 清理资源 → 标记 hasRestarted
   * 下次调用会自动 connect() 重连
   */
  private async checkAndHandleSessionError(error: unknown): Promise<void> {
    if (isSessionError(error) && !this.isRecovering) {
      if (this.hasRestarted) {
        log.warn(`[MCP] 服务器 ${this.serverName} session 错误重启后依然存在，停止服务`)
        await this.internalDisconnect()
        throw new Error(`MCP 服务 ${this.serverName} session 错误重启后依然存在`)
      }

      log.warn(`[MCP] 服务器 ${this.serverName} 检测到 session 错误，准备重启连接...`)
      this.isRecovering = true
      try {
        this.cleanupResources()
        this.cachedTools = null
        this.hasRestarted = true
      } finally {
        this.isRecovering = false
      }
    }
  }
}

// ===== 服务器管理器（单例） =====

export class McpServerManager {
  private clients = new Map<string, McpServerClient>()
  private lastErrors = new Map<string, string>()
  private initialized = false

  /**
   * 初始化：连接所有 enabled 的全局 MCP 服务器
   * 幂等调用，多次调用只会执行一次
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    this.initialized = true

    log.info('[MCP] 开始初始化全局 MCP 服务器连接...')

    const config = getGlobalAgentMcpConfig()
    const globalAgentDir = getGlobalAgentConfigDir()

    for (const [name, entry] of Object.entries(config.servers ?? {})) {
      if (!entry.enabled) continue

      try {
        const validation = await validateMcpServer(name, entry)
        if (!validation.valid) {
          log.warn(`[MCP] 跳过无效服务器 ${name}: ${validation.reason ?? 'unknown'}`)
          continue
        }

        await this.startServer(name, entry, globalAgentDir)
      } catch (error) {
        log.warn(`[MCP] 启动服务器 ${name} 失败:`, error)
        this.lastErrors.set(name, error instanceof Error ? error.message : String(error))
      }
    }

    log.info(`[MCP] 全局 MCP 服务器初始化完成，已连接 ${this.clients.size} 个服务器`)
  }

  /** 启动并连接单个服务器 */
  async startServer(name: string, entry: McpServerEntry, baseDir?: string): Promise<void> {
    // 如果已经在运行，直接返回
    if (this.clients.has(name)) {
      const existing = this.clients.get(name)!
      if (existing.isRunning()) {
        return
      }
      // 存在但断开了，重新连接
      this.clients.delete(name)
    }

    const client = new McpServerClient(name, entry, baseDir)
    await client.connect()
    this.clients.set(name, client)
    this.lastErrors.delete(name)
  }

  /** 停止单个服务器 */
  async stopServer(name: string): Promise<void> {
    const client = this.clients.get(name)
    if (!client) return

    await client.disconnect()
    this.clients.delete(name)
    this.lastErrors.delete(name)
  }

  /** 检查服务器是否运行中 */
  isServerRunning(name: string): boolean {
    return this.clients.get(name)?.isRunning() ?? false
  }

  /** 获取客户端实例 */
  getClient(name: string): McpServerClient | undefined {
    return this.clients.get(name)
  }

  /** 获取所有运行的客户端 */
  getRunningClients(): McpServerClient[] {
    return Array.from(this.clients.values()).filter((c) => c.isRunning())
  }

  /** 获取服务器最后错误 */
  getServerError(name: string): string | undefined {
    return this.lastErrors.get(name) ?? this.clients.get(name)?.getLast() ?? undefined
  }

  /** 配置变更时重新加载：停止被移除/禁用的服务器，启动新增的 */
  async reload(config: WorkspaceMcpConfig): Promise<void> {
    const servers = config.servers ?? {}
    const configuredNames = new Set(Object.keys(servers))
    const globalAgentDir = getGlobalAgentConfigDir()

    // 停止被移除或禁用的服务器
    for (const name of this.clients.keys()) {
      const entry = servers[name]
      if (!configuredNames.has(name) || entry?.enabled === false) {
        log.info(`[MCP] 配置变更，停止服务器 ${name}`)
        await this.stopServer(name)
      }
    }

    // 启动新增的服务器
    for (const [name, entry] of Object.entries(servers)) {
      if (!entry.enabled || this.clients.has(name)) continue

      try {
        const validation = await validateMcpServer(name, entry)
        if (!validation.valid) continue
        await this.startServer(name, entry, globalAgentDir)
      } catch (error) {
        log.warn(`[MCP] 重新加载服务器 ${name} 失败:`, error)
      }
    }
  }

  /** 关闭所有连接（应用退出时调用） */
  async shutdown(): Promise<void> {
    log.info('[MCP] 正在关闭所有连接...')
    const results = await Promise.allSettled(
      Array.from(this.clients.values()).map((c) => c.disconnect()),
    )
    this.clients.clear()
    this.lastErrors.clear()
    this.initialized = false
    log.info('[MCP] 所有连接已关闭')
  }

  /** 获取已连接客户端的工具列表 */
  async getAllTools(): Promise<{ serverName: string; tools: McpToolDescriptor[] }[]> {
    const results: { serverName: string; tools: McpToolDescriptor[] }[] = []

    for (const client of this.getRunningClients()) {
      try {
        const tools = await client.listTools()
        results.push({ serverName: client.serverName, tools })
      } catch (error) {
        log.warn(`[MCP] 获取服务器 ${client.serverName} 工具列表失败:`, error)
      }
    }

    return results
  }
}

// ===== 单例导出 =====

export const mcpServerManager = new McpServerManager()

// ===== 向后兼容：给 getMcpAgentTools 用的适配器 =====

/**
 * 从 McpServerManager 获取已连接的工具
 * 不再 per-turn 创建连接，只从长连接池获取工具定义
 */
export async function getMcpAgentToolsFromManager(options: {
  cwd?: string
  customMcpServers?: Record<string, unknown>
}): Promise<{
  tools: import('@earendil-works/pi-agent-core').AgentTool<any>[]
  dispose: () => Promise<void>
}> {
  const { normalizeMcpServerEntry, normalizeCustomMcpServers } = await import('./pi-tools-bridge')

  const globalServers = getGlobalAgentMcpConfig().servers ?? {}
  const customServers = normalizeCustomMcpServers(options.customMcpServers)
  const usedNames = new Set<string>()
  const tools: import('@earendil-works/pi-agent-core').AgentTool<any>[] = []

  // 从全局服务器获取工具
  for (const [name, entry] of Object.entries(globalServers)) {
    if (!entry.enabled) continue
    const client = mcpServerManager.getClient(name)
    if (!client?.isRunning()) continue

    try {
      const serverTools = await client.listTools()
      tools.push(
        ...serverTools.map((tool) => createMcpAgentToolFromClient(name, tool, client, usedNames)),
      )
    } catch (error) {
      log.warn(`[MCP] 从服务器 ${name} 获取工具失败:`, error)
    }
  }

  // 从自定义服务器获取工具（也走 manager，但自定义服务器可能未预连接）
  for (const [name, entry] of Object.entries(customServers)) {
    if (!entry.enabled) continue

    let client = mcpServerManager.getClient(name)
    if (!client) {
      // 自定义服务器按需创建并连接
      const baseDir = options.cwd
      client = new McpServerClient(name, entry as McpServerEntry, baseDir)
      try {
        await client.connect()
        mcpServerManager.getClient // just to confirm type
        // 不加入 manager 的 clients map，但我们可以直接用它
      } catch (error) {
        log.warn(`[MCP] 自定义服务器 ${name} 连接失败，已跳过:`, error)
        continue
      }
    }

    try {
      const serverTools = await client.listTools()
      tools.push(
        ...serverTools.map((tool) => createMcpAgentToolFromClient(name, tool, client, usedNames)),
      )
    } catch (error) {
      log.warn(`[MCP] 从自定义服务器 ${name} 获取工具失败:`, error)
    }
  }

  return {
    tools,
    // dispose 不再做任何事，连接由 manager 长期管理
    dispose: async () => {},
  }
}

function createMcpAgentToolFromClient(
  serverName: string,
  tool: McpToolDescriptor,
  client: McpServerClient,
  usedNames: Set<string>,
): import('@earendil-works/pi-agent-core').AgentTool<any> {
  const visibleName = ensureUniqueToolName(tool.name, serverName, usedNames)
  const parameters = tool.inputSchema && tool.inputSchema.type === 'object'
    ? tool.inputSchema
    : { type: 'object' }

  return {
    name: visibleName,
    label: `${serverName} / ${tool.title ?? tool.name}`,
    description: tool.description
      ? `[MCP:${serverName}] ${tool.description}`
      : `[MCP:${serverName}] ${tool.name}`,
    parameters: parameters as never,
    execute: async (_toolCallId, params) => {
      const result = await client.callTool(tool.name, params as Record<string, unknown>)

      if (result.isError) {
        throw new Error(buildMcpErrorMessage(result))
      }

      return {
        content: normalizeMcpToolContent(result),
        details: {
          serverName,
          toolName: tool.name,
          ...(result.structuredContent && { structuredContent: result.structuredContent }),
          ...(result._meta && { meta: result._meta }),
        },
      }
    },
  }
}

function ensureUniqueToolName(
  toolName: string,
  serverName: string,
  usedNames: Set<string>,
): string {
  if (!usedNames.has(toolName)) {
    usedNames.add(toolName)
    return toolName
  }

  let candidate = `${serverName}__${toolName}`
  let counter = 2
  while (usedNames.has(candidate)) {
    candidate = `${serverName}__${toolName}_${counter}`
    counter++
  }
  usedNames.add(candidate)
  return candidate
}

type TextContent = { type: 'text'; text: string }
type ImageContent = { type: 'image'; data: string; mimeType: string }

function createMcpTextResult(text: string): TextContent {
  return { type: 'text', text }
}

function stringifyFallback(value: unknown): string {
  if (typeof value === 'string') return value
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

function normalizeMcpToolContent(result: McpToolCallResult): Array<TextContent | ImageContent> {
  const normalized: Array<TextContent | ImageContent> = []

  for (const item of result.content ?? []) {
    if (item.type === 'text' && typeof item.text === 'string') {
      normalized.push({ type: 'text', text: item.text })
      continue
    }
    if (item.type === 'image' && typeof item.data === 'string' && typeof item.mimeType === 'string') {
      normalized.push({ type: 'image', data: item.data, mimeType: item.mimeType })
      continue
    }
    if (item.type === 'resource' && item.resource && typeof item.resource === 'object') {
      const resource = item.resource as Record<string, unknown>
      if (typeof resource.text === 'string') {
        normalized.push(createMcpTextResult(resource.text))
      } else if (typeof resource.uri === 'string') {
        normalized.push(createMcpTextResult(`[MCP resource] ${resource.uri}`))
      }
      continue
    }
    if (item.type === 'resource_link') {
      const name = typeof item.name === 'string' ? item.name : 'resource'
      const uri = typeof item.uri === 'string' ? item.uri : ''
      normalized.push(createMcpTextResult(`[MCP resource link] ${name}${uri ? `: ${uri}` : ''}`))
      continue
    }
    if (item.type === 'audio' && typeof item.mimeType === 'string') {
      normalized.push(createMcpTextResult(`[MCP audio] ${item.mimeType}`))
    }
  }

  if (normalized.length > 0) return normalized
  if (result.structuredContent) return [createMcpTextResult(stringifyFallback(result.structuredContent))]
  if (typeof result.toolResult !== 'undefined') return [createMcpTextResult(stringifyFallback(result.toolResult))]

  return [createMcpTextResult('MCP 工具已执行，但没有返回可显示内容。')]
}

function buildMcpErrorMessage(result: McpToolCallResult): string {
  const content = normalizeMcpToolContent(result)
  const text = content
    .filter((item): item is { type: 'text'; text: string } => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')
  return text || 'MCP 工具执行失败'
}
