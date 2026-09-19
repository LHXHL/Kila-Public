import { describe, expect, test } from 'bun:test'
import type { RuntimeMessageEnvelopeV1 } from '@kila/shared'
import { RuntimeSupervisor, type RuntimeProcessLike } from './runtime-supervisor'

class FakeRuntimeProcess implements RuntimeProcessLike {
  readonly messages: unknown[] = []
  readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  pid = 4321
  killed = false

  on(event: 'spawn' | 'exit' | 'message' | 'error', listener: (...args: unknown[]) => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }

  postMessage(message: unknown): void {
    this.messages.push(message)
    const envelope = message as RuntimeMessageEnvelopeV1<{ reason: 'app-quit' | 'dispose' | 'crash-recovery' }>
    if (envelope.type === 'runtime.shutdown') {
      queueMicrotask(() => {
        this.emitMessage({
          version: 1,
          channel: 'control',
          sequence: 2,
          type: 'runtime.shutdown_ack',
          payload: { bootId: 'boot-1', activeRunCount: 0 },
        })
        this.emit('exit', 0)
      })
    }
  }

  kill(): boolean {
    this.killed = true
    this.emit('exit', 137)
    return true
  }

  emit(event: 'spawn' | 'exit' | 'message' | 'error', ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }

  emitMessage(message: RuntimeMessageEnvelopeV1): void {
    this.emit('message', message)
  }
}

