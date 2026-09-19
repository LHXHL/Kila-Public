/**
 * Kila Pi Runtime Utility Process 入口。
 *
 * Utility 进程只承载 Pi SDK 和会话状态；文件、MCP、权限等能力通过主进程
 * Tool RPC 使用。所有跨进程消息都经过版本、身份和分通道序列校验。
 */
import { randomUUID } from 'node:crypto'
import type {
  AgentEvent,
  ModelCapabilitiesOverride,
  ModelCompatOverride,
  ModelMetadataOverride,
  ProviderDbModel,
  RuntimeFatalPayloadV1,
  RuntimeHeartbeatPayloadV1,
  RuntimeHandshakePayloadV1,
  RuntimeMessageEnvelopeV1,
  RuntimeQueryBootstrapV1,
  RuntimeRunAbortPayloadV1,
  RuntimeRunControlPayloadV1,
  RuntimeRunEventPayloadV1,
  RuntimeRunLifecyclePayloadV1,
  RuntimeRunRejectedPayloadV1,
  RuntimeRunPersistedPayloadV1,
  RuntimeRunSettledPayloadV1,
  RuntimeRunStartPayloadV1,
  RuntimeResetAckPayloadV1,
  RuntimeResetSessionPayloadV1,
  RuntimeToolCallPayloadV1,
  RuntimeToolDescriptorV1,
  RuntimeToolResultPayloadV1,
  RuntimeToolUpdateV1,
  RuntimeToolUpdateAckV1,
  RuntimePromptImageReferenceV1,
  ErrorCode,
} from '@kila/shared'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { ImageContent } from '@earendil-works/pi-ai'
import { PiAgentAdapter } from './pi-agent-adapter'
import type { PiAgentQueryOptions } from '../main/lib/agent-query-types'
import type { PiQueryChannel } from '../main/lib/adapters/pi-model-builder'
import { readRuntimeToolResult, readRuntimeTransferBundle } from '../main/lib/agent-runtime-transfer-store'
import { RuntimeSequenceTracker } from '../main/lib/agent-runtime/runtime-transport'
import { recoverPiSidecar } from '../main/lib/agent-runtime/sidecar-recovery'
import { acquireSessionRuntimeLease, type SessionRuntimeLease } from '../main/lib/agent-runtime/session-runtime-lease'
import { writePiRunJournal } from '../main/lib/agent-run-receipt-store'
import { getCurrentProcessStartTime } from '../main/lib/agent-runtime/process-identity'

const runtimePort = process.parentPort
if (!runtimePort) throw new Error('pi-runtime 必须运行在 Electron Utility Process 中')

const bootId = randomUUID()
const parentPid = process.ppid
const commandSequence = new RuntimeSequenceTracker()
const agentAdapter = new PiAgentAdapter()
let controlSequence = 1
let transportEventSequence = 1
let runEventSequence = 1
let appBootId: string | undefined
let heartbeatTimer: ReturnType<typeof setInterval> | undefined
let activeRun: ActiveRun | undefined
let completedRun: ActiveRun | undefined
let knownConfigRevision: number | undefined
let knownConfigFingerprint: string | undefined
const parentWatchdog = setInterval(() => {
  if (parentPid <= 1) return
  try {
    process.kill(parentPid, 0)
  } catch {
    // 主进程消失时不再等待 IPC，直接退出；sidecar recovery 会保留 dirty 诊断。
    process.exit(0)
  }
}, 5_000)
parentWatchdog.unref?.()

interface PendingToolCall {
  resolve: (result: RuntimeToolResultPayloadV1) => void
  reject: (error: Error) => void
  cleanup: () => void
  onUpdate?: (update: RuntimeToolUpdateV1) => void | Promise<void>
  lastUpdateSequence: number
}

interface ActiveRun {
  sessionId: string
  runId: string
  generation: number
  bundlePath: string
  descriptors: Map<string, RuntimeToolDescriptorV1>
  pendingTools: Map<string, PendingToolCall>
  pendingToolPromises: Map<string, Promise<RuntimeToolResultPayloadV1>>
  completedToolResults: Map<string, RuntimeToolResultPayloadV1>
  abortController: AbortController
  settled: Promise<void>
  lease: SessionRuntimeLease
}

