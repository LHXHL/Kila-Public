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
import { resolve } from 'node:path'
import type { McpServerEntry, WorkspaceMcpConfig } from '@kila/shared'
import { getGlobalAgentConfigDir } from './config-paths'
import { getGlobalAgentMcpConfig } from './global-agent-config-manager'
import {
  prepareCuaWindowsLaunchArgs,
  shouldPrepareCuaWindowsLaunch,
} from './mcp-cua-windows-args'
import { buildMcpConnectionSignature, isCustomMcpRegistryKey } from './mcp-server-entry'
import { validateMcpServer } from './mcp-validator'
import { createLogger } from './logger'

const log = createLogger('MCP Manager')

/** 关闭连接的兜底超时：卡死的服务器不能拖住应用退出 */
const CLOSE_TIMEOUT_MS = 5000

// ===== 类型 =====

/**
 * MCP 传输通道的结构化接口。
 *
 * 真实 SDK 的三种 transport 都有 `close(): Promise<void>`，测试替身也只需实现它。
 * 用结构化类型而不是具体类联合，是为了让连接工厂可注入。
 */
export interface McpTransportLike {
  close: () => Promise<void>
}

export interface McpToolDescriptor {
  name: string
  title?: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface McpToolCallResult {
  content?: Array<Record<string, unknown>>
  structuredContent?: Record<string, unknown>
  isError?: boolean
  toolResult?: unknown
  _meta?: Record<string, unknown>
}

export interface McpClientLike {
  listTools: (params?: { cursor?: string }) => Promise<{
    tools: McpToolDescriptor[]
    nextCursor?: string
  }>
  callTool: (params: {
    name: string
    arguments?: Record<string, unknown>
  }) => Promise<McpToolCallResult>
}

/** 运行时客户端：在 McpClientLike 之上补齐连接生命周期方法 */
export interface McpRuntimeClient extends McpClientLike {
  connect: (transport: McpTransportLike) => Promise<void>
  close: () => Promise<void>
}

/** 创建 transport 时的上下文；serverName 仅用于日志（环境变量过滤清单） */
export interface McpTransportCreateOptions {
  baseDir?: string
  serverName?: string
}

/** 连接工厂：生产环境走 MCP SDK，测试可注入假客户端断言 close 行为 */
export interface McpConnectionFactory {
  createClient: () => McpRuntimeClient
  createTransport: (entry: McpServerEntry, options: McpTransportCreateOptions) => McpTransportLike
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
 * 疑似凭证的环境变量名模式。
 *
 * stdio MCP 服务器是第三方进程，直接继承宿主机全部 process.env
 * 会把用户 shell 里的 AWS / GitHub / npm token 和 Kila 注入的凭证一并交出去。
 * 这里采用「拒绝名单」而不是「白名单」：既堵住明显的凭证泄漏，
 * 又不会因为漏配某个开发变量而让大量 MCP 服务器直接起不来。
 * 服务器如果确实需要某个 token，用户在该服务器的 env 里显式声明即可（显式配置在过滤之后应用）。
 */
const SECRET_ENV_PATTERN = /(^|_)(API_?KEY|ACCESS_?KEY|SECRET_?KEY|PRIVATE_?KEY|SECRET|SECRETS|TOKEN|PASSWORD|PASSWD|CREDENTIAL|CREDENTIALS|SESSION_?KEY)(_|$)/i

/** 记录过的服务器名，避免每次重连都重复打印同一份过滤清单 */
const reportedEnvFilterServers = new Set<string>()

export function isSecretEnvName(name: string): boolean {
  return SECRET_ENV_PATTERN.test(name)
}

/**
 * 创建 stdio 传输时构建子进程环境变量
 *
 * 保留常规开发环境（PATH / HOME / NODE_* 等）以兼容主流 MCP 服务器，
 * 但剔除疑似凭证的变量；用户自定义 env 在过滤之后追加，可覆盖任何被过滤项。
 */
function buildStdioEnv(entry: McpServerEntry, serverName?: string): Record<string, string> {
  const env: Record<string, string> = {}
  const filteredNames: string[] = []

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== 'string') continue
    if (isSecretEnvName(key)) {
      filteredNames.push(key)
      continue
    }
    env[key] = value
  }

