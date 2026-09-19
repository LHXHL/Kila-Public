/**
 * Pi Agent Runtime 适配器。
 *
 * 只在 Electron Utility Process 中创建 Pi AgentSession；主进程只使用 RemotePiAgentAdapter。
 */
import type {
  AgentState as PiAgentState,
  AgentTool,
  BeforeToolCallContext,
} from '@earendil-works/pi-agent-core'
import type { Api, AssistantMessage, Model } from '@earendil-works/pi-ai'
import type {
  AgentSession,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import type {
  AgentControlMessage,
  AgentEvent,
  AgentQueryInput,
  AgentProviderAdapter,
} from '@kila/shared'
import { inferApiTypeFromProvider } from '@kila/shared'
import type { PiAgentQueryOptions } from '../main/lib/agent-query-types'
import { convertHistoryToPiMessages } from '../main/lib/adapters/pi-history-converter'
import {
  deriveCompactionSettings,
  estimateCjkRatio,
  getCompactionNoopMessage,
  parseManualCompactCommand,
  toPiCompactionSettings,
  waitForCompactionToSettle,
} from '../main/lib/compaction-settings'
import { getPiAgentDir, getPiSessionDir } from '../main/lib/config-paths'
import {
  createKilaModelRuntime,
  updateKilaModelRuntimeApiKey,
  type KilaModelRuntime,
} from '../main/lib/adapters/pi-model-runtime'
import {
  createCacheAwareCompactionStreamFn,
  type PromptCacheRetention,
} from '../main/lib/adapters/pi-cache-aware-compaction'
import {
  findPersistedRuntimeContextFingerprint,
  materializeRuntimeContextPrompt,
  safeStableStringify,
  type RuntimeContextInjectionState,
} from '../main/lib/adapters/pi-runtime-context'
import { createLogger } from '../main/lib/logger'
import { loadExternalEsm } from '../main/lib/external-esm-loader'
import { buildPiModel, resolvePiThinkingLevel } from '../main/lib/adapters/pi-model-builder'
import { createPiEventMapper, mapPiErrorMessageToKilaEvent } from './pi-event-mapper'

const log = createLogger('Pi Agent')
type PiModel = Model<Api>
type PiAiModule = typeof import('@earendil-works/pi-ai')
type PiCodingAgentModule = typeof import('@earendil-works/pi-coding-agent')
let piAiModulePromise: Promise<PiAiModule> | undefined
let piCodingAgentModulePromise: Promise<PiCodingAgentModule> | undefined

export type { PiAgentQueryOptions } from '../main/lib/agent-query-types'

// Electron 主进程当前产物是 CJS，Pi 包是 ESM-only。
// 运行时必须使用原生动态 import，避免 bundle 产物生成 require('@earendil-works/...')。
export function loadPiAi(): Promise<PiAiModule> {
  piAiModulePromise ??= loadExternalEsm<PiAiModule>('@earendil-works/pi-ai')
  return piAiModulePromise
}
export function loadPiCodingAgent(): Promise<PiCodingAgentModule> {
  piCodingAgentModulePromise ??= loadExternalEsm<PiCodingAgentModule>('@earendil-works/pi-coding-agent')
  return piCodingAgentModulePromise
}


interface MutableRef<T> {
  current: T
}

interface PiRuntime extends RuntimeContextInjectionState {
  session: AgentSession
  signature: string
  modelRuntime: KilaModelRuntime
  beforeToolCallRef: MutableRef<PiAgentQueryOptions['beforeToolCall'] | undefined>
  getAgentStateRef: MutableRef<(() => PiAgentState) | undefined>
  /** 主进程资源预算超限时，在当前 prompt 安全结束后执行一次压缩。 */
  compactionRequested?: boolean
}

function createRuntimeSignature(options: PiAgentQueryOptions, model: PiModel): string {
  const toolSignature = options.tools
    .map((tool) => [
      tool.name,
      tool.description,
      safeStableStringify(tool.parameters),
    ].join(':'))
    .sort()
    .join('|')

  return JSON.stringify({
    cwd: options.cwd ?? '',
    // model.provider 可能经过 Pi/兼容层归一化；渠道类型仍需参与 runtime 身份，
    // 避免 custom/openai 在相同 Base URL 与模型 ID 下错误复用认证 Provider。
    channelProvider: options.channel.provider,
    channelApiType: options.channel.apiType ?? inferApiTypeFromProvider(options.channel.provider),
    capabilityProviderId: options.channel.capabilityProviderId ?? '',
    provider: model.provider,
    api: model.api,
    baseUrl: model.baseUrl ?? '',
    model: model.id,
    input: model.input,
    reasoning: model.reasoning,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    cost: model.cost,
    thinkingLevel: resolvePiThinkingLevel(options.thinkingLevel, options.thinking, options.effort),
    systemPrompt: options.systemPrompt,
    tools: toolSignature,
    compat: model.compat,
    promptCacheRetention: options.modelCompat?.promptCacheRetention ?? 'short',
  })
}

function resolvePromptCacheRetention(options: PiAgentQueryOptions): PromptCacheRetention {
  return options.modelCompat?.promptCacheRetention === 'long' ? 'long' : 'short'
}

function wrapToolsWithKilaPermission(
  tools: AgentTool[],
  beforeToolCallRef: MutableRef<PiAgentQueryOptions['beforeToolCall'] | undefined>,
  getAgentStateRef: MutableRef<(() => PiAgentState) | undefined>,
): AgentTool[] {
  return tools.map((tool) => ({
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      let approvedParams = params
      const beforeToolCall = beforeToolCallRef.current
      if (beforeToolCall) {
        const state = getAgentStateRef.current?.()
        const permission = await beforeToolCall({
          assistantMessage: {} as AssistantMessage,
          toolCall: {
            type: 'toolCall',
            id: toolCallId,
            name: tool.name,
            arguments: params,
          } as BeforeToolCallContext['toolCall'],
          args: params,
          context: {
            systemPrompt: state?.systemPrompt ?? '',
            messages: state?.messages ?? [],
            tools: state?.tools ?? tools,
          },
        }, signal)

        if (permission?.block) {
          throw new Error(permission.reason || '工具调用已被权限策略阻止')
        }
        approvedParams = permission?.updatedInput ?? params
      }

      return tool.execute(toolCallId, approvedParams, signal, onUpdate)
    },
  }))
}

