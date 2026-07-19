/**
 * Agent 权限服务
 *
 * 核心职责：
 * - 实现 canUseTool 回调（供 SDK query 使用）
 * - 管理 pending 权限请求（Promise + Map 模式）
 * - 维护会话级白名单
 * - 工具/命令分类判断
 *
 * 参考 Craft Agents OSS 的 Promise + Map 异步等待模式。
 */

import { randomUUID } from 'node:crypto'
import type {
  KilaPermissionMode,
  PermissionRequest,
  DangerLevel,
  AskUserRequest,
} from '@kila/shared'
import {
  SAFE_TOOLS,
  analyzeBashCommand,
  isSafeBashCommand,
  normalizeAgentToolName,
} from '@kila/shared'

/** SDK PermissionBehavior */
type PermissionBehavior = 'allow' | 'deny'

/** SDK PermissionUpdateDestination */
type PermissionUpdateDestination = 'userSettings' | 'projectSettings' | 'localSettings' | 'session' | 'cliArg'

/** SDK 权限规则值 */
interface PermissionRuleValue {
  toolName: string
  ruleContent?: string
}

/** SDK PermissionUpdate（匹配 SDK 0.2.63） */
export type PermissionUpdate = {
  type: 'addRules' | 'replaceRules' | 'removeRules'
  rules: PermissionRuleValue[]
  behavior: PermissionBehavior
  destination: PermissionUpdateDestination
} | {
  type: 'setMode'
  mode: string
  destination: PermissionUpdateDestination
} | {
  type: 'addDirectories' | 'removeDirectories'
  directories: string[]
  destination: PermissionUpdateDestination
}

/** SDK PermissionResult（匹配 SDK 0.2.63） */
export type PermissionResult = {
  behavior: 'allow'
  updatedInput?: Record<string, unknown>
  updatedPermissions?: PermissionUpdate[]
  toolUseID?: string
} | {
  behavior: 'deny'
  message: string
  interrupt?: boolean
  toolUseID?: string
}

/** canUseTool 回调的 options 参数（匹配 SDK CanUseTool） */
export interface CanUseToolOptions {
  signal: AbortSignal
  suggestions?: PermissionUpdate[]
  blockedPath?: string
  decisionReason?: string
  toolUseID: string
  agentID?: string
}

/** 待处理的权限请求 */
interface PendingPermission {
  resolve: (result: PermissionResult) => void
  request: PermissionRequest
  onResolved?: (resolution: PermissionResolution) => void
  timeoutId?: ReturnType<typeof setTimeout>
  cleanupAbort?: () => void
}

export interface PermissionResolution {
  requestId: string
  sessionId: string
  behavior: 'allow' | 'deny'
  resolution: 'user' | 'timeout' | 'session_end'
  request: PermissionRequest
}

export const PERMISSION_REQUEST_TIMEOUT_MS = 90_000

/** 会话级白名单 */
interface SessionWhitelist {
  /** 总是允许的工具名（如 'Write', 'Edit'） */
  allowedTools: Set<string>
  /** 总是允许的 Bash 基础命令（如 'git push', 'npm install'） */
  allowedBashCommands: Set<string>
}

/**
 * Agent 权限服务
 *
 * 单例模式，管理所有会话的权限状态。
 */
export class AgentPermissionService {
  constructor(private readonly requestTimeoutMs = PERMISSION_REQUEST_TIMEOUT_MS) {}

  /** 待处理的权限请求 Map（requestId → PendingPermission） */
  private pendingPermissions = new Map<string, PendingPermission>()

  /** 会话级白名单 Map（sessionId → SessionWhitelist） */
  private sessionWhitelists = new Map<string, SessionWhitelist>()

