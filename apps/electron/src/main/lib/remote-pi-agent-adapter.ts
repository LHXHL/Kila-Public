/**
 * Utility Process 版 Pi Agent 适配器。
 *
 * 主进程只负责：准备 transfer bundle、执行权限与工具 RPC、转发 AgentEvent。
 * Pi session、模型请求和 SDK 生命周期全部留在 Utility Process。
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type {
  AgentEvent,
  AgentProviderAdapter,
  RuntimeFatalPayloadV1,
  RuntimeMessageEnvelopeV1,
  RuntimeRunEventPayloadV1,
  RuntimeRunLifecyclePayloadV1,
  RuntimeRunRejectedPayloadV1,
  RuntimeRunStartPayloadV1,
  RuntimeRunSettledPayloadV1,
  RuntimeResetAckPayloadV1,
  RuntimeToolCallPayloadV1,
  RuntimeToolUpdateV1,
  RuntimeToolUpdateAckV1,
} from '@kila/shared'
import type { PiAgentQueryOptions } from './agent-query-types'
import type { AnyAgentTool } from './agent-tool-names'
import {
  createRuntimeTransferBundle,
  removeRuntimeTransferBundle,
} from './agent-runtime-transfer-store'
import { createElectronRuntimeSpawner } from './agent-runtime/electron-runtime-spawner'
import { RuntimeSupervisor } from './agent-runtime/runtime-supervisor'
import { createRuntimeTypedError, createRuntimeTypedErrorFromUnknown } from './agent-runtime/runtime-errors'
import { truncateUtf8Tail } from './agent-tools/coding/truncation'
import { createLogger } from './logger'
import { createRuntimeToolResultPayload } from './remote-pi-agent-tool-result'
import { RuntimeToolUpdateAggregator } from './remote-pi-agent-tool-update'
import {
  cleanupToolUpdateWaiters,
  createBeforeToolCallContext,
  createBootstrap,
  createPromptImageTransfer,
  createSessionRuntimeConfig,
  createToolDescriptors,
  extractTextContent,
  isToolUpdateConsumerStalled,
  normalizeDetails,
  runKey,
  waitForRunDone,
} from './remote-pi-agent-helpers'
import type {
  RemoteRun,
  SessionRuntimeConfig,
  ToolUpdateWaiter,
} from './remote-pi-agent-types'
const log = createLogger('Remote Pi Runtime')
const MAX_PENDING_TOOL_UPDATE_BYTES = 1024 * 1024
const TOOL_UPDATE_ACK_TIMEOUT_MS = 10_000
export interface RemotePiAgentAdapterOptions {
  entryPath?: string
  appBootId?: string
  supervisor?: RuntimeSupervisor
}
export class RemotePiAgentAdapter implements AgentProviderAdapter {
  readonly ownsRetry = true
  readonly supervisor: RuntimeSupervisor
  private readonly runs = new Map<string, RemoteRun>()
  private readonly completedRuns = new Map<string, RemoteRun>()
  private readonly runtimeConfigs = new Map<string, SessionRuntimeConfig>()
  private readonly resourceExhaustedSessions = new Set<string>()
  private readonly unresponsiveSessions = new Set<string>()
  private readonly idleSweepTimer: ReturnType<typeof setInterval>
  private readonly toolsBySession = new Map<string, Map<string, AnyAgentTool>>()
  constructor(options: RemotePiAgentAdapterOptions = {}) {
    this.supervisor = options.supervisor ?? new RuntimeSupervisor({
      entryPath: options.entryPath ?? join(__dirname, 'pi-runtime.cjs'),
      appBootId: options.appBootId,
      spawn: createElectronRuntimeSpawner(),
      onResourceAction: (sessionId, action, rssBytes) => {
        log.warn(`[Remote Pi Runtime] session=${sessionId} 资源动作=${action} rss=${rssBytes}`)
        if (action === 'dispose-hot-idle') void this.disposeSessionRuntime(sessionId)
        if (action === 'warn') {
          try {
            this.supervisor.postCommand(sessionId, 'runtime.compact_request', { sessionId })
          } catch (error) {
            log.warn(`[Remote Pi Runtime] session=${sessionId} 请求资源保护压缩失败:`, error)
          }
        }
        if (action === 'abort-and-kill') {
          this.resourceExhaustedSessions.add(sessionId)
          this.runs.get(sessionId)?.abortController.abort('runtime_resource_exhausted')
        }
      },
      onResourceSampleUnavailable: (sessionId, pid) => {
        log.warn(`[Remote Pi Runtime] session=${sessionId} pid=${pid ?? 'unknown'} RSS 指标不可用，仅执行进程数量预算`)
      },
      onUnresponsive: (sessionId) => {
        log.warn(`[Remote Pi Runtime] session=${sessionId} heartbeat 超时，准备终止 Runtime`)
        this.unresponsiveSessions.add(sessionId)
        this.runs.get(sessionId)?.abortController.abort('runtime_unresponsive')
      },
    })
    this.idleSweepTimer = setInterval(() => {
      this.supervisor.sweepHotIdle()
    }, 30_000)
    this.idleSweepTimer.unref?.()
  }
  async *query(input: PiAgentQueryOptions): AsyncIterable<AgentEvent> {
    if (input.abortSignal?.aborted) return
    const sessionId = input.sessionId
    const runId = input.runId ?? randomUUID()
    const toolDescriptors = createToolDescriptors(input.tools)
    const previousConfig = this.runtimeConfigs.get(sessionId)
    const runtimeConfig = createSessionRuntimeConfig(input, toolDescriptors, previousConfig)
    const currentRun = this.runs.get(sessionId)
    if (currentRun && previousConfig && previousConfig.configFingerprint !== runtimeConfig.configFingerprint) {
      yield {
        type: 'typed_error',
        error: createRuntimeTypedError('runtime_config_changed_while_active', '运行中的 Agent 配置已变化，请先停止当前运行'),
      }
      return
    }
    if (!currentRun && previousConfig && previousConfig.configFingerprint !== runtimeConfig.configFingerprint) {
      // Utility 内部的 AgentSession 只在 idle 时重建，sidecar 保留供新配置继续使用。
      await this.resetSession(sessionId)
    }
    this.runtimeConfigs.set(sessionId, runtimeConfig)
    const generation = this.supervisor.getSnapshot(sessionId)?.generation ?? 0
    const startPromise = this.supervisor.start(sessionId, generation, input.abortSignal)
    const queuePosition = this.supervisor.getQueuePosition(sessionId)
    if (queuePosition !== undefined) yield { type: 'runtime_queued', position: queuePosition }
    let ready: Awaited<typeof startPromise>
    try {
      ready = await startPromise
    } catch (error) {
      yield { type: 'typed_error', error: createRuntimeTypedErrorFromUnknown(error) }
      return
    }
    if (input.abortSignal?.aborted) {
      await this.supervisor.dispose(sessionId)
      return
    }
    const run = this.createRun(input, runId, generation, ready.bootId)
    this.runs.set(sessionId, run)
    this.toolsBySession.set(sessionId, run.tools)
    let runStarted = false
    try {
      const promptImageTransfer = createPromptImageTransfer(input)
      const bundle = createRuntimeTransferBundle({
        appBootId: this.supervisor.appBootId,
        sessionId,
        runId,
        generation,
        configRevision: runtimeConfig.configRevision,
        expiresAt: Date.now() + 10 * 60 * 1000,
        bootstrap: createBootstrap(input, runId, runtimeConfig, promptImageTransfer.references) as unknown as Record<string, unknown>,
        tools: toolDescriptors,
        attachments: promptImageTransfer.attachments,
      })
      run.bundlePath = bundle.bundlePath
      const startPayload: RuntimeRunStartPayloadV1 = {
        sessionId,
        runId,
        generation,
        bundlePath: bundle.bundlePath,
        manifestSha256: bundle.manifestSha256,
        configRevision: bundle.configRevision,
      }
      this.supervisor.postCommand(sessionId, 'run.start', startPayload)
      runStarted = true
      input.abortSignal?.addEventListener('abort', run.abortHandler, { once: true })
      while (!run.done || run.queue.length > 0) {
        if (run.queue.length === 0) {
          await new Promise<void>((resolve) => { run.notify = resolve })
          continue
        }
        const event = run.queue.shift()
        if (event) yield event
      }
    } catch (error) {
      if (!runStarted) run.done = true
      yield { type: 'typed_error', error: createRuntimeTypedErrorFromUnknown(error) }
    } finally {
      if (!run.done) {
        run.abortController.abort()
        try {
          this.postLifecycle(run, 'run.abort', { reason: 'consumer_cancelled' })
        } catch {
          // Runtime 已退出时无需重复发送 abort。
        }
        await waitForRunDone(run, 5_000)
      }
      input.abortSignal?.removeEventListener('abort', run.abortHandler)
      this.runs.delete(sessionId)
      this.toolsBySession.delete(sessionId)
      cleanupToolUpdateWaiters(run)
      if (run.settledReceived) {
        this.completedRuns.set(runKey(sessionId, runId), run)
      } else {
        run.unsubscribe()
        run.unsubscribeExit()
        if (run.bundlePath) removeRuntimeTransferBundle(run.bundlePath)
      }
    }
  }
  abort(sessionId: string): void {
    const run = this.runs.get(sessionId)
    if (run) {
      run.abortController.abort()
      this.postLifecycle(run, 'run.abort', { reason: 'user_abort' })
      return
    }
  }
  async steer(sessionId: string, message: { role: 'user'; content: string }): Promise<void> {
    const run = this.requireRun(sessionId)
    this.postLifecycle(run, 'run.steer', { content: message.content })
  }
  async followUp(sessionId: string, message: { role: 'user'; content: string }): Promise<void> {
    const run = this.requireRun(sessionId)
    this.postLifecycle(run, 'run.follow_up', { content: message.content })
  }
  async waitForIdle(sessionId: string): Promise<void> {
    const run = this.runs.get(sessionId)
    if (!run) return
    await new Promise<void>((resolve) => {
      if (run.done) resolve()
      else {
        const previous = run.notify
        run.notify = () => {
          previous?.()
          resolve()
        }
      }
    })
  }
  async resetSession(sessionId: string): Promise<void> {
    const snapshot = this.supervisor.getSnapshot(sessionId)
    if (!snapshot || snapshot.state !== 'ready') return

    const reset = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe()
        reject(new Error('runtime_unresponsive: 等待 Runtime reset_ack 超时'))
      }, 5_000)
      timer.unref?.()
      const unsubscribe = this.supervisor.subscribe(sessionId, (message) => {
        if (message.type !== 'runtime.reset_ack') return
        const payload = message.payload as RuntimeResetAckPayloadV1
        if (payload.sessionId !== sessionId || payload.bootId !== snapshot.bootId) return
        clearTimeout(timer)
        unsubscribe()
        if (payload.ok) resolve()
        else reject(new Error(`runtime_start_failed: Runtime reset 失败: ${payload.message ?? '未知错误'}`))
      })
      try {
        this.supervisor.postCommand(sessionId, 'runtime.reset_session', { sessionId })
      } catch (error) {
        clearTimeout(timer)
        unsubscribe()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    await reset
  }
  async disposeSessionRuntime(sessionId: string): Promise<void> {
    const run = this.runs.get(sessionId)
    run?.abortController.abort()
    await this.supervisor.dispose(sessionId)
    if (run?.bundlePath) removeRuntimeTransferBundle(run.bundlePath)
    for (const [key, completed] of this.completedRuns) {
      if (completed.sessionId !== sessionId) continue
      this.rejectPersistedWaiter(completed, 'Session Runtime 已释放')
      completed.unsubscribe()
      completed.unsubscribeExit()
      if (completed.bundlePath) removeRuntimeTransferBundle(completed.bundlePath)
      this.completedRuns.delete(key)
    }
    this.runs.delete(sessionId)
    this.toolsBySession.delete(sessionId)
    this.runtimeConfigs.delete(sessionId)
    this.resourceExhaustedSessions.delete(sessionId)
    this.unresponsiveSessions.delete(sessionId)
  }
  async dispose(): Promise<void> {
    clearInterval(this.idleSweepTimer)
    await this.supervisor.disposeAll()
    for (const run of this.runs.values()) {
      if (run.bundlePath) removeRuntimeTransferBundle(run.bundlePath)
    }
    this.runs.clear()
    for (const completed of this.completedRuns.values()) {
      this.rejectPersistedWaiter(completed, 'Agent Runtime 已释放')
      completed.unsubscribe()
      completed.unsubscribeExit()
      if (completed.bundlePath) removeRuntimeTransferBundle(completed.bundlePath)
    }
    this.completedRuns.clear()
    this.toolsBySession.clear()
    this.runtimeConfigs.clear()
    this.resourceExhaustedSessions.clear()
    this.unresponsiveSessions.clear()
  }

  private createRun(input: PiAgentQueryOptions, runId: string, generation: number, bootId: string): RemoteRun {
    const run: RemoteRun = {
      sessionId: input.sessionId,
      runId,
      generation,
      bootId,
      query: input,
      tools: new Map(input.tools.map((tool) => [`pi/${tool.name}`, tool])),
      abortController: new AbortController(),
      queue: [],
      done: false,
      eventSequence: 0,
      toolUpdateSequences: new Map(),
      toolUpdateWaiters: new Map(),
      pendingToolUpdateBytes: new Map(),
      pendingToolStarts: new Map(),
      approvedToolInputs: new Map(),
      settledReceived: false,
      unsubscribe: () => undefined,
      unsubscribeExit: () => undefined,
      abortHandler: () => undefined,
    }
    run.abortHandler = () => {
      run.abortController.abort()
      this.postLifecycle(run, 'run.abort', { reason: 'user_abort' })
    }
    run.unsubscribe = this.supervisor.subscribe(input.sessionId, (message) => {
      this.handleRuntimeMessage(run, message)
    })
    run.unsubscribeExit = this.supervisor.subscribeExit(input.sessionId, (code) => {
      if (!run.done) {
        const resourceExhausted = this.resourceExhaustedSessions.delete(input.sessionId)
        const unresponsive = this.unresponsiveSessions.delete(input.sessionId)
        this.enqueue(run, {
          type: 'typed_error',
          error: createRuntimeTypedError(
            resourceExhausted ? 'runtime_resource_exhausted' : unresponsive ? 'runtime_unresponsive' : 'runtime_crashed',
            resourceExhausted
              ? 'Runtime RSS 连续超过硬预算，已终止本次运行'
              : unresponsive
                ? 'Runtime 心跳超时，已终止本次运行'
                : `Runtime 已退出 (${code})`,
          ),
        })
        run.done = true
        run.notify?.()
        run.notify = undefined
      }
      this.resourceExhaustedSessions.delete(input.sessionId)
      this.unresponsiveSessions.delete(input.sessionId)
    })
    return run
  }
  private handleRuntimeMessage(run: RemoteRun, message: RuntimeMessageEnvelopeV1): void {
    if (message.type === 'run.event') {
      const payload = message.payload as RuntimeRunEventPayloadV1
      if (payload.sessionId === run.sessionId && payload.runId === run.runId) {
        if (payload.eventSequence <= run.eventSequence) return
        if (payload.eventSequence !== run.eventSequence + 1) {
          this.failRunProtocol(run, `run.event eventSequence 失步: expected=${run.eventSequence + 1}, actual=${payload.eventSequence}`)
          return
        }
        run.eventSequence = payload.eventSequence
        if (payload.event.type === 'tool_start') {
          const approvedArgs = run.approvedToolInputs.get(payload.event.toolUseId)
          if (approvedArgs) {
            run.approvedToolInputs.delete(payload.event.toolUseId)
            this.enqueue(run, { ...payload.event, input: approvedArgs })
          } else {
            run.pendingToolStarts.set(payload.event.toolUseId, payload.event)
          }
        } else {
          this.enqueue(run, payload.event)
        }
      }
      return
    }
    if (message.type === 'run.submitted') {
      const payload = message.payload as RuntimeRunLifecyclePayloadV1
      if (payload.sessionId === run.sessionId && payload.runId === run.runId && run.bundlePath) {
        // Utility 已完成 bundle 校验和读取；输入文件不再需要，但要保留
        // tool-results 目录供本轮大结果继续通过受控引用回传。
        removeRuntimeTransferBundle(run.bundlePath, { preserveToolResults: true })
      }
      return
    }
    if (message.type === 'run.settled') {
      const payload = message.payload as RuntimeRunSettledPayloadV1
      if (payload.sessionId === run.sessionId && payload.runId === run.runId) {
        if (payload.finalEventSequence !== run.eventSequence) {
          this.failRunProtocol(run, `run.settled finalEventSequence 失步: expected=${run.eventSequence}, actual=${payload.finalEventSequence}`)
          return
        }
        run.settledReceived = true
        run.done = true
        run.notify?.()
        run.notify = undefined
      }
      return
    }
    if (message.type === 'run.rejected') {
      const payload = message.payload as RuntimeRunRejectedPayloadV1
      if (payload.sessionId === run.sessionId && payload.runId === run.runId) {
        this.enqueue(run, {
          type: 'typed_error',
          error: createRuntimeTypedError(payload.error.code, payload.error.message),
        })
        run.done = true
        run.notify?.()
        run.notify = undefined
      }
      return
    }
    if (message.type === 'run.persisted_ack') {
      const payload = message.payload as RuntimeRunLifecyclePayloadV1
      if (payload.sessionId === run.sessionId && payload.runId === run.runId) {
        const waiter = run.persistedWaiter
        if (waiter) {
          clearTimeout(waiter.timer)
          run.persistedWaiter = undefined
          waiter.resolve()
        }
        this.finishPersistedRun(run)
      }
      return
    }
    if (message.type === 'tool.call') {
      void this.handleToolCall(run, message.payload as RuntimeToolCallPayloadV1)
      return
    }
    if (message.type === 'tool.update_ack') {
      this.resolveToolUpdateAck(run, message.payload as RuntimeToolUpdateAckV1)
      return
    }
    if (message.type === 'runtime.fatal') {
      const payload = message.payload as RuntimeFatalPayloadV1
      this.enqueue(run, {
        type: 'typed_error',
        error: createRuntimeTypedError(payload.code, payload.message),
      })
      run.done = true
      run.notify?.()
      run.notify = undefined
    }
  }
  async markRunPersisted(
    sessionId: string,
    runId: string,
    lastMessageId?: string,
    options?: { requireSettledRun?: boolean },
  ): Promise<void> {
    const key = runKey(sessionId, runId)
    const run = this.completedRuns.get(key)
    if (!run) {
      // 宽松模式（终态收敛、外层重试）：rejected / 未 settle 的 run 合法缺席，保持 no-op
      if (!options?.requireSettledRun) return
      // 严格模式（续跑迭代间确认）：上一 run 表面结束却未 settle，协议不变量被破坏
      throw new Error(`runtime_protocol_desync: 上一 run 未 settle 却请求继续: ${runId}`)
    }
    const persisted = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        run.persistedWaiter = undefined
        reject(new Error('runtime_unresponsive: 等待 run.persisted_ack 超时'))
      }, 5_000)
      timer.unref?.()
      run.persistedWaiter = { resolve, reject, timer }
    })
    try {
      this.supervisor.postCommand(sessionId, 'run.persisted', {
        sessionId,
        runId,
        generation: run.generation,
        lastMessageId,
      })
      await persisted
    } catch (error) {
      if (run.persistedWaiter) {
        clearTimeout(run.persistedWaiter.timer)
        run.persistedWaiter = undefined
      }
      throw error
    }
  }
  private finishPersistedRun(run: RemoteRun): void {
    const key = runKey(run.sessionId, run.runId)
    run.unsubscribe()
    run.unsubscribeExit()
    if (run.bundlePath) removeRuntimeTransferBundle(run.bundlePath)
    this.completedRuns.delete(key)
    this.supervisor.markHotIdle(run.sessionId)
  }
  private rejectPersistedWaiter(run: RemoteRun, message: string): void {
    const waiter = run.persistedWaiter
    if (!waiter) return
    clearTimeout(waiter.timer)
    run.persistedWaiter = undefined
    waiter.reject(new Error(`runtime_unresponsive: ${message}`))
  }
  private async handleToolCall(run: RemoteRun, call: RuntimeToolCallPayloadV1): Promise<void> {
    const tool = run.tools.get(call.toolId) ?? run.tools.get(`pi/${call.toolName}`)
    if (!tool) {
      this.releaseToolStart(run, call)
      this.sendToolResult(run, call, `工具不存在: ${call.toolName}`, {}, true)
      return
    }
    let executionCall = call
    let updateAggregator: RuntimeToolUpdateAggregator | undefined
    try {
      const permission = await run.query.beforeToolCall?.(createBeforeToolCallContext(run, call), run.abortController.signal)
      const approvedArgs = permission?.updatedInput ?? call.requestedArgs
      executionCall = {
        ...call,
        approvedArgs,
        argsModified: approvedArgs !== call.requestedArgs,
      }
      run.approvedToolInputs.set(call.toolCallId, approvedArgs)
      this.releaseToolStart(run, executionCall)
      if (permission?.block) {
        this.sendToolResult(run, executionCall, permission.reason ?? '工具调用已被权限策略阻止', {}, true)
        return
      }
      let cumulativeBytes = 0
      let hasTruncatedUpdate = false
      const aggregator = new RuntimeToolUpdateAggregator(async (partialText) => {
        const updateSequence = (run.toolUpdateSequences.get(call.toolCallId) ?? 0) + 1
        run.toolUpdateSequences.set(call.toolCallId, updateSequence)
        cumulativeBytes += Buffer.byteLength(partialText, 'utf8')
        const update: RuntimeToolUpdateV1 = {
          ...executionCall,
          updateSequence,
          partialText,
          cumulativeBytes,
          ...(hasTruncatedUpdate ? { truncated: 'backpressure_limit' as const } : {}),
        }
        hasTruncatedUpdate = false
        await this.sendToolUpdate(run, executionCall, update)
      })
      updateAggregator = aggregator
      const result = await tool.execute(
        executionCall.toolCallId,
        executionCall.approvedArgs as never,
        run.abortController.signal,
        async (partial) => {
          const rawPartialText = extractTextContent(partial)
          // 给 envelope 和身份字段留出空间，避免单条工具更新越过 256KiB transport 上限。
          const boundedPartial = truncateUtf8Tail(rawPartialText, 240 * 1024)
          hasTruncatedUpdate ||= boundedPartial.truncation.truncated
          await aggregator.push(boundedPartial.text)
        },
      )
      await aggregator.close()
      const text = extractTextContent(result)
      this.sendToolResult(run, executionCall, text, normalizeDetails(result.details), false)
    } catch (error) {
      // 工具失败前已经产生的增量仍需先发出，避免 terminal result 领先于 update。
      // 发送失败时保留原错误，统一由本次运行终态收敛。
      try {
        await updateAggregator?.close()
      } catch {
        // ACK 超时已经触发 abort，运行终态会保留诊断信息。
      }
      this.releaseToolStart(run, executionCall)
      if (isToolUpdateConsumerStalled(error)) {
        this.enqueue(run, {
          type: 'typed_error',
          error: createRuntimeTypedError('tool_update_consumer_stalled', error.message),
        })
        return
      }
      this.sendToolResult(run, executionCall, error instanceof Error ? error.message : String(error), {}, true)
    }
  }
  private sendToolResult(
    run: RemoteRun,
    call: RuntimeToolCallPayloadV1,
    text: string,
    details: Record<string, unknown>,
    isError: boolean,
  ): void {
    this.supervisor.postCommand(
      run.sessionId,
      'tool.result',
      createRuntimeToolResultPayload(run, call, text, details, isError),
    )
  }
  private async sendToolUpdate(
    run: RemoteRun,
    call: RuntimeToolCallPayloadV1,
    update: RuntimeToolUpdateV1,
  ): Promise<void> {
    const waiters = run.toolUpdateWaiters.get(call.toolCallId) ?? new Map<number, ToolUpdateWaiter>()
    run.toolUpdateWaiters.set(call.toolCallId, waiters)
    while ((run.pendingToolUpdateBytes.get(call.toolCallId) ?? 0) >= MAX_PENDING_TOOL_UPDATE_BYTES) {
      const oldest = waiters.values().next().value as ToolUpdateWaiter | undefined
      if (!oldest) break
      await oldest.promise
    }
    const bytes = Buffer.byteLength(update.partialText, 'utf8')
    let resolveUpdate!: () => void
    let rejectUpdate!: (error: Error) => void
    const updatePromise = new Promise<void>((resolve, reject) => {
      resolveUpdate = resolve
      rejectUpdate = reject
    })
    const timer = setTimeout(() => {
      waiters.delete(update.updateSequence)
      run.pendingToolUpdateBytes.set(
        call.toolCallId,
        Math.max(0, (run.pendingToolUpdateBytes.get(call.toolCallId) ?? 0) - bytes),
      )
      rejectUpdate(new Error('tool_update_consumer_stalled: Runtime update ACK 超时'))
      run.abortController.abort()
      try {
        this.postLifecycle(run, 'run.abort', { reason: 'tool_update_consumer_stalled' })
      } catch {
        // Runtime 已退出时不再重复发送 abort。
      }
    }, TOOL_UPDATE_ACK_TIMEOUT_MS)
    timer.unref?.()
    waiters.set(update.updateSequence, { bytes, resolve: resolveUpdate, reject: rejectUpdate, promise: updatePromise, timer })
    run.pendingToolUpdateBytes.set(
      call.toolCallId,
      (run.pendingToolUpdateBytes.get(call.toolCallId) ?? 0) + bytes,
    )
    try {
      this.supervisor.postCommand(run.sessionId, 'tool.update', update)
    } catch (error) {
      clearTimeout(timer)
      waiters.delete(update.updateSequence)
      run.pendingToolUpdateBytes.set(
        call.toolCallId,
        Math.max(0, (run.pendingToolUpdateBytes.get(call.toolCallId) ?? 0) - bytes),
      )
      rejectUpdate(error instanceof Error ? error : new Error(String(error)))
    }
    await updatePromise
  }
  private resolveToolUpdateAck(run: RemoteRun, ack: RuntimeToolUpdateAckV1): void {
    if (ack.sessionId !== run.sessionId || ack.runId !== run.runId) return
    const waiters = run.toolUpdateWaiters.get(ack.toolCallId)
    const waiter = waiters?.get(ack.updateSequence)
    if (!waiter) return
    waiters?.delete(ack.updateSequence)
    clearTimeout(waiter.timer)
    run.pendingToolUpdateBytes.set(
      ack.toolCallId,
      Math.max(0, (run.pendingToolUpdateBytes.get(ack.toolCallId) ?? 0) - waiter.bytes),
    )
    if (ack.accepted) waiter.resolve()
    else waiter.reject(new Error('tool_update_consumer_stalled: Runtime 拒绝工具增量'))
    if (waiters?.size === 0) run.toolUpdateWaiters.delete(ack.toolCallId)
  }
  private postLifecycle(run: RemoteRun, type: string, extra: Record<string, unknown>): void {
    this.supervisor.postCommand(run.sessionId, type, {
      sessionId: run.sessionId,
      runId: run.runId,
      generation: run.generation,
      ...extra,
    })
  }
  private enqueue(run: RemoteRun, event: AgentEvent): void {
    run.queue.push(event)
    run.notify?.()
    run.notify = undefined
  }
  private failRunProtocol(run: RemoteRun, message: string): void {
    run.abortController.abort('runtime_protocol_desync')
    this.enqueue(run, {
      type: 'typed_error',
      error: createRuntimeTypedError('runtime_protocol_desync', message),
    })
    run.done = true
    run.notify?.()
    run.notify = undefined
    try {
      this.postLifecycle(run, 'run.abort', { reason: 'runtime_protocol_desync' })
    } catch {
      // Runtime 已退出时无需重复发送 abort。
    }
  }
  private releaseToolStart(run: RemoteRun, call: RuntimeToolCallPayloadV1): void {
    const pending = run.pendingToolStarts.get(call.toolCallId)
    if (!pending) return
    run.pendingToolStarts.delete(call.toolCallId)
    run.approvedToolInputs.delete(call.toolCallId)
    this.enqueue(run, { ...pending, input: call.approvedArgs })
  }
  private requireRun(sessionId: string): RemoteRun {
    const run = this.runs.get(sessionId)
    if (!run) throw new Error('当前会话没有可用的 Remote Pi runtime')
    return run
  }
}