runtimePort.on('message', (event) => {
  const message = parseMessage(event.data)
  if (!message || message.channel !== 'command') {
    sendFatal('runtime_protocol_desync', 'Runtime 只接受 command channel 输入')
    return
  }
  if (commandSequence.accept(message.sequence) !== 'accepted') {
    sendFatal('runtime_protocol_desync', 'Runtime command sequence 失步')
    return
  }
  void handleCommand(message).catch((error: unknown) => {
    sendFatal('runtime_crashed', error instanceof Error ? error.message : String(error))
  })
})

async function handleCommand(message: RuntimeMessageEnvelopeV1): Promise<void> {
  if (message.type === 'runtime.handshake') {
    handleHandshake(message.payload as RuntimeHandshakePayloadV1)
    return
  }
  if (message.type === 'runtime.shutdown') {
    await handleShutdown()
    return
  }
  if (!appBootId) {
    sendFatal('runtime_handshake_failed', 'Runtime 尚未完成 handshake')
    return
  }
  if (message.type === 'run.start') {
    await handleRunStart(message.payload as RuntimeRunStartPayloadV1)
    return
  }
  if (message.type === 'runtime.reset_session') {
    await handleResetSession(message.payload as RuntimeResetSessionPayloadV1)
    return
  }
  if (message.type === 'run.persisted') {
    handleRunPersisted(message.payload as RuntimeRunPersistedPayloadV1)
    return
  }
  if (message.type === 'run.abort') {
    handleRunAbort(message.payload as RuntimeRunAbortPayloadV1)
    return
  }
  if (message.type === 'run.steer' || message.type === 'run.follow_up') {
    await handleRunControl(message.type, message.payload as RuntimeRunControlPayloadV1)
    return
  }
  if (message.type === 'runtime.compact_request') {
    handleRuntimeCompactRequest(message.payload as { sessionId?: string })
    return
  }
  if (message.type === 'tool.result') {
    await resolveToolResult(message.payload as RuntimeToolResultPayloadV1)
    return
  }
  if (message.type === 'tool.update') {
    await forwardToolUpdate(message.payload as RuntimeToolUpdateV1)
    return
  }
  sendFatal('runtime_protocol_desync', `未知 Runtime command: ${message.type}`)
}

function handleHandshake(payload: RuntimeHandshakePayloadV1): void {
  if (appBootId || !payload.appBootId || !payload.spawnNonce) {
    sendFatal('runtime_handshake_failed', '重复或非法 Runtime handshake')
    return
  }
  appBootId = payload.appBootId
  sendControl('runtime.ready', {
    protocolVersion: 1,
    appBootId,
    spawnNonce: payload.spawnNonce,
    bootId,
    pid: process.pid,
    runtimeVersion: process.versions.electron ?? 'electron-utility',
  })
  heartbeatTimer = setInterval(() => {
    const heartbeat: RuntimeHeartbeatPayloadV1 = {
      bootId,
      pid: process.pid,
      activeSessionCount: activeRun ? 1 : 0,
      rssBytes: process.memoryUsage().rss,
    }
    sendControl('runtime.heartbeat', heartbeat)
  }, 5_000)
  heartbeatTimer.unref?.()
}

async function handleRunStart(payload: RuntimeRunStartPayloadV1): Promise<void> {
  try {
    await handleRunStartInternal(payload)
  } catch (error) {
    const parsed = parsePreflightError(error)
    sendRunRejected(payload, parsed.code, parsed.message)
  }
}