describe('Runtime supervisor', () => {
  test('Given Utility Process When handshake identity 正确 Then ready、heartbeat 与 command sequence 生效', async () => {
    const process = new FakeRuntimeProcess()
    const supervisor = new RuntimeSupervisor({
      entryPath: '/tmp/pi-runtime.cjs',
      appBootId: 'app-1',
      spawn: () => process,
      readyTimeoutMs: 100,
      now: () => 1000,
    })

    const readyPromise = supervisor.start('session-1', 2)
    const handshake = process.messages[0] as RuntimeMessageEnvelopeV1<{ appBootId: string; spawnNonce: string }>
    expect(handshake).toMatchObject({ channel: 'command', sequence: 1, type: 'runtime.handshake' })
    process.emitMessage({
      version: 1,
      channel: 'control',
      sequence: 1,
      type: 'runtime.ready',
      payload: {
        protocolVersion: 1,
        appBootId: handshake.payload.appBootId,
        spawnNonce: handshake.payload.spawnNonce,
        bootId: 'boot-1',
        pid: 4321,
        runtimeVersion: 'test',
      },
    })
    await expect(readyPromise).resolves.toMatchObject({ bootId: 'boot-1', pid: 4321 })

    process.emitMessage({
      version: 1,
      channel: 'control',
      sequence: 2,
      type: 'runtime.heartbeat',
      payload: { bootId: 'boot-1', pid: 4321, activeSessionCount: 1 },
    })
    supervisor.postCommand('session-1', 'runtime.shutdown', { reason: 'dispose' })
    expect(process.messages.at(-1)).toMatchObject({ channel: 'command', sequence: 2, type: 'runtime.shutdown' })
    expect(supervisor.isResponsive('session-1')).toBe(true)
    await supervisor.dispose('session-1')
    expect(supervisor.getSnapshot('session-1')).toBeUndefined()
  })

  test('Given handshake nonce 不匹配 When Utility ready Then 拒绝并 kill', async () => {
    const process = new FakeRuntimeProcess()
    const supervisor = new RuntimeSupervisor({
      entryPath: '/tmp/pi-runtime.cjs',
      appBootId: 'app-1',
      spawn: () => process,
      readyTimeoutMs: 100,
    })
    const readyPromise = supervisor.start('session-1')
    const handshake = process.messages[0] as RuntimeMessageEnvelopeV1<{ appBootId: string; spawnNonce: string }>
    process.emitMessage({
      version: 1,
      channel: 'control',
      sequence: 1,
      type: 'runtime.ready',
      payload: {
        protocolVersion: 1,
        appBootId: handshake.payload.appBootId,
        spawnNonce: 'wrong',
        bootId: 'boot-1',
        pid: 4321,
        runtimeVersion: 'test',
      },
    })
    await expect(readyPromise).rejects.toThrow('runtime_handshake_failed')
    expect(process.killed).toBe(true)
  })

  test('Given Runtime protocol version 不匹配 When Utility ready Then 返回 protocol-mismatch 并 kill', async () => {
    const process = new FakeRuntimeProcess()
    const supervisor = new RuntimeSupervisor({
      entryPath: '/tmp/pi-runtime.cjs',
      appBootId: 'app-1',
      spawn: () => process,
      readyTimeoutMs: 100,
    })
    const readyPromise = supervisor.start('session-1')
    const handshake = process.messages[0] as RuntimeMessageEnvelopeV1<{ appBootId: string; spawnNonce: string }>
    process.emitMessage({
      version: 1,
      channel: 'control',
      sequence: 1,
      type: 'runtime.ready',
      payload: {
        protocolVersion: 99,
        appBootId: handshake.payload.appBootId,
        spawnNonce: handshake.payload.spawnNonce,
        bootId: 'boot-1',
        pid: 4321,
        runtimeVersion: 'test',
      },
    })

    await expect(readyPromise).rejects.toThrow('runtime_protocol_mismatch')
    expect(process.killed).toBe(true)
  })

  test('Given control sequence 重复或跳号 When Supervisor 收到消息 Then 重复丢弃、跳号隔离 Runtime', async () => {
    const process = new FakeRuntimeProcess()
    const messages: RuntimeMessageEnvelopeV1[] = []
    const supervisor = new RuntimeSupervisor({
      entryPath: '/tmp/pi-runtime.cjs',
      appBootId: 'app-1',
      spawn: () => process,
      onMessage: (_sessionId, message) => messages.push(message),
    })
    const readyPromise = supervisor.start('session-1')
    const handshake = process.messages[0] as RuntimeMessageEnvelopeV1<{ appBootId: string; spawnNonce: string }>
    const ready = {
      version: 1,
      channel: 'control' as const,
      sequence: 1,
      type: 'runtime.ready',
      payload: {
        protocolVersion: 1,
        appBootId: handshake.payload.appBootId,
        spawnNonce: handshake.payload.spawnNonce,
        bootId: 'boot-1',
        pid: 4321,
        runtimeVersion: 'test',
      },
    } satisfies RuntimeMessageEnvelopeV1
    process.emitMessage(ready)
    await readyPromise
    const heartbeat = (sequence: number): void => process.emitMessage({
      version: 1,
      channel: 'control',
      sequence,
      type: 'runtime.heartbeat',
      payload: { bootId: 'boot-1', pid: 4321, activeSessionCount: 1 },
    })
    heartbeat(2)
    heartbeat(2)
    expect(messages).toHaveLength(0)
    heartbeat(4)
    expect(process.killed).toBe(true)
    expect(supervisor.getSnapshot('session-1')).toBeUndefined()
  })

  test('Given Runtime 已退出 When 迟到消息到达 Then 不再进入应用事件回调', async () => {
    const process = new FakeRuntimeProcess()
    const messages: RuntimeMessageEnvelopeV1[] = []
    const supervisor = new RuntimeSupervisor({
      entryPath: '/tmp/pi-runtime.cjs',
      appBootId: 'app-1',
      spawn: () => process,
      onMessage: (_sessionId, message) => messages.push(message),
    })
    const readyPromise = supervisor.start('session-1')
    const handshake = process.messages[0] as RuntimeMessageEnvelopeV1<{ appBootId: string; spawnNonce: string }>
    process.emitMessage({
      version: 1,
      channel: 'control',
      sequence: 1,
      type: 'runtime.ready',
      payload: {
        protocolVersion: 1,
        appBootId: handshake.payload.appBootId,
        spawnNonce: handshake.payload.spawnNonce,
        bootId: 'boot-1',
        pid: 4321,
        runtimeVersion: 'test',
      },
    })
    await readyPromise
    process.emit('exit', 0)
    process.emitMessage({
      version: 1,
      channel: 'control',
      sequence: 2,
      type: 'runtime.heartbeat',
      payload: { bootId: 'boot-1', pid: 4321, activeSessionCount: 1 },
    })
    expect(messages).toHaveLength(0)
  })

  test('Given Runtime 发来超限消息 When Supervisor 校验 Then 上报 payload-too-large 并隔离当前 Runtime', async () => {
    const process = new FakeRuntimeProcess()
    const supervisor = new RuntimeSupervisor({
      entryPath: '/tmp/pi-runtime.cjs',
      appBootId: 'app-1',
      spawn: () => process,
      readyTimeoutMs: 100,
    })
    const readyPromise = supervisor.start('session-1')
    const handshake = process.messages[0] as RuntimeMessageEnvelopeV1<{ appBootId: string; spawnNonce: string }>
    process.emitMessage({
      version: 1,
      channel: 'control',
      sequence: 1,
      type: 'runtime.ready',
      payload: {
        protocolVersion: 1,
        appBootId: handshake.payload.appBootId,
        spawnNonce: handshake.payload.spawnNonce,
        bootId: 'boot-1',
        pid: 4321,
        runtimeVersion: 'test',
      },
    })
    await readyPromise
    const messages: RuntimeMessageEnvelopeV1[] = []
    supervisor.subscribe('session-1', (message) => messages.push(message))
    process.emitMessage({
      version: 1,
      channel: 'event',
      sequence: 1,
      type: 'runtime.heartbeat',
      payload: { oversized: 'x'.repeat(256 * 1024) },
    } as RuntimeMessageEnvelopeV1)

    expect(messages.at(-1)).toMatchObject({
      type: 'runtime.fatal',
      payload: { code: 'runtime_protocol_payload_too_large' },
    })
    expect(process.killed).toBe(true)
  })

  test('Given Runtime RSS 连续超过 hard limit When 收到心跳 Then 只 kill 当前 Runtime 并上报资源动作', async () => {
    const process = new FakeRuntimeProcess()
    const actions: string[] = []
    let now = 1_000
    const supervisor = new RuntimeSupervisor({
      entryPath: '/tmp/pi-runtime.cjs',
      appBootId: 'app-1',
      spawn: () => process,
      resourceBudget: { softLimitBytes: 256 * 1024 * 1024, hardLimitBytes: 512 * 1024 * 1024 },
      onResourceAction: (_sessionId, action) => actions.push(action),
      now: () => now,
    })
    const readyPromise = supervisor.start('session-1')
    const handshake = process.messages[0] as RuntimeMessageEnvelopeV1<{ appBootId: string; spawnNonce: string }>
    process.emitMessage({
      version: 1,
      channel: 'control',
      sequence: 1,
      type: 'runtime.ready',
      payload: {
        protocolVersion: 1,
        appBootId: handshake.payload.appBootId,
        spawnNonce: handshake.payload.spawnNonce,
        bootId: 'boot-1',
        pid: 4321,
        runtimeVersion: 'test',
      },
    })
    await readyPromise
    const heartbeat = (sequence: number): void => process.emitMessage({
      version: 1,
      channel: 'control',
      sequence,
      type: 'runtime.heartbeat',
      payload: { bootId: 'boot-1', pid: 4321, activeSessionCount: 1, rssBytes: 513 * 1024 * 1024 },
    })
    now += 10_000
    heartbeat(2)
    now += 10_000
    heartbeat(3)

    expect(actions).toEqual(['abort-and-kill'])
    expect(process.killed).toBe(true)
    expect(supervisor.getSnapshot('session-1')).toBeUndefined()
    await supervisor.dispose('session-1')
  })

  test('Given Runtime 无法提供 RSS When 连续收到心跳 Then 只记录一次诊断且不误杀运行', async () => {
    const process = new FakeRuntimeProcess()
    const unavailable: Array<{ sessionId: string; pid?: number }> = []
    const supervisor = new RuntimeSupervisor({
      entryPath: '/tmp/pi-runtime.cjs',
      appBootId: 'app-1',
      spawn: () => process,
      onResourceSampleUnavailable: (sessionId, pid) => unavailable.push({ sessionId, pid }),
    })
    const readyPromise = supervisor.start('session-1')
    const handshake = process.messages[0] as RuntimeMessageEnvelopeV1<{ appBootId: string; spawnNonce: string }>
    process.emitMessage({
      version: 1,
      channel: 'control',
      sequence: 1,
      type: 'runtime.ready',
      payload: {
        protocolVersion: 1,
        appBootId: handshake.payload.appBootId,
        spawnNonce: handshake.payload.spawnNonce,
        bootId: 'boot-1',
        pid: 4321,
        runtimeVersion: 'test',
      },
    })
    await readyPromise
    const heartbeat = (sequence: number): void => process.emitMessage({
      version: 1,
      channel: 'control',
      sequence,
      type: 'runtime.heartbeat',
      payload: { bootId: 'boot-1', pid: 4321, activeSessionCount: 1 },
    })
    heartbeat(2)
    heartbeat(3)

    expect(unavailable).toEqual([{ sessionId: 'session-1', pid: 4321 }])
    expect(process.killed).toBe(false)
    await supervisor.dispose('session-1')
  })

  test('Given Runtime 心跳超时 When watchdog 检测 Then 先 abort 再等待 shutdown，不立即 kill', async () => {
    const process = new FakeRuntimeProcess()
    let now = 1_000
    const supervisor = new RuntimeSupervisor({
      entryPath: '/tmp/pi-runtime.cjs',
      appBootId: 'app-1',
      spawn: () => process,
      now: () => now,
      heartbeatTimeoutMs: 15_000,
    })
    const readyPromise = supervisor.start('session-1')
    const handshake = process.messages[0] as RuntimeMessageEnvelopeV1<{ appBootId: string; spawnNonce: string }>
    process.emitMessage({
      version: 1,
      channel: 'control',
      sequence: 1,
      type: 'runtime.ready',
      payload: {
        protocolVersion: 1,
        appBootId: handshake.payload.appBootId,
        spawnNonce: handshake.payload.spawnNonce,
        bootId: 'boot-1',
        pid: 4321,
        runtimeVersion: 'test',
      },
    })
    await readyPromise

    now = 16_001
    supervisor.checkHeartbeatTimeouts()
    expect(process.messages.at(-1)).toMatchObject({ type: 'run.abort' })
    expect(process.killed).toBe(false)

    await supervisor.dispose('session-1')
    expect(process.killed).toBe(false)
  })

  test('Given running 已达到上限 When 第二个 Session 启动 Then 按 FIFO 等待并在 slot 释放后继续握手', async () => {
    const processes: FakeRuntimeProcess[] = []
    const supervisor = new RuntimeSupervisor({
      entryPath: '/tmp/pi-runtime.cjs',
      appBootId: 'app-1',
      capacity: { maxRunning: 1, maxSpawnConcurrency: 1 },
      spawn: () => {
        const process = new FakeRuntimeProcess()
        processes.push(process)
        return process
      },
      readyTimeoutMs: 100,
    })

    const firstReady = supervisor.start('session-a')
    const firstProcess = processes[0]!
    const firstHandshake = firstProcess.messages[0] as RuntimeMessageEnvelopeV1<{ appBootId: string; spawnNonce: string }>
    firstProcess.emitMessage({
      version: 1,
      channel: 'control',
      sequence: 1,
      type: 'runtime.ready',
      payload: {
        protocolVersion: 1,
        appBootId: firstHandshake.payload.appBootId,
        spawnNonce: firstHandshake.payload.spawnNonce,
        bootId: 'boot-a',
        pid: 4321,
        runtimeVersion: 'test',
      },
    })
    await expect(firstReady).resolves.toMatchObject({ bootId: 'boot-a' })

    let secondResolved = false
    const secondReady = supervisor.start('session-b').then((ready) => {
      secondResolved = true
      return ready
    })
    await Promise.resolve()
    expect(secondResolved).toBe(false)
    expect(processes).toHaveLength(1)
    expect(supervisor.getQueuePosition('session-b')).toBe(1)

    await supervisor.dispose('session-a')
    expect(processes).toHaveLength(2)
    const secondProcess = processes[1]!
    const secondHandshake = secondProcess.messages[0] as RuntimeMessageEnvelopeV1<{ appBootId: string; spawnNonce: string }>
    secondProcess.emitMessage({
      version: 1,
      channel: 'control',
      sequence: 1,
      type: 'runtime.ready',
      payload: {
        protocolVersion: 1,
        appBootId: secondHandshake.payload.appBootId,
        spawnNonce: secondHandshake.payload.spawnNonce,
        bootId: 'boot-b',
        pid: 4322,
        runtimeVersion: 'test',
      },
    })
    await expect(secondReady).resolves.toMatchObject({ bootId: 'boot-b' })
    await supervisor.dispose('session-b')
  })

  test('Given FIFO Session 正在等待 When 前一个 Runtime 进入 hot-idle Then 队首立即获得 slot', async () => {
    const processes: FakeRuntimeProcess[] = []
    const supervisor = new RuntimeSupervisor({
      entryPath: '/tmp/pi-runtime.cjs',
      capacity: { maxRunning: 1, maxHotIdle: 1 },
      spawn: () => {
        const process = new FakeRuntimeProcess()
        processes.push(process)
        return process
      },
      readyTimeoutMs: 100,
    })

    const firstReadyPromise = supervisor.start('session-a')
    const firstProcess = processes[0]!
    const firstHandshake = firstProcess.messages[0] as RuntimeMessageEnvelopeV1<{ appBootId: string; spawnNonce: string }>
    firstProcess.emitMessage({
      version: 1,
      channel: 'control',
      sequence: 1,
      type: 'runtime.ready',
      payload: {
        protocolVersion: 1,
        appBootId: firstHandshake.payload.appBootId,
        spawnNonce: firstHandshake.payload.spawnNonce,
        bootId: 'boot-a',
        pid: 4321,
        runtimeVersion: 'test',
      },
    })
    await firstReadyPromise

    const secondReadyPromise = supervisor.start('session-b')
    expect(supervisor.getQueuePosition('session-b')).toBe(1)
    supervisor.markHotIdle('session-a')
    for (let attempt = 0; attempt < 10 && processes.length < 2; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }

    const secondProcess = processes[1]
    expect(secondProcess).toBeDefined()
    const secondHandshake = secondProcess!.messages[0] as RuntimeMessageEnvelopeV1<{ appBootId: string; spawnNonce: string }>
    secondProcess!.emitMessage({
      version: 1,
      channel: 'control',
      sequence: 1,
      type: 'runtime.ready',
      payload: {
        protocolVersion: 1,
        appBootId: secondHandshake.payload.appBootId,
        spawnNonce: secondHandshake.payload.spawnNonce,
        bootId: 'boot-b',
        pid: 4322,
        runtimeVersion: 'test',
      },
    })
    await expect(secondReadyPromise).resolves.toMatchObject({ bootId: 'boot-b' })
    await supervisor.disposeAll()
  })
})
