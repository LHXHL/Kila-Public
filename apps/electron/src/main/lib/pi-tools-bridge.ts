/**
 * Pi tools bridge
 *
 * 将 Kila 现有内建能力包装为 Pi AgentTool。
 * 覆盖：
 * - 内置工具（web search、记忆、视觉、自定义 HTTP 工具、定时任务）
 * - 全局与 session 级 MCP 服务器工具
 *
 * MCP 连接本身由 `mcp-server-manager.ts` 的长连接池负责，这里只做「工具定义映射」。
 */

import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import type {
  AgentToolMeta,
  AgentToolsFileConfig,
  WorkspaceMcpConfig,
} from '@kila/shared'
import { Type } from '@sinclair/typebox'
import { getAgentToolsConfig } from './agent-tool-config'
import { getGlobalAgentMcpConfig } from './global-agent-config-manager'
import { getScheduledTaskRunContext, requestScheduledTaskExit } from './scheduled-task-context'
import { scheduledTaskManager } from './scheduled-task-singleton'
import { mcpServerManager } from './mcp-server-manager'
import type {
  McpServerClient,
  McpToolCallResult,
  McpToolDescriptor,
} from './mcp-server-manager'
import { buildCustomMcpRegistryKey, normalizeCustomMcpServers } from './mcp-server-entry'
import { validateMcpServer } from './mcp-validator'
import {
  ensureUniqueToolName,
  normalizeToolNameKey,
  type AnyAgentTool,
} from './agent-tool-names'
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
  createWebSearchTool?: () => AnyAgentTool | undefined
  createCustomHttpTools?: (options: CustomHttpToolOptions) => AnyAgentTool[]
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

export interface McpAgentToolOptions {
  cwd?: string
  /** 当前会话 id，用于给 session 级自定义 MCP 连接生成注册键 */
  sessionId?: string
  customMcpServers?: Record<string, unknown>
  /**
   * 已被内置工具占用的工具名。
   *
   * 调用方必须传入 Pi coding 工具 + Kila 内置工具的名字，
   * 否则 MCP 服务器暴露的 read/write/edit/bash 会在工具合并阶段静默顶替真实工具。
   */
  reservedToolNames?: Iterable<string>
}

export interface McpAgentToolDeps {
  getGlobalAgentMcpConfig?: () => WorkspaceMcpConfig
}

export interface McpAgentToolBundle {
  tools: AnyAgentTool[]
  dispose: () => Promise<void>
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

function stringifyToolResult(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

// ===== MCP 工具结果归一化（全仓唯一实现） =====

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
): AnyAgentTool {
  const visibleName = ensureUniqueToolName(tool.name, serverName, usedNames)
  if (visibleName !== tool.name) {
    log.warn(
      `[Pi MCP] MCP 工具 ${tool.name}（服务器 ${serverName}）与已占用的工具名冲突，`
      + `已降级为 ${visibleName}；原有工具保持不变`,
    )
  }

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

  // 预置内置工具名：冲突的 MCP 工具会自动降级为 {服务器名}__{工具名}，
  // 而不是在后续合并阶段顶替 Pi 的 read / bash / edit / write。
  const usedNames = new Set<string>()
  for (const reserved of options.reservedToolNames ?? []) {
    usedNames.add(normalizeToolNameKey(reserved))
  }

  const tools: AnyAgentTool[] = []

  const collectServerTools = async (serverName: string, client: McpServerClient): Promise<void> => {
    const serverTools = await client.listTools()
    for (const tool of serverTools) {
      tools.push(createMcpAgentToolFromManager(serverName, tool, client, usedNames))
    }
  }

  // 按服务器名排序后再分配可见名。
  // Object.entries 的键顺序跟着配置写入顺序走，直接依赖它会让同一个工具
  // 在不同启动之间拿到不同的可见名，历史 transcript 的工具匹配随之失配。
  // （残留限制：某台服务器掉线时它占用的名字会让给别人，恢复后仍可能换名，
  //   那属于「可见工具集合本身变了」，无法只靠排序消除。）
  const globalServers = Object.entries(getGlobalAgentMcpConfigFn().servers ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
  const customServers = Object.entries(normalizeCustomMcpServers(options.customMcpServers))
    .sort(([a], [b]) => a.localeCompare(b))

  // 全局服务器：直接复用长连接池里的客户端
  for (const [name, entry] of globalServers) {
    if (!entry.enabled) continue
    const client = mcpServerManager.getClient(name)
    if (!client?.isRunning()) {
      log.warn(`[Pi MCP] 全局服务器 ${name} 未运行，已跳过`)
      continue
    }

    try {
      await collectServerTools(name, client)
    } catch (error) {
      log.warn(`[Pi MCP] 从全局服务器 ${name} 获取工具失败:`, error)
    }
  }

  // session 级自定义服务器：先做安全校验，再按需连接并登记进连接池
  for (const [name, entry] of customServers) {
    if (!entry.enabled) continue

    const registryKey = buildCustomMcpRegistryKey(options.sessionId, name)
    let client = mcpServerManager.getClient(registryKey) ?? mcpServerManager.getClient(name)

    if (!client?.isRunning()) {
      // 这条路径过去完全绕过 validateMcpServer：
      // isSafeStdioCommand（拒绝 shell、拒绝含 ;&|`$<> 的命令）与 SSRF 防护对自定义服务器都不生效。
      const validation = await validateMcpServer(name, entry)
      if (!validation.valid) {
        log.warn(`[Pi MCP] 自定义服务器 ${name} 未通过安全校验，已跳过: ${validation.reason ?? 'unknown'}`)
        continue
      }

      try {
        client = await mcpServerManager.ensureCustomServer({
          registryKey,
          serverName: name,
          entry,
          baseDir: options.cwd,
        })
      } catch (error) {
        log.warn(`[Pi MCP] 自定义服务器 ${name} 连接失败，已跳过:`, error)
        continue
      }
    }

    try {
      await collectServerTools(name, client)
    } catch (error) {
      log.warn(`[Pi MCP] 从自定义服务器 ${name} 获取工具失败:`, error)
    }
  }

  return {
    tools,
    // 全局与自定义连接都登记在 McpServerManager 里，跨轮复用、随 shutdown 统一关闭，
    // 因此这里不做按轮销毁（旧实现的独立连接不受 manager 管理，才是真正的泄漏点）。
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
): AnyAgentTool | undefined {
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
): AnyAgentTool {
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
): AnyAgentTool[] {
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
): Promise<AnyAgentTool[]> {
  const createWebSearchToolFn = deps.createWebSearchTool ?? (() => createWebSearchTool())
  const createCustomHttpToolsFn = deps.createCustomHttpTools ?? ((customOptions) => createCustomHttpTools(customOptions))
  const getAgentToolsConfigFn = deps.getAgentToolsConfig ?? getAgentToolsConfig
  const config = getAgentToolsConfigFn()

  const tools: AnyAgentTool[] = []

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
}): AnyAgentTool[] {
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

export type {
  BuiltinAgentToolOptions,
}