async function handleRunStartInternal(payload: RuntimeRunStartPayloadV1): Promise<void> {
  if (activeRun) {
    sendFatal('runtime_protocol_desync', '同一个 Runtime 不允许并发 run.start')
    return
  }
  if (
    !payload.sessionId
    || !payload.runId
    || !Number.isInteger(payload.generation)
  ) {
    sendFatal('runtime_protocol_desync', 'run.start payload 非法')
    return
  }

  const bundle = readRuntimeTransferBundle({
    bundlePath: payload.bundlePath,
    expected: {
      appBootId: appBootId!,
      sessionId: payload.sessionId,
      runId: payload.runId,
      generation: payload.generation,
    },
    manifestSha256: payload.manifestSha256,
  })
  const bootstrap = validateBootstrap(bundle.bootstrap, payload)
  const toolDescriptors = parseToolDescriptors(bundle.tools)
  if (!toolDescriptors) {
    sendFatal('runtime_protocol_desync', 'Runtime transfer bundle 的工具清单非法')
    return
  }
  const descriptors = new Map(toolDescriptors.map((descriptor) => [descriptor.toolId, descriptor]))
  if (knownConfigRevision !== undefined) {
    if (payload.configRevision < knownConfigRevision) {
      sendRunRejected(payload, 'runtime_stale_config_revision', 'Runtime 收到过期的配置版本')
      return
    }
    if (payload.configRevision === knownConfigRevision && bootstrap.configFingerprint !== knownConfigFingerprint) {
      sendRunRejected(payload, 'runtime_config_revision_conflict', '相同配置版本对应了不同的 fingerprint')
      return
    }
    if (payload.configRevision > knownConfigRevision && bootstrap.configFingerprint !== knownConfigFingerprint) {
      await agentAdapter.resetSession(payload.sessionId)
    }
  }
  if (completedRun) {
    sendFatal('runtime_protocol_desync', '上一次 run 尚未完成产品持久化确认')
    return
  }
  const recovery = recoverPiSidecar(payload.sessionId, {
    appBootId: appBootId!,
    bootId,
    generation: payload.generation,
  })
  const safeProductMessageId = recovery.safeProductMessageId
  if (recovery.action !== 'clean') {
    bootstrap.historyMessages = historyThroughSafeBoundary(
      bootstrap.historyMessages,
      recovery.safeProductMessageId,
    )
  }
  const lease = acquireSessionRuntimeLease(payload.sessionId, {
    pid: process.pid,
    parentPid: process.ppid,
    processStartTime: getCurrentProcessStartTime(),
    appBootId: appBootId!,
    bootId,
    generation: payload.generation,
  })
  writePiRunJournal(payload.sessionId, {
    version: 1,
    sessionId: payload.sessionId,
    runId: payload.runId,
    state: 'preparing',
    appBootId: appBootId!,
    bootId,
    generation: payload.generation,
    safeProductMessageId,
    updatedAt: Date.now(),
  })
  knownConfigRevision = payload.configRevision
  knownConfigFingerprint = bootstrap.configFingerprint

  const run: ActiveRun = {
    sessionId: payload.sessionId,
    runId: payload.runId,
    generation: payload.generation,
    bundlePath: payload.bundlePath,
    descriptors,
    pendingTools: new Map(),
    pendingToolPromises: new Map(),
    completedToolResults: new Map(),
    abortController: new AbortController(),
    settled: Promise.resolve(),
    lease,
  }
  runEventSequence = 1
  activeRun = run
  sendControl('run.accepted', lifecyclePayload(run))
  run.settled = executeRun(run, bootstrap, bundle, safeProductMessageId)
  await run.settled
}

async function handleResetSession(payload: RuntimeResetSessionPayloadV1): Promise<void> {
  if (!payload.sessionId || (activeRun && activeRun.sessionId === payload.sessionId) || completedRun) {
    sendResetAck(payload.sessionId, false, 'Runtime 仍有未完成的 run，拒绝 reset')
    return
  }
  try {
    await agentAdapter.resetSession(payload.sessionId)
    sendResetAck(payload.sessionId, true)
  } catch (error) {
    sendResetAck(payload.sessionId, false, error instanceof Error ? error.message : String(error))
  }
}

