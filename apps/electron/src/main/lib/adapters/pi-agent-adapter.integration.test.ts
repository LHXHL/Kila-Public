/**
 * Pi adapter 的真实 SDK 回归测试。
 *
 * 拦截全局 fetch 返回 OpenAI-compatible SSE，而非 mock Pi 内部对象，覆盖：
 * - ModelRuntime -> createAgentSession -> Pi stream 的完整调用链
 * - custom tool + Kila permission hook
 * - 同一 session 的 API Key 热更新
 * - Kila JSONL 历史首次导入 Pi sidecar，重启时不重复导入
 * - Pi Session sidecar 重启后的历史恢复
 */

import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { AgentEvent } from '@kila/shared'
import type { PiAgentQueryOptions } from './pi-agent-adapter'

interface RecordedRequest {
  authorization: string | null
  body: {
    messages?: Array<{ role?: string; content?: unknown }>
  }
}

function serializeSse(chunks: unknown[]): string {
  return [
    ...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`),
    'data: [DONE]\n\n',
  ].join('')
}

function textCompletion(text: string): string {
  return serializeSse([
    {
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'test-model',
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
    },
    {
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'test-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    },
  ])
}

async function collectEvents(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

async function resolveWithin<T>(promise: Promise<T>, timeoutMs = 3_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`操作未在 ${timeoutMs}ms 内结束`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

describe('PiAgentAdapter integration', () => {
  test('Given query 开始前 AbortSignal 已中止, When 调用 PiAgentAdapter.query, Then 不创建模型请求且事件流立即结束', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'kila-pi-pre-abort-config-'))
    const workspaceDir = mkdtempSync(join(tmpdir(), 'kila-pi-pre-abort-workspace-'))
    const originalConfigDir = process.env.KILA_CONFIG_DIR
    const originalFetch = globalThis.fetch
    let adapter: import('./pi-agent-adapter').PiAgentAdapter | undefined
    let requestCount = 0

    process.env.KILA_CONFIG_DIR = configDir
    globalThis.fetch = (async () => {
      requestCount += 1
      return new Response(textCompletion('不应到达'))
    }) as unknown as typeof fetch

    try {
      const { PiAgentAdapter } = await import('./pi-agent-adapter')
      adapter = new PiAgentAdapter()
      const controller = new AbortController()
      controller.abort()

      const input: PiAgentQueryOptions = {
        sessionId: 'pi-pre-aborted-session',
        prompt: '这个 prompt 不应发送。',
        model: 'test-model',
        cwd: workspaceDir,
        channel: { provider: 'custom', baseUrl: 'http://pi-pre-abort.invalid/v1' },
        apiKey: 'pre-abort-key',
        systemPrompt: '你是 Kila 测试 Agent。',
        tools: [],
        historyMessages: [],
        abortSignal: controller.signal,
      }
      const events = await collectEvents(adapter.query(input))

      expect(events).toEqual([])
      expect(requestCount).toBe(0)
    } finally {
      adapter?.dispose()
      globalThis.fetch = originalFetch
      if (originalConfigDir === undefined) {
        delete process.env.KILA_CONFIG_DIR
      } else {
        process.env.KILA_CONFIG_DIR = originalConfigDir
      }
      rmSync(configDir, { recursive: true, force: true })
      rmSync(workspaceDir, { recursive: true, force: true })
    }
  })

  test('Given OpenAI SSE fetch stub 和持久 session, When 调用工具、轮换密钥并重建 adapter, Then 使用官方 Pi runtime 完成流式、权限与恢复', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'kila-pi-integration-config-'))
    const workspaceDir = mkdtempSync(join(tmpdir(), 'kila-pi-integration-workspace-'))
    const originalConfigDir = process.env.KILA_CONFIG_DIR
    const requests: RecordedRequest[] = []
    let adapter: import('./pi-agent-adapter').PiAgentAdapter | undefined
    let restartedAdapter: import('./pi-agent-adapter').PiAgentAdapter | undefined

    process.env.KILA_CONFIG_DIR = configDir
    // Pi 默认会读取 agentDir 与 cwd 祖先目录中的 AGENTS.md / CLAUDE.md。
    // Kila 必须只注入自身构造的 system prompt，不能让这些 Pi 全局/项目资源越权进入。
    const globalPiContextMarker = 'KILA_PI_GLOBAL_CONTEXT_MUST_NOT_LEAK'
    const projectPiContextMarker = 'KILA_PI_PROJECT_CONTEXT_MUST_NOT_LEAK'
    mkdirSync(join(configDir, 'pi-agent'), { recursive: true })
    writeFileSync(join(configDir, 'pi-agent', 'AGENTS.md'), globalPiContextMarker)
    writeFileSync(join(workspaceDir, 'AGENTS.md'), projectPiContextMarker)

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      const headers = new Headers(input instanceof Request ? input.headers : init?.headers)
      const rawBody = typeof init?.body === 'string' ? init.body : ''
      requests.push({
        authorization: headers.get('authorization'),
        body: JSON.parse(rawBody) as RecordedRequest['body'],
      })

      if (url.pathname !== '/v1/chat/completions') {
        return new Response('unexpected endpoint', { status: 404 })
      }

      let body: string
      switch (requests.length) {
        case 1:
          body = serializeSse([
            {
              id: 'chatcmpl-tool',
              object: 'chat.completion.chunk',
              created: 0,
              model: 'test-model',
              choices: [{
                index: 0,
                delta: {
                  role: 'assistant',
                  tool_calls: [{
                    index: 0,
                    id: 'call_echo',
                    type: 'function',
                    function: {
                      name: 'echo_tool',
                      arguments: '{"value":"ping"}',
                    },
                  }],
                },
                finish_reason: null,
              }],
            },
            {
              id: 'chatcmpl-tool',
              object: 'chat.completion.chunk',
              created: 0,
              model: 'test-model',
              choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
            },
          ])
          break
        case 2:
          body = textCompletion('工具完成')
          break
        case 3:
          body = textCompletion('密钥已轮换')
          break
        case 4:
          body = textCompletion('会话已恢复')
          break
        default:
          return new Response('unexpected request', { status: 500 })
      }

      return new Response(body, {
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
        },
      })
    }) as unknown as typeof fetch

    try {
      const { PiAgentAdapter } = await import('./pi-agent-adapter')
      adapter = new PiAgentAdapter()
      const sessionId = 'pi-integration-session'
      const channel = {
        provider: 'custom' as const,
        baseUrl: 'http://pi-integration.invalid/v1',
      }
      const tool: AgentTool = {
        name: 'echo_tool',
        label: 'Echo tool',
        description: '返回输入值',
        parameters: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
        } as never,
        execute: async (_toolCallId, params) => ({
          content: [{ type: 'text', text: `echo:${String((params as { value?: unknown }).value)}` }],
          details: { source: 'integration-test' },
        }),
      }
      const permissionCalls: string[] = []
      const importedHistoryMarker = 'KILA_IMPORTED_HISTORY_MARKER'
      const importedAssistantMarker = 'KILA_IMPORTED_ASSISTANT_MARKER'
      const importedHistory = [
        {
          id: 'legacy-user-message',
          role: 'user' as const,
          content: importedHistoryMarker,
          createdAt: 1_700_000_000_000,
        },
        {
          id: 'legacy-assistant-message',
          role: 'assistant' as const,
          content: importedAssistantMarker,
          model: 'test-model',
          createdAt: 1_700_000_001_000,
        },
      ]
      const baseInput: Omit<PiAgentQueryOptions, 'prompt' | 'apiKey' | 'beforeToolCall'> = {
        sessionId,
        model: 'test-model',
        cwd: workspaceDir,
        channel,
        systemPrompt: '你是 Kila 测试 Agent。',
        tools: [tool],
        historyMessages: importedHistory,
      }

      const firstInput: PiAgentQueryOptions = {
        ...baseInput,
        prompt: '请调用 echo 工具。',
        apiKey: 'first-key',
        beforeToolCall: async (context) => {
          permissionCalls.push(context.toolCall.name)
          return undefined
        },
      }
      const firstEvents = await collectEvents(adapter.query(firstInput))

      expect(firstEvents.filter((event) => event.type === 'text_delta').map((event) => event.text).join('')).toBe('工具完成')
      expect(firstEvents.some((event) => event.type === 'tool_start' && event.toolName === 'echo_tool')).toBe(true)
      expect(firstEvents.some((event) => event.type === 'tool_result' && event.result === 'echo:ping')).toBe(true)
      expect(firstEvents.some((event) => event.type === 'complete')).toBe(true)
      expect(permissionCalls).toEqual(['echo_tool'])
      expect(requests.slice(0, 2).map((request) => request.authorization)).toEqual([
        'Bearer first-key',
        'Bearer first-key',
      ])
      expect(requests[1]?.body.messages?.some((message) => message.role === 'tool')).toBe(true)
      const firstPayload = JSON.stringify(requests[0]?.body)
      expect(firstPayload).toContain('你是 Kila 测试 Agent。')
      expect(firstPayload).toContain(importedHistoryMarker)
      expect(firstPayload).toContain(importedAssistantMarker)
      expect(firstPayload).not.toContain(globalPiContextMarker)
      expect(firstPayload).not.toContain(projectPiContextMarker)

      const piSdk = await import('@earendil-works/pi-coding-agent')
      const firstSidecar = piSdk.SessionManager.continueRecent(
        workspaceDir,
        join(configDir, 'pi-sessions', sessionId),
      )
      const firstSidecarFile = firstSidecar.getSessionFile()
      expect(firstSidecarFile).toBeDefined()
      const firstSidecarRaw = readFileSync(firstSidecarFile!, 'utf8')
      expect(firstSidecarRaw).toContain('\"type\":\"session\"')
      expect(firstSidecarRaw).toContain('\"type\":\"model_change\"')
      expect(firstSidecarRaw).toContain('\"type\":\"thinking_level_change\"')
      expect(firstSidecarRaw).toContain(importedHistoryMarker)
      expect(firstSidecarRaw).toContain(importedAssistantMarker)

      const rotatedKeyInput: PiAgentQueryOptions = {
        ...baseInput,
        prompt: '确认当前密钥。',
        apiKey: 'rotated-key',
      }
      const rotatedKeyEvents = await collectEvents(adapter.query(rotatedKeyInput))
      expect(rotatedKeyEvents.filter((event) => event.type === 'text_delta').map((event) => event.text).join('')).toBe('密钥已轮换')
      expect(requests[2]?.authorization).toBe('Bearer rotated-key')

      adapter.dispose()
      adapter = undefined
      restartedAdapter = new PiAgentAdapter()
      const resumedInput: PiAgentQueryOptions = {
        ...baseInput,
        prompt: '确认 session 恢复。',
        apiKey: 'rotated-key',
      }
      const resumedEvents = await collectEvents(restartedAdapter.query(resumedInput))
      expect(resumedEvents.filter((event) => event.type === 'text_delta').map((event) => event.text).join('')).toBe('会话已恢复')
      expect(requests[3]?.authorization).toBe('Bearer rotated-key')
      const resumedPayload = JSON.stringify(requests[3]?.body.messages)
      expect(resumedPayload).toContain(importedHistoryMarker)
      expect(resumedPayload).toContain(importedAssistantMarker)
      expect(resumedPayload).toContain('请调用 echo 工具。')
      expect(resumedPayload).toContain('确认当前密钥。')

      const resumedSidecar = piSdk.SessionManager.continueRecent(
        workspaceDir,
        join(configDir, 'pi-sessions', sessionId),
      )
      const resumedSidecarFile = resumedSidecar.getSessionFile()
      expect(resumedSidecarFile).toBe(firstSidecarFile)
      const resumedSidecarRaw = readFileSync(resumedSidecarFile!, 'utf8')
      expect(resumedSidecarRaw.split(importedHistoryMarker).length - 1).toBe(1)
      expect(resumedSidecarRaw.split(importedAssistantMarker).length - 1).toBe(1)
      expect(resumedSidecar.getEntries().filter((entry) => entry.type === 'model_change')).toHaveLength(1)
      expect(resumedSidecar.getEntries().filter((entry) => entry.type === 'thinking_level_change')).toHaveLength(1)
    } finally {
      adapter?.dispose()
      restartedAdapter?.dispose()
      globalThis.fetch = originalFetch
      if (originalConfigDir === undefined) {
        delete process.env.KILA_CONFIG_DIR
      } else {
        process.env.KILA_CONFIG_DIR = originalConfigDir
      }
      rmSync(configDir, { recursive: true, force: true })
      rmSync(workspaceDir, { recursive: true, force: true })
    }
  })

  test('Given Kila permission 阻止工具, When Pi 请求 tool call, Then 工具不执行且错误结果继续交给 Pi 处理', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'kila-pi-permission-config-'))
    const workspaceDir = mkdtempSync(join(tmpdir(), 'kila-pi-permission-workspace-'))
    const originalConfigDir = process.env.KILA_CONFIG_DIR
    let adapter: import('./pi-agent-adapter').PiAgentAdapter | undefined
    let executeCount = 0
    let requestCount = 0

    process.env.KILA_CONFIG_DIR = configDir
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      requestCount += 1
      const body = requestCount === 1
        ? serializeSse([
          {
            id: 'chatcmpl-blocked-tool',
            object: 'chat.completion.chunk',
            created: 0,
            model: 'test-model',
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: 0,
                  id: 'call_blocked',
                  type: 'function',
                  function: { name: 'dangerous_tool', arguments: '{}' },
                }],
              },
              finish_reason: null,
            }],
          },
          {
            id: 'chatcmpl-blocked-tool',
            object: 'chat.completion.chunk',
            created: 0,
            model: 'test-model',
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
          },
        ])
        : textCompletion('权限策略已处理')
      return new Response(body, {
        headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      })
    }) as unknown as typeof fetch

    try {
      const { PiAgentAdapter } = await import('./pi-agent-adapter')
      adapter = new PiAgentAdapter()
      const tool: AgentTool = {
        name: 'dangerous_tool',
        label: 'Dangerous tool',
        description: '不应执行',
        parameters: { type: 'object', properties: {} } as never,
        execute: async () => {
          executeCount += 1
          return { content: [{ type: 'text', text: '不应到达这里' }], details: {} }
        },
      }
      const blockedInput: PiAgentQueryOptions = {
        sessionId: 'pi-permission-session',
        prompt: '调用危险工具。',
        model: 'test-model',
        cwd: workspaceDir,
        channel: { provider: 'custom', baseUrl: 'http://pi-permission.invalid/v1' },
        apiKey: 'permission-key',
        systemPrompt: '你是 Kila 测试 Agent。',
        tools: [tool],
        historyMessages: [],
        beforeToolCall: async () => ({ block: true, reason: '测试权限策略拒绝' }),
      }
      const events = await collectEvents(adapter.query(blockedInput))

      expect(executeCount).toBe(0)
      expect(events.some((event) => event.type === 'tool_start' && event.toolName === 'dangerous_tool')).toBe(true)
      expect(events.some((event) => event.type === 'tool_result' && event.isError && event.result.includes('测试权限策略拒绝'))).toBe(true)
      expect(events.filter((event) => event.type === 'text_delta').map((event) => event.text).join('')).toBe('权限策略已处理')
      expect(events.some((event) => event.type === 'complete')).toBe(true)

      const followUpEvents = await collectEvents(adapter.query({
        ...blockedInput,
        prompt: '确认不重复写入模型配置。',
      }))
      expect(followUpEvents.some((event) => event.type === 'complete')).toBe(true)
      expect(requestCount).toBe(3)

      const piSdk = await import('@earendil-works/pi-coding-agent')
      const sidecar = piSdk.SessionManager.continueRecent(
        workspaceDir,
        join(configDir, 'pi-sessions', blockedInput.sessionId),
      )
      expect(sidecar.getEntries().filter((entry) => entry.type === 'model_change')).toHaveLength(1)
      expect(sidecar.getEntries().filter((entry) => entry.type === 'thinking_level_change')).toHaveLength(1)
    } finally {
      adapter?.dispose()
      globalThis.fetch = originalFetch
      if (originalConfigDir === undefined) {
        delete process.env.KILA_CONFIG_DIR
      } else {
        process.env.KILA_CONFIG_DIR = originalConfigDir
      }
      rmSync(configDir, { recursive: true, force: true })
      rmSync(workspaceDir, { recursive: true, force: true })
    }
  })

  test('Given Pi 自动重试事件, When 映射到 Kila UI 事件, Then 保留重试历史和最终失败状态', async () => {
    const { mapPiEventToKilaEvents } = await import('./pi-agent-adapter')
    type PiRuntimeEvent = Parameters<typeof mapPiEventToKilaEvents>[0]

    const started = mapPiEventToKilaEvents({
      type: 'auto_retry_start',
      attempt: 2,
      maxAttempts: 3,
      delayMs: 1_500,
      errorMessage: 'provider overloaded',
    } as PiRuntimeEvent)
    expect(started).toHaveLength(2)
    expect(started[0]).toMatchObject({
      type: 'retrying',
      attempt: 2,
      maxAttempts: 3,
      delaySeconds: 1.5,
      reason: 'provider overloaded',
    })
    expect(started[1]).toMatchObject({
      type: 'retry_attempt',
      attemptData: {
        attempt: 2,
        reason: 'provider overloaded',
        errorMessage: 'provider overloaded',
        delaySeconds: 1.5,
      },
    })

    const failed = mapPiEventToKilaEvents({
      type: 'auto_retry_end',
      success: false,
      attempt: 3,
      finalError: 'retry budget exhausted',
    } as PiRuntimeEvent)
    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatchObject({
      type: 'retry_failed',
      finalAttempt: {
        attempt: 3,
        reason: 'retry budget exhausted',
        errorMessage: 'retry budget exhausted',
        delaySeconds: 0,
      },
    })

    expect(mapPiEventToKilaEvents({
      type: 'auto_retry_end',
      success: true,
      attempt: 1,
    } as PiRuntimeEvent)).toEqual([{ type: 'retry_cleared' }])
  })

  test('Given 已有 Pi session 历史, When 发送 /compact 指令, Then 执行 Pi 手动压缩且不将指令作为普通 prompt', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'kila-pi-compact-config-'))
    const workspaceDir = mkdtempSync(join(tmpdir(), 'kila-pi-compact-workspace-'))
    const originalConfigDir = process.env.KILA_CONFIG_DIR
    let adapter: import('./pi-agent-adapter').PiAgentAdapter | undefined
    let requestCount = 0
    const requestBodies: string[] = []

    process.env.KILA_CONFIG_DIR = configDir
    const originalFetch = globalThis.fetch
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      requestCount += 1
      requestBodies.push(typeof init?.body === 'string' ? init.body : '')
      const responseText = '压缩后的会话摘要'
      return Promise.resolve(new Response(textCompletion(responseText), {
        headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      }))
    }) as unknown as typeof fetch

    try {
      const { PiAgentAdapter } = await import('./pi-agent-adapter')
      adapter = new PiAgentAdapter()
      // Pi 0.80 默认保留最近 20k token；构造足够长的既有 Kila 历史，
      // 才能验证真正的压缩，而不是误把 SDK 的 "Nothing to compact" 当成功。
      const compressionHistory = [
        {
          id: 'old-user',
          role: 'user' as const,
          content: `旧任务输入：${'U'.repeat(100_000)}`,
          createdAt: 1,
        },
        {
          id: 'old-assistant',
          role: 'assistant' as const,
          content: `旧任务回复：${'A'.repeat(100_000)}`,
          createdAt: 2,
          model: 'test-model',
        },
      ]
      const input: PiAgentQueryOptions = {
        sessionId: 'pi-compact-session',
        prompt: '这段普通 prompt 不应该在手动压缩时发送给模型。',
        rawPrompt: '/compact 保留任务目标与关键文件变更',
        model: 'test-model',
        cwd: workspaceDir,
        channel: { provider: 'custom', baseUrl: 'http://pi-compact.invalid/v1' },
        apiKey: 'compact-key',
        systemPrompt: '你是 Kila 测试 Agent。',
        tools: [],
        historyMessages: compressionHistory,
      }

      const compactEvents = await collectEvents(adapter.query(input))
      expect(compactEvents.some((event) => event.type === 'compacting')).toBe(true)
      expect(compactEvents.some((event) => event.type === 'compact_complete' && event.reason === 'manual')).toBe(true)
      expect(compactEvents.some((event) => event.type === 'complete' && event.stopReason === 'compact')).toBe(true)
      expect(compactEvents.some((event) => event.type === 'compact_noop')).toBe(false)
      expect(requestCount).toBe(1)
      expect(requestBodies[0]).not.toContain('这段普通 prompt 不应该在手动压缩时发送给模型。')
    } finally {
      adapter?.dispose()
      globalThis.fetch = originalFetch
      if (originalConfigDir === undefined) {
        delete process.env.KILA_CONFIG_DIR
      } else {
        process.env.KILA_CONFIG_DIR = originalConfigDir
      }
      rmSync(configDir, { recursive: true, force: true })
      rmSync(workspaceDir, { recursive: true, force: true })
    }
  })

  test('Given 持续 SSE 请求, When Kila 终止 Pi runtime, Then 请求被取消、事件流收敛且 session 可复用', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'kila-pi-abort-config-'))
    const workspaceDir = mkdtempSync(join(tmpdir(), 'kila-pi-abort-workspace-'))
    const originalConfigDir = process.env.KILA_CONFIG_DIR
    let adapter: import('./pi-agent-adapter').PiAgentAdapter | undefined
    let requestCount = 0
    let resolveFirstRequestStarted: (() => void) | undefined
    const firstRequestStarted = new Promise<void>((resolve) => {
      resolveFirstRequestStarted = resolve
    })
    let firstRequestCancelled = false

    process.env.KILA_CONFIG_DIR = configDir
    const originalFetch = globalThis.fetch
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      requestCount += 1
      if (requestCount > 1) {
        return Promise.resolve(new Response(textCompletion('终止后可继续工作'), {
          headers: { 'content-type': 'text/event-stream; charset=utf-8' },
        }))
      }

      const request = input instanceof Request ? input : new Request(input, init)
      const encoder = new TextEncoder()
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const cancel = (): void => {
            firstRequestCancelled = true
            controller.error(new DOMException('Pi runtime aborted', 'AbortError'))
          }
          if (request.signal.aborted) {
            cancel()
          } else {
            request.signal.addEventListener('abort', cancel, { once: true })
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            id: 'chatcmpl-abort',
            object: 'chat.completion.chunk',
            created: 0,
            model: 'test-model',
            choices: [{
              index: 0,
              delta: { role: 'assistant', content: '正在执行' },
              finish_reason: null,
            }],
          })}\n\n`))
          resolveFirstRequestStarted?.()
        },
        cancel() {
          firstRequestCancelled = true
        },
      })
      return Promise.resolve(new Response(body, {
        headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      }))
    }) as unknown as typeof fetch

    try {
      const { PiAgentAdapter } = await import('./pi-agent-adapter')
      adapter = new PiAgentAdapter()
      const input: PiAgentQueryOptions = {
        sessionId: 'pi-abort-session',
        prompt: '开始一个可被终止的任务。',
        model: 'test-model',
        cwd: workspaceDir,
        channel: { provider: 'custom', baseUrl: 'http://pi-abort.invalid/v1' },
        apiKey: 'abort-key',
        systemPrompt: '你是 Kila 测试 Agent。',
        tools: [],
        historyMessages: [],
      }

      const abortedEventsPromise = collectEvents(adapter.query(input))
      await resolveWithin(firstRequestStarted)
      adapter.abort(input.sessionId)
      const abortedEvents = await resolveWithin(abortedEventsPromise)

      expect(firstRequestCancelled).toBe(true)
      expect(abortedEvents.some((event) => event.type === 'complete' || event.type === 'error' || event.type === 'typed_error')).toBe(true)

      const resumedEvents = await resolveWithin(collectEvents(adapter.query({
        ...input,
        prompt: '确认 runtime 仍可使用。',
      })))
      expect(resumedEvents.filter((event) => event.type === 'text_delta').map((event) => event.text).join('')).toBe('终止后可继续工作')
      expect(resumedEvents.some((event) => event.type === 'complete')).toBe(true)
      expect(requestCount).toBe(2)
    } finally {
      adapter?.dispose()
      globalThis.fetch = originalFetch
      if (originalConfigDir === undefined) {
        delete process.env.KILA_CONFIG_DIR
      } else {
        process.env.KILA_CONFIG_DIR = originalConfigDir
      }
      rmSync(configDir, { recursive: true, force: true })
      rmSync(workspaceDir, { recursive: true, force: true })
    }
  })
})
