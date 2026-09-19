import { randomUUID } from 'node:crypto'
import type {
  RuntimeFatalPayloadV1,
  RuntimeHeartbeatPayloadV1,
  RuntimeMessageEnvelopeV1,
  RuntimeReadyPayloadV1,
  RuntimeShutdownAckPayloadV1,
} from '@kila/shared'
import { normalizeRuntimeCapacityOptions, RuntimeCapacityController, type RuntimeCapacityOptions } from './runtime-capacity'
import { RuntimeResourceBudget, type RuntimeResourceAction, type RuntimeResourceBudgetOptions } from './runtime-resource-budget'
import { RuntimeTransportSequenceState, assertRuntimeMessageSize } from './runtime-transport'

type RuntimeProcessEvent = 'spawn' | 'exit' | 'message' | 'error'

export interface RuntimeProcessLike {
  readonly pid?: number
  on(event: RuntimeProcessEvent, listener: (...args: unknown[]) => void): void
  off?(event: RuntimeProcessEvent, listener: (...args: unknown[]) => void): void
  postMessage(message: unknown): void
  kill(): boolean
}

export type RuntimeProcessSpawner = (entryPath: string, serviceName: string) => RuntimeProcessLike

export interface RuntimeSupervisorOptions {
  entryPath: string
  appBootId?: string
  capacity?: RuntimeCapacityOptions
  readyTimeoutMs?: number
  shutdownTimeoutMs?: number
  heartbeatTimeoutMs?: number
  resourceBudget?: RuntimeResourceBudgetOptions
  now?: () => number
  spawn?: RuntimeProcessSpawner
  onMessage?: (sessionId: string, message: RuntimeMessageEnvelopeV1) => void
  onExit?: (sessionId: string, code: number) => void
  onResourceAction?: (sessionId: string, action: RuntimeResourceAction, rssBytes: number) => void
  onResourceSampleUnavailable?: (sessionId: string, pid?: number) => void
  onUnresponsive?: (sessionId: string) => void
}

export type RuntimeRecordState = 'starting' | 'ready' | 'shutting-down' | 'exited'

export interface RuntimeRecordSnapshot {
  sessionId: string
  generation: number
  state: RuntimeRecordState
  appBootId: string
  spawnNonce: string
  bootId?: string
  pid?: number
  lastHeartbeatAt?: number
  lastResourceSampleAt?: number
}

export type RuntimeMessageListener = (message: RuntimeMessageEnvelopeV1) => void
export type RuntimeExitListener = (code: number) => void

interface RuntimeRecord {
  sessionId: string
  generation: number
  appBootId: string
  spawnNonce: string
  process: RuntimeProcessLike
  state: RuntimeRecordState
  commandSequence: number
  transport: RuntimeTransportSequenceState
  lastHeartbeatAt?: number
  lastResourceSampleAt?: number
  ready?: RuntimeReadyPayloadV1
  readyResolve?: (ready: RuntimeReadyPayloadV1) => void
  readyReject?: (error: Error) => void
  startupError?: Error
  exitResolve?: (code: number) => void
  exitedCode?: number
  shutdownSent?: boolean
  unresponsiveAbortTimer?: ReturnType<typeof setTimeout>
  unresponsiveKillTimer?: ReturnType<typeof setTimeout>
  resourceSampleUnavailableLogged: boolean
}

export class RuntimeSupervisor {
  readonly appBootId: string
  readonly capacity: RuntimeCapacityController
  readonly resourceBudget: RuntimeResourceBudget
  private readonly options: RuntimeSupervisorOptions
  private readonly records = new Map<string, RuntimeRecord>()
  private readonly messageListeners = new Map<string, Set<RuntimeMessageListener>>()
  private readonly exitListeners = new Map<string, Set<RuntimeExitListener>>()
  private readonly pendingStarts = new Map<string, Promise<RuntimeReadyPayloadV1>>()
  private readonly pendingStartControllers = new Map<string, AbortController>()
  private readonly capacityWaiters = new Set<() => void>()
  private readonly now: () => number
  private readonly heartbeatWatchdog: ReturnType<typeof setInterval>

