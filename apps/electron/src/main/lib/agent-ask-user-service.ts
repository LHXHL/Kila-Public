/**
 * Agent AskUserQuestion 交互式问答服务
 *
 * 核心职责：
 * - 拦截 AskUserQuestion 工具调用
 * - 解析问题列表，发送到渲染进程展示交互 UI
 * - 等待用户回答，通过 updatedInput 注入 answers 字段
 * - 管理 pending 请求生命周期
 *
 * 复用权限系统的 Promise + Map 异步等待模式。
 */

import { randomUUID } from 'node:crypto'
import type {
  AskUserRequest,
  AskUserQuestion,
  AskUserQuestionOption,
} from '@kila/shared'

/** canUseTool 返回的权限结果 */
type PermissionResult = {
  behavior: 'allow'
  updatedInput: Record<string, unknown>
} | {
  behavior: 'deny'
  message: string
}

/** 待处理的 AskUser 请求 */
interface PendingAskUser {
  resolve: (result: PermissionResult) => void
  request: AskUserRequest
  onResolved?: (resolution: AskUserResolution) => void
  timeoutId: ReturnType<typeof setTimeout>
  cleanupAbort: () => void
}

export interface AskUserResolution {
  requestId: string
  sessionId: string
  resolution: 'user' | 'timeout' | 'session_end'
  request: AskUserRequest
}

export const ASK_USER_REQUEST_TIMEOUT_MS = 90_000

/**
 * Agent AskUserQuestion 交互式问答服务
 *
 * 单例模式，管理所有会话的 AskUser 请求。
 */
export class AgentAskUserService {
  constructor(private readonly requestTimeoutMs = ASK_USER_REQUEST_TIMEOUT_MS) {}

  /** 待处理的 AskUser 请求 Map（requestId → PendingAskUser） */
  private pendingRequests = new Map<string, PendingAskUser>()

  /**
   * 处理 AskUserQuestion 工具调用
   *
   * 解析问题列表，发送到渲染进程，阻塞等待用户回答，
   * 回答后通过 updatedInput 注入 answers 字段。
   */
  handleAskUserQuestion(
    sessionId: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
    sendToRenderer: (request: AskUserRequest) => void,
    onResolved?: (resolution: AskUserResolution) => void,
  ): Promise<PermissionResult> {
    const questions = this.parseQuestions(input)
    const createdAt = Date.now()
    const request: AskUserRequest = {
      requestId: randomUUID(),
      sessionId,
      createdAt,
      expiresAt: createdAt + this.requestTimeoutMs,
      questions,
      toolInput: input,
    }

    return new Promise<PermissionResult>((resolve) => {
      const settle = (
        result: PermissionResult,
        resolution: AskUserResolution['resolution'],
      ): void => {
        const pending = this.pendingRequests.get(request.requestId)
        if (!pending) return
        clearTimeout(pending.timeoutId)
        pending.cleanupAbort()
        this.pendingRequests.delete(request.requestId)
        pending.resolve(result)
        pending.onResolved?.({
          requestId: request.requestId,
          sessionId,
          resolution,
          request,
        })
      }

      const handleAbort = (): void => {
        settle({ behavior: 'deny', message: '操作已中止' }, 'session_end')
      }
      const timeoutId = setTimeout(() => {
        settle({ behavior: 'deny', message: '等待用户回答超时，已自动取消' }, 'timeout')
      }, this.requestTimeoutMs)
      const cleanupAbort = (): void => signal.removeEventListener('abort', handleAbort)

      this.pendingRequests.set(request.requestId, {
        resolve,
        request,
        onResolved,
        timeoutId,
        cleanupAbort,
      })
      signal.addEventListener('abort', handleAbort, { once: true })

      // 先注册 pending，再通知 UI，避免极快响应时请求尚未进入 Map。
      if (signal.aborted) {
        handleAbort()
        return
      }
      try {
        sendToRenderer(request)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        settle({ behavior: 'deny', message: `无法显示交互问题：${message}` }, 'session_end')
      }
    })
  }

  /**
   * 响应 AskUser 请求（由 IPC handler 调用）
   *
   * @returns 对应的 sessionId，用于向渲染进程发送 resolved 事件；未找到返回 null
   */
  respondToAskUser(requestId: string, answers: Record<string, string>): string | null {
    const pending = this.pendingRequests.get(requestId)
    if (!pending) return null

    const sessionId = pending.request.sessionId

    // 构建 updatedInput：保留原始输入 + 注入 answers
    const updatedInput: Record<string, unknown> = {
      ...pending.request.toolInput,
      answers,
    }

    clearTimeout(pending.timeoutId)
    pending.cleanupAbort()
    this.pendingRequests.delete(requestId)
    pending.resolve({
      behavior: 'allow' as const,
      updatedInput,
    })
    pending.onResolved?.({
      requestId,
      sessionId,
      resolution: 'user',
      request: pending.request,
    })
    return sessionId
  }

  /**
   * 清除指定会话的所有待处理 AskUser 请求
   */
  clearSessionPending(sessionId: string): void {
    for (const [requestId, pending] of this.pendingRequests) {
      if (pending.request.sessionId === sessionId) {
        clearTimeout(pending.timeoutId)
        pending.cleanupAbort()
        this.pendingRequests.delete(requestId)
        pending.resolve({ behavior: 'deny', message: '会话已结束' })
        pending.onResolved?.({
          requestId,
          sessionId,
          resolution: 'session_end',
          request: pending.request,
        })
      }
    }
  }

  /**
   * 从工具输入中解析问题列表
   *
   * SDK AskUserQuestion 工具输入格式：
   * { questions: [{ question, header, options: [{ label, description }], multiSelect }] }
   */
  private parseQuestions(input: Record<string, unknown>): AskUserQuestion[] {
    const rawQuestions = input.questions
    if (!Array.isArray(rawQuestions)) return []

    return rawQuestions.map((q: unknown): AskUserQuestion => {
      const raw = q as Record<string, unknown>
      const options = Array.isArray(raw.options)
        ? (raw.options as Array<Record<string, unknown>>).map((o): AskUserQuestionOption => ({
            label: typeof o.label === 'string' ? o.label : '',
            description: typeof o.description === 'string' ? o.description : undefined,
          }))
        : []

      return {
        question: typeof raw.question === 'string' ? raw.question : '',
        header: typeof raw.header === 'string' ? raw.header : undefined,
        options,
        multiSelect: raw.multiSelect === true,
      }
    })
  }
}

/** 全局 AskUser 服务实例 */
export const askUserService = new AgentAskUserService()