async function executeRun(
  run: ActiveRun,
  bootstrap: RuntimeQueryBootstrapV1,
  bundle: ReturnType<typeof readRuntimeTransferBundle>,
  safeProductMessageId?: string,
): Promise<void> {
  try {
    const tools = [...run.descriptors.values()].map((descriptor) => createRemoteTool(run, descriptor))
    const queryOptions: PiAgentQueryOptions = {
      ...bootstrap,
      channel: bootstrap.channel as PiQueryChannel,
      historyMessages: bootstrap.historyMessages,
      promptImages: resolvePromptImages(bundle, bootstrap.promptImages),
      tools,
      abortSignal: run.abortController.signal,
      modelCapabilities: bootstrap.modelCapabilities as ModelCapabilitiesOverride | undefined,
      modelMetadata: bootstrap.modelMetadata as ModelMetadataOverride | undefined,
      modelProviderDbEntry: bootstrap.modelProviderDbEntry as ProviderDbModel | undefined,
      modelCompat: bootstrap.modelCompat as PiAgentQueryOptions['modelCompat'],
    }
    writePiRunJournal(run.sessionId, {
      version: 1,
      sessionId: run.sessionId,
      runId: run.runId,
      state: 'submitted',
      appBootId: appBootId!,
      bootId,
      generation: run.generation,
      safeProductMessageId,
      updatedAt: Date.now(),
    })
    sendControl('run.submitted', lifecyclePayload(run))
    for await (const event of agentAdapter.query(queryOptions)) sendRunEvent(run, event)
  } catch (error) {
    sendRunEvent(run, { type: 'error', message: error instanceof Error ? error.message : String(error) })
  } finally {
    for (const pending of run.pendingTools.values()) {
      pending.cleanup()
      pending.reject(new Error('Runtime run 已结束'))
    }
    run.pendingTools.clear()
    run.pendingToolPromises.clear()
    writePiRunJournal(run.sessionId, {
      version: 1,
      sessionId: run.sessionId,
      runId: run.runId,
      state: 'settled-awaiting-persist',
      appBootId: appBootId!,
      bootId,
      generation: run.generation,
      safeProductMessageId,
      updatedAt: Date.now(),
    })
    completedRun = run
    sendControl('run.settled', {
      ...lifecyclePayload(run),
      finalEventSequence: runEventSequence - 1,
    } satisfies RuntimeRunSettledPayloadV1)
    if (activeRun === run) activeRun = undefined
  }
}

function handleRunPersisted(payload: RuntimeRunPersistedPayloadV1): void {
  if (!completedRun || !matchesRun(completedRun, payload)) return
  writePiRunJournal(completedRun.sessionId, {
    version: 1,
    sessionId: completedRun.sessionId,
    runId: completedRun.runId,
    state: 'clean',
    safeProductMessageId: payload.lastMessageId,
    appBootId: appBootId!,
    bootId,
    generation: completedRun.generation,
    updatedAt: Date.now(),
  })
  completedRun.lease.release()
  sendControl('run.persisted_ack', lifecyclePayload(completedRun))
  completedRun = undefined
}

function handleRunAbort(payload: RuntimeRunAbortPayloadV1): void {
  if (!matchesActiveRun(payload)) return
  activeRun?.abortController.abort(payload.reason)
  agentAdapter.abort(payload.sessionId)
}

async function handleRunControl(type: 'run.steer' | 'run.follow_up', payload: RuntimeRunControlPayloadV1): Promise<void> {
  if (!matchesActiveRun(payload)) return
  if (type === 'run.steer') await agentAdapter.steer(payload.sessionId, { role: 'user', content: payload.content })
  else await agentAdapter.followUp(payload.sessionId, { role: 'user', content: payload.content })
}

function handleRuntimeCompactRequest(payload: { sessionId?: string }): void {
  if (!activeRun || payload.sessionId !== activeRun.sessionId) return
  agentAdapter.requestCompaction(activeRun.sessionId)
}

async function handleShutdown(): Promise<void> {
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  clearInterval(parentWatchdog)
  if (activeRun) {
    activeRun.abortController.abort('runtime_shutdown')
    agentAdapter.abort(activeRun.sessionId)
    await activeRun.settled
  }
  if (completedRun) {
    // 产品层若尚未来得及发送 run.persisted，保留 settled-awaiting-persist journal，
    // 只释放锁；下次启动将依据 receipt 决定修复还是 quarantine。
    completedRun.lease.release()
    completedRun = undefined
  }
  sendControl('runtime.shutdown_ack', { bootId, activeRunCount: activeRun ? 1 : 0 })
  setImmediate(() => process.exit(0))
}

