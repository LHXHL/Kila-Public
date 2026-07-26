/**
 * Pi tools bridge
 *
 * 将 Kila 现有内建能力包装为 Pi AgentTool。
 * 覆盖：
 * - feishu group chat history tool
 * - global/custom MCP servers
 */

import { resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import type {
  AgentToolMeta,
  AgentToolsFileConfig,
  McpServerEntry,
  WorkspaceMcpConfig,
} from '@kila/shared'
import { Type } from '@sinclair/typebox'
import { getAgentToolsConfig } from './agent-tool-config'
import { getGlobalAgentMcpConfig } from './global-agent-config-manager'
import { getScheduledTaskRunContext, requestScheduledTaskExit } from './scheduled-task-context'
import { scheduledTaskManager } from './scheduled-task-singleton'
import { mcpServerManager, McpServerClient } from './mcp-server-manager'
import { createMemoryTools } from './tools/memory-tools'
import { createVisionTool } from './agent-tools/vision-tool'
import { memoryProviderManager } from './memory/provider-manager'
import {
  WEB_SEARCH_TOOL_DEFINITIONS,
  WEB_SEARCH_TOOL_META,
  executeWebSearchTool,
  isWebSearchAvailable,
} from './agent-tools/web-search-tool'
import { executeHttpTool } from './agent-tools/http-tool-executor'


import { createLogger } from './logger'
const log = createLogger('Pi MCP')

const FETCH_GROUP_CHAT_HISTORY_SCHEMA = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: 'Number of messages to fetch (default 20)' })),
  before_timestamp: Type.Optional(Type.Number({ description: 'Fetch messages before this timestamp in milliseconds' })),
})

interface BuiltinAgentToolOptions {
  sessionId: string
  cwd?: string
  enabledToolIds?: string[]
  /** 当前对话模型的能力（用于条件注册视觉工具） */
  modelAbilities?: { vision?: string }
  /** 当前会话的渠道/模型（用于视觉工具降级链） */
  sessionChannelId?: string
  sessionModelId?: string
}

interface BuiltinAgentToolDeps {
  createWebSearchTool?: () => AgentTool<any> | undefined
  createCustomHttpTools?: (options: CustomHttpToolOptions) => AgentTool<any>[]
  getAgentToolsConfig?: () => AgentToolsFileConfig
}

interface WebSearchToolDeps {
  executeWebSearchTool?: typeof executeWebSearchTool
  isWebSearchAvailable?: typeof isWebSearchAvailable
}

interface CustomHttpToolOptions {
  enabledToolIds?: string[]
}

interface CustomHttpToolDeps {
  executeHttpTool?: typeof executeHttpTool
  getAgentToolsConfig?: () => AgentToolsFileConfig
}

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

export interface McpAgentToolOptions {
  cwd?: string
  customMcpServers?: Record<string, unknown>
}

export interface McpAgentToolDeps {
  getGlobalAgentMcpConfig?: () => WorkspaceMcpConfig
}

export interface McpAgentToolBundle {
  tools: AgentTool<any>[]
  dispose: () => Promise<void>
}


interface FeishuChatMessage {
  messageId: string
  senderId: string
  senderType: 'user' | 'app' | 'anonymous' | 'unknown'
  senderName?: string
  msgType: string
  content: string
  createTime: number
}

interface FeishuChatHistoryToolOptions {
  chatId: string
  fetchHistory: (
    chatId: string,
    options: { pageSize?: number; beforeTimestamp?: number },
  ) => Promise<FeishuChatMessage[]>
  formatHistory: (messages: FeishuChatMessage[]) => string
}

const EXIT_SCHEDULED_TASK_SCHEMA = Type.Object({
  reason: Type.Optional(Type.String({ maxLength: 500, description: 'Why this scheduled task should stop.' })),
})

const SCHEDULED_TASK_MANAGE_SCHEMA = Type.Object({
  action: Type.Union([
    Type.Literal('list'),
    Type.Literal('get'),
    Type.Literal('create'),
    Type.Literal('update'),
    Type.Literal('delete'),
    Type.Literal('start'),
    Type.Literal('stop'),
    Type.Literal('run_now'),
    Type.Literal('list_runs'),
  ]),
  taskId: Type.Optional(Type.String({ description: 'Task id for get/update/delete/start/stop/run_now/list_runs.' })),
  task: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'ScheduledTaskCreateInput for create.' })),
  patch: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'ScheduledTaskUpdateInput for update.' })),
  reason: Type.Optional(Type.String({ maxLength: 500, description: 'Stop reason.' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: 'Run history limit.' })),
})

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