  /**
   * 创建 canUseTool 回调（绑定到特定会话和模式）
   *
   * 返回的函数签名匹配 SDK 的 CanUseTool 类型。
   */
  createCanUseTool(
    sessionId: string,
    mode: KilaPermissionMode,
    sendToRenderer: (request: PermissionRequest) => void,
    askUserHandler?: (sessionId: string, input: Record<string, unknown>, signal: AbortSignal, sendToRenderer: (request: AskUserRequest) => void) => Promise<PermissionResult>,
    sendAskUserToRenderer?: (request: AskUserRequest) => void,
    onResolved?: (resolution: PermissionResolution) => void,
  ): (toolName: string, input: Record<string, unknown>, options: CanUseToolOptions) => Promise<PermissionResult> {
    return async (toolName, input, options) => {
      const normalizedToolName = normalizeAgentToolName(toolName)

      // AskUserQuestion 拦截：委托给交互式问答服务
      if (normalizedToolName === 'AskUserQuestion' && askUserHandler && sendAskUserToRenderer) {
        return askUserHandler(sessionId, input, options.signal, sendAskUserToRenderer)
      }

      const allow = (): PermissionResult => ({ behavior: 'allow' as const, updatedInput: input })

      // 子代理不再绕过权限边界：只读工具可自动通过，写入/执行仍遵循当前模式。
      if (options.agentID && this.isReadOnlyTool(normalizedToolName, input)) {
        return allow()
      }

      // 自动模式：全部允许（理论上不会到这里，auto 模式使用 bypassPermissions）
      if (mode === 'auto') return allow()

      // Smart 模式：只读工具自动允许，其余请求确认
      if (mode === 'smart') {
        if (this.isReadOnlyTool(normalizedToolName, input)) return allow()
        if (this.isWhitelisted(sessionId, normalizedToolName, input)) return allow()
      }

      // 需要询问用户：构建请求并发送到 UI
      const request = this.buildPermissionRequest(sessionId, normalizedToolName, input, options)

      return new Promise<PermissionResult>((resolve) => {
        const timeoutId = setTimeout(() => {
          const pending = this.pendingPermissions.get(request.requestId)
          if (!pending) return

          pending.cleanupAbort?.()
          this.pendingPermissions.delete(request.requestId)
          pending.resolve({ behavior: 'deny' as const, message: '权限请求超时，已自动拒绝' })
          pending.onResolved?.({
            requestId: request.requestId,
            sessionId,
            behavior: 'deny',
            resolution: 'timeout',
            request,
          })
        }, this.requestTimeoutMs)

        // 如果 signal 被中止，自动拒绝
        const handleAbort = (): void => {
          const pending = this.pendingPermissions.get(request.requestId)
          if (!pending) return
          if (pending.timeoutId) clearTimeout(pending.timeoutId)
          pending.cleanupAbort?.()
          this.pendingPermissions.delete(request.requestId)
          pending.resolve({ behavior: 'deny' as const, message: '操作已中止' })
          pending.onResolved?.({
            requestId: request.requestId,
            sessionId,
            behavior: 'deny',
            resolution: 'session_end',
            request,
          })
        }
        const cleanupAbort = (): void => options.signal.removeEventListener('abort', handleAbort)
        this.pendingPermissions.set(request.requestId, {
          resolve,
          request,
          onResolved,
          timeoutId,
          cleanupAbort,
        })
        options.signal.addEventListener('abort', handleAbort, { once: true })

        // 必须先注册 pending，再通知渲染层，避免快速响应时主进程查不到请求。
        if (options.signal.aborted) {
          handleAbort()
          return
        }
        try {
          sendToRenderer(request)
        } catch (error) {
          const pending = this.pendingPermissions.get(request.requestId)
          if (!pending) return
          if (pending.timeoutId) clearTimeout(pending.timeoutId)
          pending.cleanupAbort?.()
          this.pendingPermissions.delete(request.requestId)
          const message = error instanceof Error ? error.message : String(error)
          pending.resolve({ behavior: 'deny', message: `无法显示权限请求：${message}` })
          pending.onResolved?.({
            requestId: request.requestId,
            sessionId,
            behavior: 'deny',
            resolution: 'session_end',
            request,
          })
        }
      })
    }
  }

  /**
   * 响应权限请求（由 IPC handler 调用）
   *
   * @returns 结构化 resolution 信息；未找到请求时返回 null
   */
  respondToPermission(requestId: string, behavior: 'allow' | 'deny', alwaysAllow: boolean): PermissionResolution | null {
    const pending = this.pendingPermissions.get(requestId)
    if (!pending) return null

    const sessionId = pending.request.sessionId
    if (pending.timeoutId) clearTimeout(pending.timeoutId)
    pending.cleanupAbort?.()

    // "总是允许"选项：加入会话白名单
    if (alwaysAllow && behavior === 'allow') {
      this.addToWhitelist(sessionId, pending.request.toolName, pending.request.toolInput)
    }

    pending.resolve(
      behavior === 'allow'
        ? { behavior: 'allow' as const, updatedInput: pending.request.toolInput }
        : { behavior: 'deny' as const, message: '用户拒绝了此操作' }
    )
    this.pendingPermissions.delete(requestId)
    const resolution: PermissionResolution = {
      requestId,
      sessionId,
      behavior,
      resolution: 'user',
      request: pending.request,
    }
    pending.onResolved?.(resolution)
    return resolution
  }

  /**
   * 清除指定会话的所有待处理请求（会话结束或中止时调用）
   */
  clearSessionPending(sessionId: string): void {
    for (const [requestId, pending] of this.pendingPermissions) {
      if (pending.request.sessionId === sessionId) {
        if (pending.timeoutId) clearTimeout(pending.timeoutId)
        pending.cleanupAbort?.()
        pending.resolve({ behavior: 'deny' as const, message: '会话已结束' })
        pending.onResolved?.({
          requestId,
          sessionId,
          behavior: 'deny',
          resolution: 'session_end',
          request: pending.request,
        })
        this.pendingPermissions.delete(requestId)
      }
    }
  }

  /**
   * 清除指定会话的白名单（会话结束时调用）
   */
  clearSessionWhitelist(sessionId: string): void {
    this.sessionWhitelists.delete(sessionId)
  }

  // ===== 工具分类判断 =====

  /**
   * 判断工具是否为只读操作（智能模式下自动允许）
   */
  private isReadOnlyTool(toolName: string, input: Record<string, unknown>): boolean {
    // 安全工具白名单
    if (SAFE_TOOLS.includes(toolName)) return true

    // Bash 工具：检查命令是否匹配安全模式
    if (toolName === 'Bash') {
      const command = typeof input.command === 'string' ? input.command : ''
      return isSafeBashCommand(command)
    }

    return false
  }