  constructor(options: RuntimeSupervisorOptions) {
    this.options = options
    this.appBootId = options.appBootId ?? randomUUID()
    this.capacity = new RuntimeCapacityController(normalizeRuntimeCapacityOptions(options.capacity))
    this.resourceBudget = new RuntimeResourceBudget(options.resourceBudget)
    this.now = options.now ?? Date.now
    const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 15_000
    this.heartbeatWatchdog = setInterval(
      () => this.checkHeartbeatTimeouts(heartbeatTimeoutMs),
      Math.max(1_000, Math.min(5_000, Math.floor(heartbeatTimeoutMs / 2))),
    )
    this.heartbeatWatchdog.unref?.()
  }

  /** 运行一次心跳检查；公开给测试复用，生产由定时器调用。 */
  checkHeartbeatTimeouts(heartbeatTimeoutMs = this.options.heartbeatTimeoutMs ?? 15_000): void {
    for (const record of this.records.values()) {
      if (
        record.state === 'ready'
        && record.lastHeartbeatAt !== undefined
        && this.now() - record.lastHeartbeatAt > heartbeatTimeoutMs
      ) {
        this.beginUnresponsiveShutdown(record)
      }
    }
  }

  start(sessionId: string, generation = 0, signal?: AbortSignal): Promise<RuntimeReadyPayloadV1> {
    const pending = this.pendingStarts.get(sessionId)
    if (pending) return pending

    const controller = new AbortController()
    const combinedSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal
    const promise = this.startInternal(sessionId, generation, combinedSignal)
    this.pendingStarts.set(sessionId, promise)
    this.pendingStartControllers.set(sessionId, controller)
    const clearPending = (): void => {
      if (this.pendingStarts.get(sessionId) === promise) this.pendingStarts.delete(sessionId)
      if (this.pendingStartControllers.get(sessionId) === controller) this.pendingStartControllers.delete(sessionId)
    }
    void promise.then(clearPending, clearPending)
    return promise
  }

  private async startInternal(
    sessionId: string,
    generation: number,
    signal: AbortSignal,
  ): Promise<RuntimeReadyPayloadV1> {
    const existing = this.records.get(sessionId)
    if (existing?.state === 'ready' && existing.ready) {
      this.capacity.markRunning(sessionId, this.now())
      this.resourceBudget.setState(sessionId, 'running')
      return existing.ready
    }
    if (existing && existing.state !== 'exited') {
      throw new Error('runtime_start_failed: Session Runtime 已存在')
    }

    while (true) {
      if (signal.aborted) {
        this.releaseCapacitySlot(sessionId)
        throw new Error('runtime_capacity_queued: Runtime 启动等待已取消')
      }
      const capacityState = this.capacity.requestRun(sessionId, this.now())
      // requestRun 可能同时晋升此前的 FIFO 队首；统一唤醒等待者，避免晋升后无人继续握手。
      this.notifyCapacityWaiters()
      if (capacityState === 'queued') {
        // 新 run 进入 FIFO 前先回收最老 hot-idle，释放长期占用的 Utility PID；
        // 排除当前请求，避免同一 Session 的 hot-idle 恢复流程被自己取消。
        const evictedHotIdle = this.capacity.takeLruHotIdle(1, sessionId)
        this.notifyCapacityWaiters()
        for (const evictedSessionId of evictedHotIdle) void this.dispose(evictedSessionId)
        await this.waitForCapacityChange(sessionId, signal)
        continue
      }
      if (this.capacity.beginSpawn(sessionId)) break
      // 保留 running slot，避免 spawn 并发受限时把 FIFO 会话重新排到队尾。
      await this.waitForCapacityChange(sessionId, signal)
    }

    const spawnNonce = randomUUID()
    let process: RuntimeProcessLike
    try {
      process = (this.options.spawn ?? defaultSpawn)(this.options.entryPath, `Kila Pi Runtime ${sessionId}`)
    } catch (error) {
      this.capacity.finishSpawn(sessionId)
      this.releaseCapacitySlot(sessionId)
      throw new Error(`runtime_start_failed: ${formatError(error)}`)
    }

    const record: RuntimeRecord = {
      sessionId,
      generation,
      appBootId: this.appBootId,
      spawnNonce,
      process,
      state: 'starting',
      commandSequence: 1,
      transport: new RuntimeTransportSequenceState(),
      resourceSampleUnavailableLogged: false,
    }
    this.records.set(sessionId, record)
    this.attachProcessListeners(record)
    this.send(record, 'runtime.handshake', {
      appBootId: this.appBootId,
      spawnNonce,
    })
    this.capacity.finishSpawn(sessionId)
    this.notifyCapacityWaiters()

    try {
      return await this.waitForReady(record, signal)
    } catch (error) {
      await this.shutdownRecord(record, true)
      throw error
    }
  }