function stringifyToolResult(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function normalizeMcpServerEntry(value: unknown): McpServerEntry | undefined {
  if (!value || typeof value !== 'object') return undefined

  const entry = value as Record<string, unknown>
  const type = entry.type
  if (type !== 'stdio' && type !== 'http' && type !== 'sse') return undefined

  const normalized: McpServerEntry = {
    type,
    enabled: typeof entry.enabled === 'boolean' ? entry.enabled : true,
  }

  if (typeof entry.command === 'string') normalized.command = entry.command
  if (typeof entry.url === 'string') normalized.url = entry.url

  const args = normalizeStringArray(entry.args)
  if (args) normalized.args = args

  const env = normalizeStringRecord(entry.env)
  if (env) normalized.env = env

  const headers = normalizeStringRecord(entry.headers)
  if (headers) normalized.headers = headers

  if (typeof entry.timeout === 'number' && Number.isFinite(entry.timeout)) {
    normalized.timeout = entry.timeout
  }

  return normalized
}

export function normalizeCustomMcpServers(
  servers?: Record<string, unknown>,
): Record<string, McpServerEntry> {
  if (!servers) return {}

  const result: Record<string, McpServerEntry> = {}
  for (const [name, entry] of Object.entries(servers)) {
    const normalized = normalizeMcpServerEntry(entry)
    if (normalized) {
      result[name] = normalized
    } else {
      log.warn(`[Pi MCP] 忽略无效的 session 级 MCP 配置: ${name}`)
    }
  }
  return result
}

export function resolveConfiguredMcpServers(
  options: {
    customMcpServers?: Record<string, unknown>
  } = {},
): Record<string, McpServerEntry> {
  return {
    ...(getGlobalAgentMcpConfig().servers ?? {}),
    ...normalizeCustomMcpServers(options.customMcpServers),
  }
}

function resolveCommand(command: string, baseDir?: string): string {
  if (!baseDir) return command
  if (command.startsWith('.') || command.startsWith('/')) {
    return resolve(baseDir, command)
  }
  return command
}

/**
 * 构建 stdio MCP 传输的环境变量
 * 参考 deepchat 做法：保留全部 process.env，自定义 env 追加而非覆盖
 */
function buildStdioEnv(entry: McpServerEntry): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>

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

export function createMcpTransport(
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

async function connectMcpServer(
  options: McpServerConnectOptions,
): Promise<McpServerConnection> {
  const client = new Client({
    name: 'Kila',
    version: '0.1.0',
  }) as unknown as McpClientLike & { close: () => Promise<void>; connect: (transport: McpTransport) => Promise<void> }

  const transport = createMcpTransport(options.entry, {
    baseDir: options.baseDir,
  })
  const timeoutMs = options.entry.type === 'stdio'
    ? Math.max(1, options.entry.timeout ?? 30) * 1000
    : 30000

  await withTimeout(
    client.connect(transport),
    timeoutMs,
    `连接 MCP 服务器超时: ${options.name}`,
  )

  return {
    client,
    close: async () => {
      await client.close()
    },
  }
}

async function listAllMcpTools(client: McpClientLike): Promise<McpToolDescriptor[]> {
  const tools: McpToolDescriptor[] = []
  let cursor: string | undefined

  do {
    const page = await client.listTools(cursor ? { cursor } : undefined)
    tools.push(...(page.tools ?? []))
    cursor = page.nextCursor
  } while (cursor)

  return tools
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

function createMcpTextResult(text: string): TextContent {
  return { type: 'text', text }
}

function stringifyFallback(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function normalizeMcpToolContent(result: McpToolCallResult): Array<TextContent | ImageContent> {
  const normalized: Array<TextContent | ImageContent> = []

  for (const item of result.content ?? []) {
    if (item.type === 'text' && typeof item.text === 'string') {
      normalized.push({ type: 'text', text: item.text })
      continue
    }

    if (item.type === 'image' && typeof item.data === 'string' && typeof item.mimeType === 'string') {
      normalized.push({
        type: 'image',
        data: item.data,
        mimeType: item.mimeType,
      } satisfies ImageContent)
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

/**
 * 从 McpServerClient 创建 Agent 工具（长连接模式）
 * 工具 execute 直接调用客户端的 callTool，支持按需重连
 */
function createMcpAgentToolFromManager(
  serverName: string,
  tool: McpToolDescriptor,
  client: McpServerClient,
  usedNames: Set<string>,
): AgentTool<any> {
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

export async function getMcpAgentTools(
  options: McpAgentToolOptions,
  deps: McpAgentToolDeps = {},
): Promise<McpAgentToolBundle> {
  const getGlobalAgentMcpConfigFn = deps.getGlobalAgentMcpConfig ?? getGlobalAgentMcpConfig
  const usedNames = new Set<string>()
  const tools: AgentTool<any>[] = []

  const globalServers = getGlobalAgentMcpConfigFn().servers ?? {}
  const customServers = normalizeCustomMcpServers(options.customMcpServers)

  // 从全局服务器获取工具（使用长连接池中的客户端）
  for (const [name, entry] of Object.entries(globalServers)) {
    if (!entry.enabled) continue
    const client = mcpServerManager.getClient(name)
    if (!client?.isRunning()) {
      log.warn(`[Pi MCP] 全局服务器 ${name} 未运行，已跳过`)
      continue
    }

    try {
      const serverTools = await client.listTools()
      tools.push(
        ...serverTools.map((tool) => createMcpAgentToolFromManager(name, tool, client, usedNames)),
      )
    } catch (error) {
      log.warn(`[Pi MCP] 从全局服务器 ${name} 获取工具失败:`, error)
    }
  }

  // 自定义服务器按需连接（也通过 manager 或独立连接）
  for (const [name, entry] of Object.entries(customServers)) {
    if (!entry.enabled) continue

    let client = mcpServerManager.getClient(name)
    if (!client || !client.isRunning()) {
      // 自定义服务器未在 manager 中预连接，尝试创建并连接
      const independentClient = new McpServerClient(name, entry, options.cwd)
      try {
        await independentClient.connect()
        client = independentClient
      } catch (error) {
        log.warn(`[Pi MCP] 自定义服务器 ${name} 连接失败，已跳过:`, error)
        continue
      }
    }

    try {
      const serverTools = await client!.listTools()
      tools.push(
        ...serverTools.map((tool) => createMcpAgentToolFromManager(name, tool, client!, usedNames)),
      )
    } catch (error) {
      log.warn(`[Pi MCP] 从自定义服务器 ${name} 获取工具失败:`, error)
    }
  }

  return {
    tools,
    // dispose 不再做任何事，连接由 McpServerManager 长期管理
    dispose: async () => {},
  }
}

function isToolEnabled(
  toolId: string,
  config: AgentToolsFileConfig,
  enabledToolIds?: string[],
): boolean {
  if (enabledToolIds) {
    return enabledToolIds.includes(toolId)
  }

  return config.toolStates[toolId]?.enabled ?? false
}

function convertAgentToolMetaToParameters(meta: AgentToolMeta): Record<string, unknown> {
  const properties: Record<string, Record<string, unknown>> = {}
  const required: string[] = []

  for (const param of meta.params) {
    properties[param.name] = {
      type: param.type,
      description: param.description,
      ...(param.enum && param.enum.length > 0 ? { enum: param.enum } : {}),
    }

    if (param.required) {
      required.push(param.name)
    }
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  }
}

export function createWebSearchTool(
  deps: WebSearchToolDeps = {},
): AgentTool<any> | undefined {
  const executeWebSearchToolFn = deps.executeWebSearchTool ?? executeWebSearchTool
  const isWebSearchAvailableFn = deps.isWebSearchAvailable ?? isWebSearchAvailable

  if (!isWebSearchAvailableFn()) {
    return undefined
  }

  return {
    name: 'web_search',
    label: 'Web Search',
    description: WEB_SEARCH_TOOL_META.description,
    parameters: (WEB_SEARCH_TOOL_DEFINITIONS[0]?.parameters ?? { type: 'object' }) as never,
    execute: async (toolCallId, params) => {
      const args = params as Record<string, unknown>
      const result = await executeWebSearchToolFn({
        id: toolCallId,
        name: 'web_search',
        arguments: args,
      })

      if (result.isError) {
        throw new Error(result.content)
      }

      return {
        content: [{ type: 'text', text: result.content }],
        details: {
          ...(typeof args.query === 'string' ? { query: args.query } : {}),
        },
      }
    },
  }
}

function createCustomHttpAgentTool(
  meta: AgentToolMeta,
  executeHttpToolFn: typeof executeHttpTool,
): AgentTool<any> {
  return {
    name: meta.id,
    label: meta.name,
    description: meta.description,
    parameters: convertAgentToolMetaToParameters(meta) as never,
    execute: async (toolCallId, params) => {
      const result = await executeHttpToolFn({
        id: toolCallId,
        name: meta.id,
        arguments: params as Record<string, unknown>,
      }, meta)

      if (result.isError) {
        throw new Error(result.content)
      }

      return {
        content: [{ type: 'text', text: result.content }],
        details: {
          toolId: meta.id,
        },
      }
    },
  }
}

export function createCustomHttpTools(
  options: CustomHttpToolOptions = {},
  deps: CustomHttpToolDeps = {},
): AgentTool<any>[] {
  const config = (deps.getAgentToolsConfig ?? getAgentToolsConfig)()
  const executeHttpToolFn = deps.executeHttpTool ?? executeHttpTool

  return config.customTools
    .filter((meta) => meta.executorType === 'http' && meta.httpConfig)
    .filter((meta) => isToolEnabled(meta.id, config, options.enabledToolIds))
    .map((meta) => createCustomHttpAgentTool(meta, executeHttpToolFn))
}

export async function getBuiltinAgentTools(
  options: BuiltinAgentToolOptions,
  deps: BuiltinAgentToolDeps = {},
): Promise<AgentTool<any>[]> {
  const createWebSearchToolFn = deps.createWebSearchTool ?? (() => createWebSearchTool())
  const createCustomHttpToolsFn = deps.createCustomHttpTools ?? ((customOptions) => createCustomHttpTools(customOptions))
  const getAgentToolsConfigFn = deps.getAgentToolsConfig ?? getAgentToolsConfig
  const config = getAgentToolsConfigFn()

  const tools: AgentTool<any>[] = []

  if (isToolEnabled('web-search', config, options.enabledToolIds)) {
    const webSearchTool = createWebSearchToolFn()
    if (webSearchTool) {
      tools.push(webSearchTool)
    }
  }

  tools.push(...createCustomHttpToolsFn({
    enabledToolIds: options.enabledToolIds,
  }))

  // 记忆已收敛为仅 Nowledge：仅当 Nowledge 已配置且健康时才注册完整记忆工具，
  // 否则只保留 memory_status（未配置 Nowledge → 记忆功能禁用）。
  const memoryAvailable = await memoryProviderManager.getStatus()
    .then((status) => status.nowledgeConfigured && status.nowledgeHealthy)
    .catch(() => false)
  tools.push(...createMemoryTools({
    sessionId: options.sessionId,
    projectPath: options.cwd,
    backendAvailable: memoryAvailable,
  }))

  tools.push(createScheduledTaskManageTool())

  // 对话模型不支持视觉时，自动注册 analyze_image 工具
  if (options.modelAbilities?.vision !== 'supported') {
    tools.push(createVisionTool({
      sessionId: options.sessionId,
      sessionChannelId: options.sessionChannelId,
      sessionModelId: options.sessionModelId,
    }))
  }

  return tools
}

function requireTaskId(taskId: string | undefined): string {
  const trimmed = taskId?.trim()
  if (!trimmed) throw new Error('taskId is required for this action.')
  return trimmed
}

export function createScheduledTaskManageTool(): AgentTool<typeof SCHEDULED_TASK_MANAGE_SCHEMA> {
  return {
    name: 'scheduled_task_manage',
    label: 'Scheduled Task Manage',
    description: [
      'Manage Kila scheduled tasks from the agent runtime.',
      'Use list/get/list_runs before destructive changes. Use create/update with the same ScheduledTaskCreateInput/ScheduledTaskUpdateInput shape used by Kila settings.',
    ].join(' '),
    parameters: SCHEDULED_TASK_MANAGE_SCHEMA,
    execute: async (_toolCallId, params) => {
      let result: unknown

      switch (params.action) {
        case 'list':
          result = scheduledTaskManager.listTasks()
          break
        case 'get':
          result = scheduledTaskManager.getTask(requireTaskId(params.taskId))
          break
        case 'create': {
          let t = params.task
          if (typeof t === 'string') {
            try { t = JSON.parse(t) } catch { /* 保留原值，下方校验会拒绝 */ }
          }
          if (!t || typeof t !== 'object') throw new Error('task object is required.')
          result = await scheduledTaskManager.createTask(t as never)
          break
        }
        case 'update': {
          let p = params.patch
          if (typeof p === 'string') {
            try { p = JSON.parse(p) } catch { /* 保留原值，下方校验会拒绝 */ }
          }
          if (!p || typeof p !== 'object') throw new Error('patch object is required.')
          result = await scheduledTaskManager.updateTask(requireTaskId(params.taskId), p as never)
          break
        }
        case 'delete':
          await scheduledTaskManager.deleteTask(requireTaskId(params.taskId))
          result = { deleted: true, taskId: params.taskId }
          break
        case 'start':
          result = scheduledTaskManager.startTask(requireTaskId(params.taskId))
          break
        case 'stop':
          result = scheduledTaskManager.stopTask(requireTaskId(params.taskId), params.reason)
          break
        case 'run_now':
          await scheduledTaskManager.runTaskNow(requireTaskId(params.taskId))
          result = { queued: true, taskId: params.taskId }
          break
        case 'list_runs':
          result = scheduledTaskManager.listRuns(requireTaskId(params.taskId), params.limit)
          break
        default:
          throw new Error(`Unsupported scheduled task action: ${(params as { action?: unknown }).action}`)
      }

      return {
        content: [{ type: 'text', text: stringifyToolResult(result) }],
        details: {
          action: params.action,
          taskId: params.taskId,
        },
      }
    },
  }
}

export function createScheduledTaskRuntimeTools(options: {
  sessionId: string
}): AgentTool<any>[] {
  const context = getScheduledTaskRunContext(options.sessionId)
  if (!context?.aiCanExit) {
    return []
  }

  const exitTool: AgentTool<typeof EXIT_SCHEDULED_TASK_SCHEMA> = {
    name: 'exit_scheduled_task',
    label: 'Exit Scheduled Task',
    description: 'Stop the current scheduled task run when the work is complete or should not continue.',
    parameters: EXIT_SCHEDULED_TASK_SCHEMA,
    execute: async (_toolCallId, params) => {
      requestScheduledTaskExit(options.sessionId, params.reason)
      return {
        content: [{ type: 'text', text: `Scheduled task ${context.taskName} will stop after this run.` }],
        details: {
          taskId: context.taskId,
          reason: params.reason,
        },
      }
    },
  }

  return [exitTool]
}

export function createFeishuChatHistoryTools(
  options: FeishuChatHistoryToolOptions,
): AgentTool<any>[] {
  const fetchHistoryTool: AgentTool<typeof FETCH_GROUP_CHAT_HISTORY_SCHEMA> = {
      name: 'fetch_group_chat_history',
      label: 'Fetch Group Chat History',
      description: 'Fetch more Feishu group chat history when the current context is not enough.',
      parameters: FETCH_GROUP_CHAT_HISTORY_SCHEMA,
      execute: async (_toolCallId, params) => {
        const messages = await options.fetchHistory(options.chatId, {
          pageSize: params.limit,
          beforeTimestamp: params.before_timestamp,
        })

        if (messages.length === 0) {
          return {
            content: [{ type: 'text', text: '没有更多历史消息。' }],
            details: { count: 0 },
          }
        }

        const oldestTimestamp = messages[0]?.createTime ?? 0
        return {
          content: [{
            type: 'text',
            text: `${options.formatHistory(messages)}\n\n（如需更早的消息，使用 before_timestamp: ${oldestTimestamp}）`,
          }],
          details: {
            count: messages.length,
            oldestTimestamp,
          },
        }
      },
    }

  return [fetchHistoryTool]
}

export type {
  BuiltinAgentToolOptions,
  FeishuChatHistoryToolOptions,
}