  /**
   * 判断工具/命令是否在会话白名单中
   */
  private isWhitelisted(sessionId: string, toolName: string, input: Record<string, unknown>): boolean {
    const whitelist = this.sessionWhitelists.get(sessionId)
    if (!whitelist) return false

    // 非 Bash 工具：检查工具名是否在白名单中
    if (toolName !== 'Bash') {
      return whitelist.allowedTools.has(toolName)
    }

    // Bash 工具：即使基础命令在白名单中，也要重新检查完整命令的安全性
    const command = typeof input.command === 'string' ? input.command : ''
    const analysis = analyzeBashCommand(command)
    if (analysis.hasStructure || analysis.isDangerous) return false
    const baseCommand = analysis.baseCommand || this.extractBaseCommand(command)
    return whitelist.allowedBashCommands.has(baseCommand)
  }

  /**
   * 将工具/命令加入会话白名单
   */
  private addToWhitelist(sessionId: string, toolName: string, input: Record<string, unknown>): void {
    const whitelist = this.getOrCreateWhitelist(sessionId)

    if (toolName !== 'Bash') {
      whitelist.allowedTools.add(toolName)
    } else {
      const command = typeof input.command === 'string' ? input.command : ''
      const baseCommand = this.extractBaseCommand(command)
      if (baseCommand) {
        whitelist.allowedBashCommands.add(baseCommand)
      }
    }
  }

  /**
   * 获取或创建会话白名单
   */
  private getOrCreateWhitelist(sessionId: string): SessionWhitelist {
    const existing = this.sessionWhitelists.get(sessionId)
    if (existing) return existing

    const whitelist: SessionWhitelist = {
      allowedTools: new Set(),
      allowedBashCommands: new Set(),
    }
    this.sessionWhitelists.set(sessionId, whitelist)
    return whitelist
  }

  /**
   * 提取 Bash 命令的基础命令（用于白名单匹配）
   *
   * 提取前两个词（如 "git push"、"npm install"）或第一个词（如 "ls"）。
   */
  private extractBaseCommand(command: string): string {
    const parts = command.trim().split(/\s+/)
    // 两词组合命令（git push, npm install 等）
    if (parts.length >= 2 && ['git', 'npm', 'bun', 'yarn', 'pnpm'].includes(parts[0]!)) {
      return `${parts[0]} ${parts[1]}`
    }
    return parts[0] ?? ''
  }

  /**
   * 构建权限请求对象
   */
  private buildPermissionRequest(
    sessionId: string,
    toolName: string,
    input: Record<string, unknown>,
    options: CanUseToolOptions,
  ): PermissionRequest {
    const command = toolName === 'Bash' && typeof input.command === 'string'
      ? input.command
      : undefined
    const commandAnalysis = command ? analyzeBashCommand(command) : undefined
    const createdAt = Date.now()

    return {
      requestId: randomUUID(),
      sessionId,
      createdAt,
      expiresAt: createdAt + PERMISSION_REQUEST_TIMEOUT_MS,
      toolName,
      toolInput: input,
      description: this.buildDescription(toolName, input),
      command,
      dangerLevel: this.assessDangerLevel(toolName, input),
      ...(commandAnalysis ? {
        riskScore: commandAnalysis.riskScore,
        riskReasons: commandAnalysis.reasons,
      } : {}),
      decisionReason: options.decisionReason,
    }
  }

  /**
   * 生成人类可读的操作描述
   */
  private buildDescription(toolName: string, input: Record<string, unknown>): string {
    switch (toolName) {
      case 'Bash':
        return typeof input.command === 'string'
          ? `执行命令: ${input.command.slice(0, 200)}`
          : '执行 Bash 命令'
      case 'Write':
        return typeof input.file_path === 'string'
          ? `写入文件: ${input.file_path}`
          : '写入文件'
      case 'Edit':
        return typeof input.file_path === 'string'
          ? `编辑文件: ${input.file_path}`
          : '编辑文件'
      case 'NotebookEdit':
        return typeof input.notebook_path === 'string'
          ? `编辑 Notebook: ${input.notebook_path}`
          : '编辑 Notebook'
      case 'Task':
        return typeof input.description === 'string'
          ? `启动子任务: ${input.description}`
          : '启动子任务'
      default:
        return `使用工具: ${toolName}`
    }
  }

  /**
   * 评估操作的危险等级
   */
  private assessDangerLevel(toolName: string, input: Record<string, unknown>): DangerLevel {
    if (toolName === 'Bash') {
      const command = typeof input.command === 'string' ? input.command : ''
      return analyzeBashCommand(command).dangerLevel
    }

    // 文件写入操作默认为 normal
    if (['Write', 'Edit', 'NotebookEdit'].includes(toolName)) return 'normal'

    // Task 工具默认为 normal
    if (toolName === 'Task') return 'normal'

    return 'normal'
  }
}

/** 全局权限服务实例 */
export const permissionService = new AgentPermissionService()