  postCommand<TPayload>(sessionId: string, type: string, payload: TPayload): void {
    const record = this.requireRecord(sessionId)
    if (record.state !== 'ready') throw new Error('runtime_start_failed: Runtime 尚未 ready')
    this.send(record, type, payload)
  }

  subscribe(sessionId: string, listener: RuntimeMessageListener): () => void {
    const listeners = this.messageListeners.get(sessionId) ?? new Set<RuntimeMessageListener>()
    listeners.add(listener)
    this.messageListeners.set(sessionId, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.messageListeners.delete(sessionId)
    }
  }

  subscribeExit(sessionId: string, listener: RuntimeExitListener): () => void {
    const listeners = this.exitListeners.get(sessionId) ?? new Set<RuntimeExitListener>()
    listeners.add(listener)
    this.exitListeners.set(sessionId, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.exitListeners.delete(sessionId)
    }
  }

  getSnapshot(sessionId: string): RuntimeRecordSnapshot | undefined {
    const record = this.records.get(sessionId)
    if (!record) return undefined
    return {
      sessionId: record.sessionId,
      generation: record.generation,
      state: record.state,
      appBootId: record.appBootId,
      spawnNonce: record.spawnNonce,
      bootId: record.ready?.bootId,
      pid: record.ready?.pid ?? record.process.pid,
      lastHeartbeatAt: record.lastHeartbeatAt,
      lastResourceSampleAt: record.lastResourceSampleAt,
    }
  }

  isResponsive(sessionId: string, now = this.now()): boolean {
    const record = this.records.get(sessionId)
    if (!record || record.state !== 'ready' || record.lastHeartbeatAt === undefined) return false
    return now - record.lastHeartbeatAt <= (this.options.heartbeatTimeoutMs ?? 15_000)
  }

  getQueuePosition(sessionId: string): number | undefined {
    const position = this.capacity.snapshot().queued.indexOf(sessionId)
    return position >= 0 ? position + 1 : undefined
  }

  markHotIdle(sessionId: string, now = this.now()): string[] {
    this.resourceBudget.setState(sessionId, 'hot-idle')
    const evicted = this.capacity.markHotIdle(sessionId, now)
    this.notifyCapacityWaiters()
    for (const evictedSessionId of evicted) void this.dispose(evictedSessionId)
    return evicted
  }

  sweepHotIdle(now = this.now()): string[] {
    const expired = this.capacity.takeExpiredHotIdle(now)
    this.notifyCapacityWaiters()
    for (const expiredSessionId of expired) void this.dispose(expiredSessionId)
    return expired
  }

  async dispose(sessionId: string): Promise<void> {
    this.pendingStartControllers.get(sessionId)?.abort()
    const record = this.records.get(sessionId)
    if (!record || record.state === 'exited') return
    await this.shutdownRecord(record, false)
  }

  async disposeAll(): Promise<void> {
    for (const controller of this.pendingStartControllers.values()) controller.abort()
    await Promise.allSettled([...this.pendingStarts.values()])
    await Promise.all([...this.records.keys()].map((sessionId) => this.dispose(sessionId)))
    clearInterval(this.heartbeatWatchdog)
  }