function hasPiSessionMessages(sessionManager: SessionManager): boolean {
  return sessionManager.getEntries().some((entry) => (
    entry.type === 'message' ||
    entry.type === 'compaction' ||
    entry.type === 'branch_summary' ||
    entry.type === 'custom_message'
  ))
}

export class PiAgentAdapter implements AgentProviderAdapter {
  readonly ownsRetry = true
  private runtimes = new Map<string, PiRuntime>()

  private async disposeRuntime(sessionId: string, runtime: PiRuntime): Promise<void> {
    this.runtimes.delete(sessionId)
    try {
      await runtime.session.abort()
    } finally {
      runtime.session.abortCompaction()
      runtime.session.dispose()
    }
  }

  private async createRuntime(options: PiAgentQueryOptions, model: PiModel, signature: string): Promise<PiRuntime> {
    const [piAi, sdk] = await Promise.all([
      loadPiAi(),
      loadPiCodingAgent(),
    ])

    const cwd = options.cwd ?? process.cwd()
    const agentDir = getPiAgentDir()
    const sessionManager = sdk.SessionManager.continueRecent(cwd, getPiSessionDir(options.sessionId))
    const isNewPiSession = !hasPiSessionMessages(sessionManager)
    const persistedRuntimeContextFingerprint = findPersistedRuntimeContextFingerprint(sessionManager)
    if (isNewPiSession) {
      sessionManager.newSession({ id: options.sessionId })
    }

    const thinkingLevel = resolvePiThinkingLevel(options.thinkingLevel, options.thinking, options.effort)
    // 按模型窗口比例推导压缩预算，并按当前提示的语言特征补偿 CJK 低估；
    // 旧固定值 16384/20000 会让 8K 小窗口预算变负、让中文会话实际保留量超估 4 倍。
    const derivedCompaction = deriveCompactionSettings({
      contextWindowTokens: model.contextWindow,
      cjkRatio: estimateCjkRatio([options.rawPrompt]),
    })
    if (!derivedCompaction.enabled) {
      log.warn(`[Pi Agent] 模型 ${model.id} 上下文窗口过小（${derivedCompaction.contextWindowTokens}），已关闭自动压缩（${derivedCompaction.disabledReason}）`)
    }
    const settingsManager = sdk.SettingsManager.inMemory({
      compaction: toPiCompactionSettings(derivedCompaction),
      retry: {
        enabled: true,
        maxRetries: 3,
        baseDelayMs: 1000,
        provider: {
          // retry 由 AgentSession 统一拥有，禁止 provider 内部再嵌套重试。
          maxRetries: 0,
          maxRetryDelayMs: options.maxRetryDelayMs,
        },
      },
    })
    const resourceLoader = new sdk.DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      agentsFilesOverride: () => ({ agentsFiles: [] }),
      systemPromptOverride: () => options.systemPrompt,
    })
    await resourceLoader.reload()

    const modelRuntime = await createKilaModelRuntime({
      piAi,
      sdk,
      channel: options.channel,
      model,
      apiKey: options.apiKey,
    })
    const runtimeModel = modelRuntime.model

    const beforeToolCallRef: MutableRef<PiAgentQueryOptions['beforeToolCall'] | undefined> = {
      current: options.beforeToolCall,
    }
    const getAgentStateRef: MutableRef<(() => PiAgentState) | undefined> = {
      current: undefined,
    }
    const wrappedTools = wrapToolsWithKilaPermission(options.tools, beforeToolCallRef, getAgentStateRef)

    if (isNewPiSession) {
      const historyMessages = await convertHistoryToPiMessages(options.historyMessages ?? [], runtimeModel)
      if (historyMessages.length > 0) {
        sessionManager.appendModelChange(runtimeModel.provider, runtimeModel.id)
        sessionManager.appendThinkingLevelChange(thinkingLevel)
        for (const message of historyMessages) {
          sessionManager.appendMessage(message)
        }
      }
    } else {
      const sessionContext = sessionManager.buildSessionContext()
      if (
        !sessionContext.model ||
        sessionContext.model.provider !== runtimeModel.provider ||
        sessionContext.model.modelId !== runtimeModel.id
      ) {
        sessionManager.appendModelChange(runtimeModel.provider, runtimeModel.id)
      }
      if (sessionContext.thinkingLevel !== thinkingLevel) {
        sessionManager.appendThinkingLevelChange(thinkingLevel)
      }
    }

    const { session } = await sdk.createAgentSession({
      cwd,
      agentDir,
      modelRuntime: modelRuntime.modelRuntime,
      model: runtimeModel,
      thinkingLevel,
      settingsManager,
      resourceLoader,
      sessionManager,
      noTools: 'builtin',
      customTools: wrappedTools,
    })
    session.agent.toolExecution = 'sequential'
    const initialLlmMessages = await session.agent.convertToLlm(session.agent.state.messages)
    session.agent.streamFunction = createCacheAwareCompactionStreamFn({
      streamFn: session.agent.streamFunction,
      sessionId: options.sessionId,
      cacheRetention: resolvePromptCacheRetention(options),
      // 用 Pi 公开导出的 serializeConversation（动态加载），保证与 Pi 压缩协议字节级一致
      serializeConversation: sdk.serializeConversation,
      initialContext: {
        systemPrompt: session.agent.state.systemPrompt,
        messages: initialLlmMessages,
        tools: session.agent.state.tools,
      },
    })
    getAgentStateRef.current = () => session.agent.state
    session.setAutoCompactionEnabled(derivedCompaction.enabled)

    return {
      session,
      signature,
      modelRuntime,
      beforeToolCallRef,
      getAgentStateRef,
      runtimeContextFingerprint: persistedRuntimeContextFingerprint,
      runtimeContextNeedsRefresh: isNewPiSession || !persistedRuntimeContextFingerprint,
    }
  }

  private async getRuntime(options: PiAgentQueryOptions, model: PiModel): Promise<PiRuntime> {
    const signature = createRuntimeSignature(options, model)
    const existing = this.runtimes.get(options.sessionId)
    if (existing?.signature === signature) {
      await updateKilaModelRuntimeApiKey(existing.modelRuntime, options.apiKey)
      existing.beforeToolCallRef.current = options.beforeToolCall
      return existing
    }

    if (existing) {
      await this.disposeRuntime(options.sessionId, existing)
    }

    const runtime = await this.createRuntime(options, model, signature)
    this.runtimes.set(options.sessionId, runtime)
    return runtime
  }

  async *query(input: AgentQueryInput): AsyncIterable<AgentEvent> {
    const options = input as PiAgentQueryOptions
    const modelId = options.model

    // AbortSignal 可能在 runtime/model 初始化前就已中止。addEventListener 不会补发历史 abort，
    // 因此必须在任何 Pi 资源创建和 prompt 提交前主动检查，避免“已停止”仍发模型请求或执行工具。
    if (options.abortSignal?.aborted) return

    if (!modelId) {
      yield {
        type: 'error',
        message: '缺少模型 ID，无法启动 Pi Agent',
      }
      return
    }

    const hasImages = (options.promptImages?.length ?? 0) > 0
    // hasImages 为 true 时 buildPiModel 会强行 include image input，
    // 但 promptImages 为空（orchestrator 已拦截）时不应该强行开启
    const model = await buildPiModel(
      options.channel,
      modelId,
      options.modelMetadata,
      options.modelCapabilities,
      hasImages,
      options.modelProviderDbEntry,
      options.modelCompat,
    )
    const queue: AgentEvent[] = []
    let done = false
    let notify: (() => void) | null = null
    const runtime = await this.getRuntime(options, model)
    if (options.abortSignal?.aborted) {
      await runtime.session.abort()
      runtime.session.abortCompaction()
      return
    }
    const mapRuntimeEvent = createPiEventMapper({ contextWindow: model.contextWindow })

    const wake = (): void => {
      notify?.()
      notify = null
    }

    const unsubscribe = runtime.session.subscribe((event) => {
      if (event.type === 'compaction_end' && event.result) {
        // 压缩会重写请求历史，旧 snapshot 可能已被摘要覆盖；下一轮必须重建。
        runtime.runtimeContextNeedsRefresh = true
      }
      queue.push(...mapRuntimeEvent(event))
      wake()
    })

    const abortListener = (): void => {
      void runtime.session.abort().catch((error) => {
        log.warn('[Pi Agent] 中止 runtime 失败:', error)
      })
      runtime.session.abortCompaction()
    }
    options.abortSignal?.addEventListener('abort', abortListener, { once: true })
    // 防止 abort 恰好发生在上一次检查与 listener 注册之间。
    if (options.abortSignal?.aborted) abortListener()

    const manualCompactInstructions = parseManualCompactCommand(options.rawPrompt)
    const runPromise = (async () => {
      if (options.abortSignal?.aborted) return
      if (runtime.session.isCompacting) {
        await waitForCompactionToSettle(runtime.session, 120_000, options.abortSignal)
      }
      if (options.abortSignal?.aborted) return

      if (manualCompactInstructions !== null) {
        try {
          await runtime.session.compact(manualCompactInstructions || undefined)
          queue.push({ type: 'complete', stopReason: 'compact' })
        } catch (error) {
          // Pi 0.82.1 的 compact() 会先同步发送 compaction_end，再 reject Promise。
          // 错误/取消已经由 subscription 映射；这里再次 throw 会让外层 catch 重复发送错误。
          // `Nothing to compact` / `Already compacted` 只额外补产品终态，避免流式状态悬挂。
          if (getCompactionNoopMessage(error)) {
            queue.push({ type: 'complete', stopReason: 'compact_noop' })
          }
        }
        wake()
        return
      }

      // Pi 0.80.x 会在 AgentSession 内处理 provider retry 与 context overflow：
      // agent_end → retry/compact → continue → agent_settled。这里绝不能重复提交 prompt。
      if (options.abortSignal?.aborted) return
      await runtime.session.prompt(materializeRuntimeContextPrompt(runtime, options), {
        images: options.promptImages,
        expandPromptTemplates: false,
      })
      await waitForCompactionToSettle(runtime.session, 120_000, options.abortSignal)
      if (runtime.compactionRequested && !options.abortSignal?.aborted) {
        runtime.compactionRequested = false
        try {
          await runtime.session.compact('Runtime 内存接近预算上限，请在安全点压缩上下文。')
        } catch (error) {
          // 压缩请求是资源保护动作；Pi 已通过 compaction_end 负责映射失败和 noop。
          // 这里不覆盖原始 prompt 的成功/失败终态，避免把保护动作误报成新的运行失败。
          if (!getCompactionNoopMessage(error)) log.warn('[Pi Agent] 资源保护压缩失败:', error)
        }
      }
    })()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        // compact() 的 reject 已由 compaction_end 事件映射（compact_failed / compact_noop）；
        // noop 再 push 会重复发终态。只有 prompt 提交和其他非压缩异常才走通用错误映射。
        if (getCompactionNoopMessage(error)) return
        queue.push(mapPiErrorMessageToKilaEvent(message))
      })
      .finally(() => {
        // abort/异常路径不一定会收到 agent_settled；在标记 done 前补刷，
        // 这样消费循环仍能把最后的 usage/错误事件交给上层。
        queue.push(...mapRuntimeEvent.flush())
        done = true
        wake()
      })

    try {
      while (!done || queue.length > 0) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            notify = resolve
          })
          continue
        }

        const next = queue.shift()
        if (next) yield next
      }

      await runPromise
    } finally {
      unsubscribe()
      options.abortSignal?.removeEventListener('abort', abortListener)
    }
  }

  abort(sessionId: string): void {
    const runtime = this.runtimes.get(sessionId)
    if (!runtime) return
    void runtime.session.abort()
    runtime.session.abortCompaction()
  }

  async steer(sessionId: string, message: AgentControlMessage): Promise<void> {
    const runtime = this.runtimes.get(sessionId)
    if (!runtime) {
      throw new Error('当前会话没有可干预的 Pi runtime')
    }

    await runtime.session.steer(message.content)
  }

  async followUp(sessionId: string, message: AgentControlMessage): Promise<void> {
    const runtime = this.runtimes.get(sessionId)
    if (!runtime) {
      throw new Error('当前会话没有可 follow-up 的 Pi runtime')
    }

    await runtime.session.followUp(message.content)
  }

  async waitForIdle(sessionId: string): Promise<void> {
    const runtime = this.runtimes.get(sessionId)
    if (!runtime) return
    await runtime.session.agent.waitForIdle()
    await waitForCompactionToSettle(runtime.session)
  }

  async resetSession(sessionId: string): Promise<void> {
    const runtime = this.runtimes.get(sessionId)
    if (!runtime) return
    await this.disposeRuntime(sessionId, runtime)
  }

  /** 请求当前 prompt 在安全边界后压缩；不在工具或 Pi agent loop 中并发调用 compact。 */
  requestCompaction(sessionId: string): void {
    const runtime = this.runtimes.get(sessionId)
    if (runtime) runtime.compactionRequested = true
  }

  async disposeSessionRuntime(sessionId: string): Promise<void> {
    await this.resetSession(sessionId)
  }

  dispose(): void {
    const runtimes = [...this.runtimes.entries()]
    this.runtimes.clear()
    for (const [, runtime] of runtimes) {
      void runtime.session.abort().finally(() => {
        runtime.session.abortCompaction()
        runtime.session.dispose()
      })
    }
  }
}