function createRemoteTool(run: ActiveRun, descriptor: RuntimeToolDescriptorV1): AgentTool {
  return {
    name: descriptor.name,
    label: descriptor.label ?? descriptor.name,
    description: descriptor.description,
    parameters: descriptor.parameters as never,
    execute: async (toolCallId, params, signal, onUpdate) => {
      if (signal?.aborted || run.abortController.signal.aborted) throw new Error('工具调用已中止')
      const requestedArgs = asRecord(params)
      const payload: RuntimeToolCallPayloadV1 = {
        appBootId: appBootId!,
        bootId,
        sessionId: run.sessionId,
        generation: run.generation,
        runId: run.runId,
        toolId: descriptor.toolId,
        toolCallId,
        toolName: descriptor.name,
        requestedArgs,
        approvedArgs: requestedArgs,
        argsModified: false,
      }
      const result = await waitForToolResult(
        run,
        payload,
        onUpdate ? (value) => onUpdate(value as Parameters<NonNullable<typeof onUpdate>>[0]) : undefined,
      )
      if (result.isError) throw new Error(result.text)
      return {
        content: [{ type: 'text', text: result.text }],
        details: {
          ...(result.details ?? {}),
          ...(result.approvedArgs ? { kilaApprovedArgs: result.approvedArgs } : {}),
        },
      }
    },
  }
}

function waitForToolResult(
  run: ActiveRun,
  payload: RuntimeToolCallPayloadV1,
  onUpdate?: (value: unknown) => void | Promise<void>,
): Promise<RuntimeToolResultPayloadV1> {
  const completed = run.completedToolResults.get(payload.toolCallId)
  if (completed) return Promise.resolve(completed)
  const existing = run.pendingToolPromises.get(payload.toolCallId)
  if (existing) return existing

  const promise = new Promise<RuntimeToolResultPayloadV1>((resolve, reject) => {
    let pending: PendingToolCall
    const cleanup = (): void => {
      run.abortController.signal.removeEventListener('abort', abort)
    }
    const abort = (): void => {
      if (run.pendingTools.get(payload.toolCallId) !== pending) return
      run.pendingTools.delete(payload.toolCallId)
      cleanup()
      reject(new Error('工具调用已中止'))
    }
    pending = {
      resolve,
      reject,
      cleanup,
      lastUpdateSequence: 0,
      onUpdate: onUpdate
        ? async (update) => {
          await onUpdate({ content: [{ type: 'text', text: update.partialText }], details: {} })
        }
        : undefined,
    }
    run.pendingTools.set(payload.toolCallId, pending)
    sendControl('tool.call', payload)
    run.abortController.signal.addEventListener('abort', abort, { once: true })
    if (run.abortController.signal.aborted) abort()
  })
  run.pendingToolPromises.set(payload.toolCallId, promise)
  const clearPendingPromise = (): void => {
    if (run.pendingToolPromises.get(payload.toolCallId) === promise) run.pendingToolPromises.delete(payload.toolCallId)
  }
  void promise.then(clearPendingPromise, clearPendingPromise)
  return promise
}

async function resolveToolResult(payload: RuntimeToolResultPayloadV1): Promise<void> {
  const run = activeRun
  if (!run || !matchesActiveRun(payload)) return
  const pending = run.pendingTools.get(payload.toolCallId)
  if (!pending) return
  run.pendingTools.delete(payload.toolCallId)
  pending.cleanup()
  let resolvedPayload = payload
  if (payload.resultRef) {
    try {
      resolvedPayload = {
        ...payload,
        text: readRuntimeToolResult(run.bundlePath, payload.resultRef),
        resultRef: undefined,
      }
    } catch (error) {
      resolvedPayload = {
        ...payload,
        text: error instanceof Error ? error.message : String(error),
        resultRef: undefined,
        isError: true,
      }
    }
  }
  run.completedToolResults.set(payload.toolCallId, resolvedPayload)
  pending.resolve(resolvedPayload)
}

async function forwardToolUpdate(payload: RuntimeToolUpdateV1): Promise<void> {
  const run = activeRun
  if (!run || !matchesActiveRun(payload)) return
  const pending = run.pendingTools.get(payload.toolCallId)
  if (!pending) return
  if (payload.updateSequence <= pending.lastUpdateSequence) {
    sendToolUpdateAck(run, payload, true)
    return
  }
  pending.lastUpdateSequence = payload.updateSequence
  try {
    await pending.onUpdate?.(payload)
    sendToolUpdateAck(run, payload, true)
  } catch {
    sendToolUpdateAck(run, payload, false)
    throw new Error('tool_update_consumer_stalled: Pi Runtime 无法消费工具增量')
  }
}