  private attachProcessListeners(record: RuntimeRecord): void {
    record.process.on('spawn', (() => undefined) as (...args: unknown[]) => void)
    record.process.on('message', ((event: unknown, message: unknown) => {
      // Electron UtilityProcess 的 message listener 是 (event, message)，
      // 测试 Runtime/旧实现可能只传一个 envelope；两种形态都统一解包。
      this.handleMessage(record, message ?? event)
    }) as (...args: unknown[]) => void)
    record.process.on('error', ((error: unknown) => {
      if (record.state === 'starting') {
        const startupError = new Error(`runtime_start_failed: ${formatError(error)}`)
        record.startupError = startupError
        record.readyReject?.(startupError)
      }
    }) as (...args: unknown[]) => void)
    record.process.on('exit', ((code: number) => this.handleExit(record, code)) as (...args: unknown[]) => void)
  }

  private async waitForReady(record: RuntimeRecord, signal: AbortSignal): Promise<RuntimeReadyPayloadV1> {
    if (record.ready) return record.ready
    if (record.startupError) throw record.startupError
    if (record.state === 'exited') throw new Error('runtime_crashed: Runtime 在 ready 前退出')
    const timeoutMs = this.options.readyTimeoutMs ?? 10_000
    return new Promise<RuntimeReadyPayloadV1>((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | undefined
      const abort = (): void => {
        if (timeout) clearTimeout(timeout)
        cleanup()
        record.readyResolve = undefined
        record.readyReject = undefined
        reject(new Error('runtime_capacity_queued: Runtime 启动等待已取消'))
      }
      const cleanup = (): void => {
        signal.removeEventListener('abort', abort)
      }
      record.readyResolve = resolve
      record.readyReject = reject
      timeout = setTimeout(() => {
        cleanup()
        record.readyResolve = undefined
        record.readyReject = undefined
        reject(new Error('runtime_handshake_failed: 等待 Runtime ready 超时'))
      }, timeoutMs)
      const resolveReady = record.readyResolve
      record.readyResolve = (ready) => {
        clearTimeout(timeout)
        cleanup()
        resolveReady?.(ready)
      }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
  }

  private handleMessage(record: RuntimeRecord, raw: unknown): void {
    if (record.state === 'exited') return
    const message = unwrapRuntimeMessage(raw)
    if (!message || message.version !== 1) {
      this.markProtocolDesync(record, 'Runtime message version 非法')
      return
    }
    try {
      assertRuntimeMessageSize(message)
    } catch (error) {
      this.markProtocolDesync(record, formatError(error))
      return
    }
    const decision = record.transport.accept(message.channel, message.sequence)
    if (decision === 'duplicate') return
    if (decision === 'desync') {
      this.markProtocolDesync(record, `Runtime ${message.channel} sequence 失步`)
      return
    }

    if (message.type === 'runtime.ready') {
      this.handleReady(record, message.payload as RuntimeReadyPayloadV1)
      return
    }
    if (message.type === 'runtime.heartbeat') {
      const heartbeat = message.payload as RuntimeHeartbeatPayloadV1
      if (heartbeat.bootId === record.ready?.bootId) {
        const now = this.now()
        record.lastHeartbeatAt = now
        if (typeof heartbeat.rssBytes === 'number' && Number.isFinite(heartbeat.rssBytes)) {
          const sampleIntervalMs = this.resourceBudget.config.sampleIntervalMs
          if (
            record.lastResourceSampleAt === undefined
            || now - record.lastResourceSampleAt >= sampleIntervalMs
          ) {
            record.lastResourceSampleAt = now
            const sample = this.resourceBudget.sample(record.sessionId, heartbeat.rssBytes)
            for (const action of sample.actions) {
              this.options.onResourceAction?.(record.sessionId, action, sample.rssBytes)
              if (action === 'abort-and-kill') record.process.kill()
            }
          }
        } else if (!record.resourceSampleUnavailableLogged) {
          record.resourceSampleUnavailableLogged = true
          this.options.onResourceSampleUnavailable?.(record.sessionId, heartbeat.pid || record.ready?.pid)
        }
      }
      return
    }
    if (message.type === 'runtime.shutdown_ack') {
      return
    }
    this.publishMessage(record.sessionId, message)
  }

  private handleReady(record: RuntimeRecord, payload: RuntimeReadyPayloadV1): void {
    if (payload.protocolVersion !== 1) {
      const startupError = new Error('runtime_protocol_mismatch: Runtime protocol version 不兼容')
      record.startupError = startupError
      record.readyReject?.(startupError)
      record.readyResolve = undefined
      record.readyReject = undefined
      if (record.state !== 'exited') record.process.kill()
      return
    }
    if (
      payload.appBootId !== record.appBootId
      || payload.spawnNonce !== record.spawnNonce
      || !payload.bootId
      || !Number.isInteger(payload.pid)
    ) {
      const startupError = new Error('runtime_handshake_failed: Runtime identity 不匹配')
      record.startupError = startupError
      record.readyReject?.(startupError)
      this.markProtocolDesync(record, 'Runtime handshake identity 不匹配')
      return
    }
    record.ready = payload
    record.state = 'ready'
    record.lastHeartbeatAt = this.now()
    this.resourceBudget.register(record.sessionId, 'running')
    record.readyResolve?.(payload)
    record.readyResolve = undefined
    record.readyReject = undefined
  }

  private handleExit(record: RuntimeRecord, code: number): void {
    if (record.state === 'exited') return
    if (record.unresponsiveAbortTimer) clearTimeout(record.unresponsiveAbortTimer)
    if (record.unresponsiveKillTimer) clearTimeout(record.unresponsiveKillTimer)
    record.state = 'exited'
    record.exitedCode = code
    record.readyReject?.(record.startupError ?? new Error(`runtime_crashed: Runtime 已退出 (${code})`))
    record.exitResolve?.(code)
    record.readyResolve = undefined
    record.readyReject = undefined
    this.releaseCapacitySlot(record.sessionId)
    this.resourceBudget.unregister(record.sessionId)
    this.options.onExit?.(record.sessionId, code)
    for (const listener of this.exitListeners.get(record.sessionId) ?? []) listener(code)
    this.records.delete(record.sessionId)
    this.messageListeners.delete(record.sessionId)
    this.exitListeners.delete(record.sessionId)
  }

  private async shutdownRecord(record: RuntimeRecord, killOnTimeout: boolean): Promise<void> {
    if (record.state === 'exited') return
    record.state = 'shutting-down'
    const timeoutMs = this.options.shutdownTimeoutMs ?? 3_000
    await new Promise<void>((resolve) => {
      let killTimer: ReturnType<typeof setTimeout> | undefined
      record.exitResolve = () => {
        if (killTimer) clearTimeout(killTimer)
        record.exitResolve = undefined
        resolve()
      }
      if (record.state === 'exited') {
        resolve()
        return
      }
      killTimer = setTimeout(() => {
        if (record.state !== 'exited') {
          record.process.kill()
        }
      }, timeoutMs)
      killTimer.unref?.()
      if (record.ready && !record.shutdownSent) {
        record.shutdownSent = true
        this.send(record, 'runtime.shutdown', { reason: killOnTimeout ? 'crash-recovery' : 'dispose' })
      } else {
        if (!record.ready) record.process.kill()
      }
    })
  }

  private beginUnresponsiveShutdown(record: RuntimeRecord): void {
    if (record.state !== 'ready') return
    record.state = 'shutting-down'
    this.options.onUnresponsive?.(record.sessionId)
    try {
      this.send(record, 'run.abort', { reason: 'runtime_unresponsive' })
    } catch {
      // Runtime 已失联时，继续等待 shutdown/kill 屏障，不把看门狗本身打崩。
    }

    record.unresponsiveAbortTimer = setTimeout(() => {
      record.unresponsiveAbortTimer = undefined
      if (record.state === 'exited') return
      if (!record.shutdownSent) {
        record.shutdownSent = true
        try {
          this.send(record, 'runtime.shutdown', { reason: 'unresponsive' })
        } catch {
          // 发送失败时仍保留后续 kill 屏障。
        }
      }
      record.unresponsiveKillTimer = setTimeout(() => {
        record.unresponsiveKillTimer = undefined
        if (record.state !== 'exited') record.process.kill()
      }, 3_000)
      record.unresponsiveKillTimer.unref?.()
    }, 5_000)
    record.unresponsiveAbortTimer.unref?.()
  }

  private async waitForCapacityChange(sessionId: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      this.releaseCapacitySlot(sessionId)
      throw new Error('runtime_capacity_queued: Runtime 启动等待已取消')
    }
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const wake = (): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve()
      }
      const abort = (): void => {
        if (settled) return
        settled = true
        cleanup()
        this.releaseCapacitySlot(sessionId)
        reject(new Error('runtime_capacity_queued: Runtime 启动等待已取消'))
      }
      const cleanup = (): void => {
        this.capacityWaiters.delete(wake)
        signal.removeEventListener('abort', abort)
      }
      this.capacityWaiters.add(wake)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
  }