  // 只记录变量名，绝不记录值
  if (filteredNames.length > 0 && serverName && !reportedEnvFilterServers.has(serverName)) {
    reportedEnvFilterServers.add(serverName)
    log.info(
      `[MCP] 服务器 ${serverName} 的子进程环境已过滤 ${filteredNames.length} 个疑似凭证变量: `
      + `${filteredNames.sort().join(', ')}（如确需使用，请在该服务器配置的 env 中显式声明）`,
    )
  }

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
  options: McpTransportCreateOptions = {},
): McpTransportLike {
  const { baseDir } = options

  if (entry.type === 'stdio') {
    return new StdioClientTransport({
      command: resolveCommand(entry.command ?? '', baseDir),
      args: entry.args,
      env: buildStdioEnv(entry, options.serverName),
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

/** 生产环境连接工厂：MCP SDK Client + 真实 transport */
export const defaultMcpConnectionFactory: McpConnectionFactory = {
  createClient: () => new Client({ name: 'Kila', version: '0.1.0' }) as unknown as McpRuntimeClient,
  createTransport: (entry, options) => createMcpTransport(entry, options),
}

// ===== 单个 MCP 客户端 =====

/**
 * 单个 MCP 服务器的长连接客户端
 * 参考 deepchat McpClient 模式：连接保持、按需重连、工具缓存
 */
export class McpServerClient {
  private client: McpRuntimeClient | null = null
  private transport: McpTransportLike | null = null
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
    private readonly factory: McpConnectionFactory = defaultMcpConnectionFactory,
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

      this.client = this.factory.createClient()
      this.transport = this.factory.createTransport(this.entry, {
        baseDir: this.baseDir,
        serverName: this.serverName,
      })

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
      // withTimeout 超时不会取消底层 connect：stdio 子进程可能已经拉起，
      // 这里必须真正关闭 client / transport，否则每次连接失败都留下孤儿进程。
      await this.closeAndCleanup()
      throw error
    }
  }

  async disconnect(): Promise<void> {
    if (!this.client && !this.transport) return
    try {
      await this.internalDisconnect()
    } catch (error) {
      log.warn(`[MCP] 断开服务器 ${this.serverName} 失败:`, error)
    }
  }

  private async internalDisconnect(): Promise<void> {
    await this.closeAndCleanup()
    log.info(`[MCP] 已断开服务器 ${this.serverName}`)
  }

  /**
   * 真正关闭连接再清理引用
   *
   * 旧实现只把 client / transport 置 null，SDK 的 close 从未被调用，
   * stdio 类型每次禁用或重载 MCP 都会留下持有管道的孤儿子进程，
   * 应用退出时的 shutdown 同样杀不掉它们。
   */
  private async closeAndCleanup(): Promise<void> {
    const client = this.client
    const transport = this.transport
    this.cleanupResources()

    if (client) {
      try {
        // Client.close() 会连带关闭 transport 并回收 stdio 子进程
        await withTimeout(
          client.close(),
          CLOSE_TIMEOUT_MS,
          `关闭 MCP 服务器超时: ${this.serverName}`,
        )
        return
      } catch (error) {
        log.warn(`[MCP] 关闭服务器 ${this.serverName} 客户端失败，改为直接关闭传输通道:`, error)
      }
    }

    if (!transport) return
    try {
      await withTimeout(
        transport.close(),
        CLOSE_TIMEOUT_MS,
        `关闭 MCP 传输通道超时: ${this.serverName}`,
      )
    } catch (error) {
      log.warn(`[MCP] 关闭服务器 ${this.serverName} 传输通道失败:`, error)
    }
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

  /**
   * 调用工具前的参数预检
   *
   * 目前只有 cua-driver 在 Windows 上需要（模型常把 macOS bundle id 丢给 Windows），
   * 具体规则见 mcp-cua-windows-args.ts。
   */
  private async prepareToolArguments(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: true; args: Record<string, unknown> } | { ok: false; error: string }> {
    if (!shouldPrepareCuaWindowsLaunch(this.serverName, toolName)) {
      return { ok: true, args }
    }

    const client = this.client
    if (!client) return { ok: true, args }

    return prepareCuaWindowsLaunchArgs(args, (params) => client.callTool(params))
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
        // 必须真正关闭旧连接，否则 stdio 子进程会随每次 session 恢复不断堆积
        await this.closeAndCleanup()
        this.hasRestarted = true
      } finally {
        this.isRecovering = false
      }
    }
  }
}

// ===== 服务器管理器（单例） =====

/** 客户端工厂：测试注入假客户端，生产环境创建真实长连接客户端 */
export type McpServerClientFactory = (
  serverName: string,
  entry: McpServerEntry,
  baseDir?: string,
) => McpServerClient

export class McpServerManager {
  private clients = new Map<string, McpServerClient>()
  private lastErrors = new Map<string, string>()
  private initialized = false

  constructor(
    private readonly createServerClient: McpServerClientFactory =
    (serverName, entry, baseDir) => new McpServerClient(serverName, entry, baseDir),
  ) {}

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

  /** 启动并连接单个全局服务器 */
  async startServer(name: string, entry: McpServerEntry, baseDir?: string): Promise<void> {
    await this.startServerAs({ registryKey: name, serverName: name, entry, baseDir })
  }

  /**
   * 以指定注册键启动服务器
   *
   * session 级自定义服务器需要把「注册键」与「展示用服务器名」分开：
   * 前者带 custom: 前缀，保证 reload 不会把它当成全局配置里被移除的条目；
   * 后者决定工具标签和重名降级前缀。
   */
  private async startServerAs(options: {
    registryKey: string
    serverName: string
    entry: McpServerEntry
    baseDir?: string
  }): Promise<McpServerClient> {
    const existing = this.clients.get(options.registryKey)
    if (existing) {
      if (existing.isRunning()) {
        return existing
      }
      // 存在但已断开：先真正关闭旧连接再重建，直接丢弃引用会漏掉 transport
      await this.stopServer(options.registryKey)
    }

    const client = this.createServerClient(options.serverName, options.entry, options.baseDir)
    await client.connect()
    this.clients.set(options.registryKey, client)
    this.lastErrors.delete(options.registryKey)
    return client
  }

  /**
   * 按需启动 session 级自定义 MCP 服务器
   *
   * 旧实现在 pi-tools-bridge 里直接 new McpServerClient 并 connect，
   * 客户端只存在局部变量、不进连接池，而 bundle 的 dispose 又是空实现，
   * 于是每轮发送都新建一条连接且永不回收。现在统一登记进连接池，
   * 既能跨轮复用，也能在 shutdown 时被一起关闭。
   */
  async ensureCustomServer(options: {
    registryKey: string
    serverName: string
    entry: McpServerEntry
    baseDir?: string
  }): Promise<McpServerClient> {
    return this.startServerAs(options)
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

  /**
   * 配置变更时重新加载
   *
   * 停止被移除 / 被禁用 / 连接参数已变更的服务器，再启动缺失的服务器。
   * 旧实现只比对「是否存在、是否启用」，改了已启用服务器的 command/args/env/url
   * 之后不会重连，用户必须重启应用才能生效；现在按连接指纹做结构化对比。
   */
  async reload(config: WorkspaceMcpConfig): Promise<void> {
    const servers = config.servers ?? {}
    const globalAgentDir = getGlobalAgentConfigDir()

    // 复制键快照，避免在遍历过程中删除条目
    for (const registryKey of [...this.clients.keys()]) {
      // session 级自定义连接不受全局配置控制，跳过以免被误停
      if (isCustomMcpRegistryKey(registryKey)) continue

      const entry = servers[registryKey]
      if (!entry || entry.enabled === false) {
        log.info(`[MCP] 配置变更，停止服务器 ${registryKey}`)
        await this.stopServer(registryKey)
        continue
      }

      const client = this.clients.get(registryKey)
      if (client && buildMcpConnectionSignature(client.entry) !== buildMcpConnectionSignature(entry)) {
        log.info(`[MCP] 服务器 ${registryKey} 连接参数变更，重新连接`)
        await this.stopServer(registryKey)
      }
    }

    // 启动新增或需要重连的服务器
    for (const [name, entry] of Object.entries(servers)) {
      if (!entry.enabled || this.clients.has(name)) continue

      try {
        const validation = await validateMcpServer(name, entry)
        if (!validation.valid) {
          log.warn(`[MCP] 跳过无效服务器 ${name}: ${validation.reason ?? 'unknown'}`)
          continue
        }
        await this.startServer(name, entry, globalAgentDir)
      } catch (error) {
        log.warn(`[MCP] 重新加载服务器 ${name} 失败:`, error)
        this.lastErrors.set(name, error instanceof Error ? error.message : String(error))
      }
    }
  }

  /**
   * 关闭所有连接（应用退出时调用）
   *
   * 必须等所有 close 真正完成后再清空连接池：提前 clear 会丢掉客户端引用，
   * 未关闭的 stdio 子进程就再也没人能回收。
   */
  async shutdown(): Promise<void> {
    const entries = [...this.clients.entries()]
    log.info(`[MCP] 正在关闭所有连接，共 ${entries.length} 个...`)

    const results = await Promise.allSettled(entries.map(([, client]) => client.disconnect()))
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        log.warn(`[MCP] 关闭服务器 ${entries[index]?.[0] ?? 'unknown'} 失败:`, result.reason)
      }
    })

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