function sendToolUpdateAck(run: ActiveRun, payload: RuntimeToolUpdateV1, accepted: boolean): void {
  const ack: RuntimeToolUpdateAckV1 = {
    appBootId: payload.appBootId,
    bootId: payload.bootId,
    sessionId: run.sessionId,
    generation: run.generation,
    runId: run.runId,
    toolId: payload.toolId,
    toolCallId: payload.toolCallId,
    updateSequence: payload.updateSequence,
    accepted,
  }
  sendControl('tool.update_ack', ack)
}

function sendRunEvent(run: ActiveRun, event: AgentEvent): void {
  sendEvent('run.event', {
    ...lifecyclePayload(run),
    eventSequence: runEventSequence++,
    event,
  } satisfies RuntimeRunEventPayloadV1)
}

function sendControl<TPayload>(type: string, payload: TPayload): void {
  sendMessage({ version: 1, channel: 'control', sequence: controlSequence++, type, payload })
}

function sendEvent<TPayload>(type: string, payload: TPayload): void {
  sendMessage({ version: 1, channel: 'event', sequence: transportEventSequence++, type, payload })
}

function sendMessage<TPayload>(message: RuntimeMessageEnvelopeV1<TPayload>): void {
  runtimePort.postMessage(message)
}

function sendFatal(code: RuntimeFatalPayloadV1['code'], message: string): void {
  sendControl('runtime.fatal', { code, message } satisfies RuntimeFatalPayloadV1)
}

function sendResetAck(sessionId: string, ok: boolean, message?: string): void {
  sendControl('runtime.reset_ack', {
    bootId,
    sessionId,
    ok,
    ...(message ? { message } : {}),
  } satisfies RuntimeResetAckPayloadV1)
}

function parseMessage(value: unknown): RuntimeMessageEnvelopeV1 | undefined {
  if (!value || typeof value !== 'object') return undefined
  const message = value as Partial<RuntimeMessageEnvelopeV1>
  if (
    message.version !== 1
    || message.channel !== 'command'
    || typeof message.sequence !== 'number'
    || typeof message.type !== 'string'
  ) return undefined
  return message as RuntimeMessageEnvelopeV1
}

function lifecyclePayload(run: ActiveRun): RuntimeRunLifecyclePayloadV1 {
  return { sessionId: run.sessionId, runId: run.runId, generation: run.generation }
}

function matchesActiveRun(payload: RuntimeRunLifecyclePayloadV1): boolean {
  return Boolean(
    activeRun
    && activeRun.sessionId === payload.sessionId
    && activeRun.runId === payload.runId
    && activeRun.generation === payload.generation,
  )
}

function matchesRun(run: ActiveRun, payload: RuntimeRunLifecyclePayloadV1): boolean {
  return run.sessionId === payload.sessionId
    && run.runId === payload.runId
    && run.generation === payload.generation
}

function validateBootstrap(value: Record<string, unknown>, payload: RuntimeRunStartPayloadV1): RuntimeQueryBootstrapV1 {
  const bootstrap = value as unknown as RuntimeQueryBootstrapV1
  if (
    bootstrap.sessionId !== payload.sessionId
    || bootstrap.runId !== payload.runId
    || bootstrap.configRevision !== payload.configRevision
    || typeof bootstrap.configRevision !== 'number'
    || typeof bootstrap.configFingerprint !== 'string'
    || typeof bootstrap.credentialRevision !== 'number'
    || typeof bootstrap.prompt !== 'string'
    || typeof bootstrap.model !== 'string'
    || typeof bootstrap.cwd !== 'string'
    || typeof bootstrap.apiKey !== 'string'
    || typeof bootstrap.systemPrompt !== 'string'
    || !bootstrap.channel
    || !Array.isArray(bootstrap.historyMessages)
    || !Array.isArray(bootstrap.promptImages)
  ) {
    throw new Error('runtime_protocol_desync: Runtime bootstrap 非法')
  }
  return bootstrap
}