  private notifyCapacityWaiters(): void {
    for (const waiter of [...this.capacityWaiters]) waiter()
  }

  private releaseCapacitySlot(sessionId: string): void {
    const promoted = this.capacity.release(sessionId)
    this.notifyCapacityWaiters()
    if (promoted) this.notifyCapacityWaiters()
  }

  private send<TPayload>(record: RuntimeRecord, type: string, payload: TPayload): void {
    const envelope: RuntimeMessageEnvelopeV1<TPayload> = {
      version: 1,
      channel: 'command',
      sequence: record.commandSequence++,
      type,
      payload,
    }
    assertRuntimeMessageSize(envelope)
    record.process.postMessage(envelope)
  }

  private requireRecord(sessionId: string): RuntimeRecord {
    const record = this.records.get(sessionId)
    if (!record) throw new Error('runtime_start_failed: Runtime 不存在')
    return record
  }

  private markProtocolDesync(record: RuntimeRecord, message: string): void {
    if (message.startsWith('runtime_protocol_payload_too_large:')) {
      const fatal: RuntimeMessageEnvelopeV1<RuntimeFatalPayloadV1> = {
        version: 1,
        channel: 'control',
        sequence: 0,
        type: 'runtime.fatal',
        payload: { code: 'runtime_protocol_payload_too_large', message },
      }
      this.publishMessage(record.sessionId, fatal)
    }
    record.readyReject?.(new Error(`runtime_protocol_desync: ${message}`))
    if (record.state !== 'exited') record.process.kill()
  }

  private publishMessage(sessionId: string, message: RuntimeMessageEnvelopeV1): void {
    this.options.onMessage?.(sessionId, message)
    for (const listener of this.messageListeners.get(sessionId) ?? []) listener(message)
  }
}

function unwrapRuntimeMessage(raw: unknown): RuntimeMessageEnvelopeV1 | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  const message = value.data && typeof value.data === 'object' ? value.data : value
  if (!message || typeof message !== 'object') return undefined
  const envelope = message as Partial<RuntimeMessageEnvelopeV1>
  if (
    envelope.version !== 1
    || (envelope.channel !== 'command' && envelope.channel !== 'control' && envelope.channel !== 'event')
    || typeof envelope.sequence !== 'number'
    || typeof envelope.type !== 'string'
  ) return undefined
  return envelope as RuntimeMessageEnvelopeV1
}

function defaultSpawn(entryPath: string, serviceName: string): RuntimeProcessLike {
  // Electron is loaded lazily so pure supervisor tests remain Node/Bun-only.
  throw new Error(`未配置 Utility Process spawner: ${entryPath} (${serviceName})`)
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