function resolvePromptImages(
  bundle: NonNullable<ReturnType<typeof readRuntimeTransferBundle>>,
  references: RuntimePromptImageReferenceV1[],
): ImageContent[] {
  return references.map((reference) => {
    if (
      !reference
      || typeof reference.relativePath !== 'string'
      || typeof reference.filename !== 'string'
      || typeof reference.mediaType !== 'string'
      || !reference.mediaType.startsWith('image/')
    ) {
      throw new Error('runtime_transfer_invalid_manifest: 图片引用非法')
    }
    const manifestFile = bundle.manifest.files.find((file) => (
      file.relativePath === reference.relativePath && file.kind === 'image'
    ))
    const content = bundle.files.get(reference.relativePath)
    if (!manifestFile || !content) {
      throw new Error(`runtime_transfer_missing: 图片引用不存在: ${reference.relativePath}`)
    }
    return {
      type: 'image',
      data: content.toString('base64'),
      mimeType: reference.mediaType,
    }
  })
}

function sendRunRejected(
  payload: RuntimeRunStartPayloadV1,
  code: RuntimeRunRejectedPayloadV1['error']['code'],
  message: string,
): void {
  sendControl('run.rejected', {
    sessionId: payload.sessionId,
    runId: payload.runId,
    generation: payload.generation,
    error: { code, message },
  } satisfies RuntimeRunRejectedPayloadV1)
}

const PRE_FLIGHT_ERROR_CODES: ReadonlySet<ErrorCode> = new Set([
  'runtime_transfer_missing',
  'runtime_transfer_invalid_path',
  'runtime_transfer_hash_mismatch',
  'runtime_transfer_too_large',
  'runtime_transfer_expired',
  'runtime_transfer_invalid_manifest',
  'runtime_sidecar_locked',
  'runtime_sidecar_dirty',
  'runtime_sidecar_corrupt',
  'runtime_stale_config_revision',
  'runtime_config_revision_conflict',
  'runtime_protocol_desync',
])

function parsePreflightError(error: unknown): { code: ErrorCode; message: string } {
  const message = error instanceof Error ? error.message : String(error)
  const separator = message.indexOf(':')
  const candidate = separator > 0 ? message.slice(0, separator) : ''
  if (PRE_FLIGHT_ERROR_CODES.has(candidate as ErrorCode)) {
    return {
      code: candidate as ErrorCode,
      message: message.slice(separator + 1).trim() || message,
    }
  }
  return { code: 'runtime_crashed', message }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function parseToolDescriptors(value: unknown): RuntimeToolDescriptorV1[] | undefined {
  if (!Array.isArray(value)) return undefined
  const descriptors: RuntimeToolDescriptorV1[] = []
  const ids = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined
    const descriptor = item as Partial<RuntimeToolDescriptorV1>
    if (
      descriptor.version !== 1
      || typeof descriptor.toolId !== 'string'
      || descriptor.toolId.length === 0
      || ids.has(descriptor.toolId)
      || typeof descriptor.name !== 'string'
      || typeof descriptor.description !== 'string'
      || !descriptor.parameters
      || typeof descriptor.parameters !== 'object'
      || Array.isArray(descriptor.parameters)
      || !['kila-coding', 'kila', 'mcp', 'runtime'].includes(descriptor.source ?? '')
      || !['read', 'write', 'execute', 'interactive'].includes(descriptor.permission ?? '')
      || !Array.isArray(descriptor.resultKinds)
      || typeof descriptor.supportsStreaming !== 'boolean'
    ) return undefined
    ids.add(descriptor.toolId)
    descriptors.push(descriptor as RuntimeToolDescriptorV1)
  }
  return descriptors
}

/** dirty sidecar 重建时只导入已证明安全的产品消息；无法证明时宁可从空历史继续。 */
function historyThroughSafeBoundary(
  history: RuntimeQueryBootstrapV1['historyMessages'],
  safeProductMessageId: string | undefined,
): RuntimeQueryBootstrapV1['historyMessages'] {
  if (!safeProductMessageId) return []
  const boundaryIndex = history.findIndex((message) => message.id === safeProductMessageId)
  return boundaryIndex < 0 ? [] : history.slice(0, boundaryIndex + 1)
}
