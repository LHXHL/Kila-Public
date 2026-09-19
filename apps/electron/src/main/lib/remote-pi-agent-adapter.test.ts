import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RuntimeMessageEnvelopeV1 } from '@kila/shared'
import type { AnyAgentTool } from './agent-tool-names'
import type { PiAgentQueryOptions } from '../../utility/pi-agent-adapter'
import { RemotePiAgentAdapter } from './remote-pi-agent-adapter'
import { RuntimeSupervisor, type RuntimeProcessLike } from './agent-runtime/runtime-supervisor'

const originalConfigDir = process.env.KILA_CONFIG_DIR
const createdDirs: string[] = []

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.KILA_CONFIG_DIR
  else process.env.KILA_CONFIG_DIR = originalConfigDir
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('Remote Pi Agent adapter', () => {
  test('Given Utility Runtime 已 ready When query 触发工具调用 Then 主进程执行工具并转发事件', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'kila-remote-adapter-'))
    createdDirs.push(configDir)
    process.env.KILA_CONFIG_DIR = configDir

    const processLike = new FakeRuntimeProcess()
    const supervisor = new RuntimeSupervisor({
      entryPath: '/tmp/pi-runtime.cjs',
      appBootId: 'app-1',
      spawn: () => processLike,
    })
    const adapter = new RemotePiAgentAdapter({ supervisor })
    let executed = 0
    let receivedArgs: Record<string, unknown> | undefined
    const tool: AnyAgentTool = {
      name: 'read',
      label: 'Read',
      description: 'read',
      parameters: { type: 'object' } as never,
      execute: async (_toolCallId, params, _signal, onUpdate) => {
        executed += 1
        receivedArgs = params as Record<string, unknown>
        onUpdate?.({ content: [{ type: 'text', text: 'partial' }], details: {} })
        return { content: [{ type: 'text', text: 'tool-ok' }], details: {} }
      },
    }

    const events = []
    for await (const event of adapter.query({
      sessionId: 'session-1',
      runId: 'run-1',
      prompt: 'hello',
      rawPrompt: 'hello',
      model: 'test-model',
      cwd: configDir,
      channel: { provider: 'custom', baseUrl: 'https://example.test' },
      apiKey: 'secret',
      systemPrompt: 'system',
      tools: [tool],
      promptImages: [{ type: 'image', data: 'c2VjcmV0LWltYWdl', mimeType: 'image/png' }],
      beforeToolCall: async () => ({ updatedInput: { approved: true } }),
    })) {
      events.push(event)
    }

    expect(executed).toBe(1)
    expect(receivedArgs).toEqual({ approved: true })
    expect(events).toContainEqual({
      type: 'tool_start',
      toolUseId: 'tool-1',
      toolName: 'read',
      input: { approved: true },
    })
    expect(events).toContainEqual({ type: 'tool_result', toolUseId: 'tool-1', result: 'tool-ok', isError: false })
    const bundlePath = processLike.runStartPayload?.bundlePath as string
    const bootstrapText = processLike.bundleSnapshot?.bootstrapText as string
    const manifest = processLike.bundleSnapshot?.manifest as {
      files: Array<{ relativePath: string; kind: string }>
    }
    expect(bootstrapText).not.toContain('c2VjcmV0LWltYWdl')
    expect(manifest.files.some((file) => file.relativePath === 'images/0-legacy-0' && file.kind === 'image')).toBe(true)
    expect(processLike.bundleSnapshot?.imageText).toBe('secret-image')
    expect(processLike.runStartPayload).not.toHaveProperty('toolDescriptors')
    expect(existsSync(join(bundlePath, 'bootstrap.json'))).toBe(false)
    await expect(adapter.markRunPersisted('session-1', 'run-1', 'message-1')).resolves.toBeUndefined()
    expect(existsSync(bundlePath)).toBe(false)
    await expect(adapter.resetSession('session-1')).resolves.toBeUndefined()
    expect(processLike.resetRequested).toBe(true)
    expect(processLike.exited).toBe(false)
    await adapter.dispose()
    expect(processLike.exited).toBe(true)
  })

  test('Given Runtime protocol version 不匹配 When query 启动 Then 以 typed error 返回而不是降级为 unknown error', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'kila-remote-adapter-mismatch-'))
    createdDirs.push(configDir)
    process.env.KILA_CONFIG_DIR = configDir

    const processLike = new FakeRuntimeProcess()
    processLike.protocolVersion = 99
    const supervisor = new RuntimeSupervisor({
      entryPath: '/tmp/pi-runtime.cjs',
      appBootId: 'app-1',
      spawn: () => processLike,
      readyTimeoutMs: 100,
    })
    const adapter = new RemotePiAgentAdapter({ supervisor })
    const events = []
    for await (const event of adapter.query({
      sessionId: 'session-mismatch',
      runId: 'run-mismatch',
      prompt: 'hello',
      rawPrompt: 'hello',
      model: 'test-model',
      cwd: configDir,
      channel: { provider: 'custom', baseUrl: 'https://example.test' },
      apiKey: 'secret',
      systemPrompt: 'system',
      tools: [],
    })) events.push(event)

    expect(events).toContainEqual(expect.objectContaining({
      type: 'typed_error',
      error: expect.objectContaining({ code: 'runtime_protocol_mismatch' }),
    }))
    await adapter.dispose()
  })

  test('Given transfer preflight 失败 When run 尚未提交 Then 返回 typed error 且不等待不存在的 run', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'kila-remote-adapter-preflight-'))
    createdDirs.push(configDir)
    process.env.KILA_CONFIG_DIR = configDir

    const processLike = new FakeRuntimeProcess()
    const supervisor = new RuntimeSupervisor({
      entryPath: '/tmp/pi-runtime.cjs',
      appBootId: 'app-1',
      spawn: () => processLike,
    })
    const adapter = new RemotePiAgentAdapter({ supervisor })
    const events = []
    for await (const event of adapter.query({
      sessionId: 'session-preflight',
      runId: 'run-preflight',
      prompt: 'hello',
      rawPrompt: 'hello',
      model: 'test-model',
      cwd: configDir,
      channel: { provider: 'custom', baseUrl: 'https://example.test' },
      apiKey: 'secret',
      systemPrompt: 'system',
      tools: [],
      promptImageAttachments: [{
        id: 'not-an-image',
        filename: 'note.txt',
        mediaType: 'text/plain',
        localPath: '',
        size: 4,
      }],
    })) events.push(event)

    expect(events).toContainEqual(expect.objectContaining({
      type: 'typed_error',
      error: expect.objectContaining({ code: 'runtime_transfer_invalid_manifest' }),
    }))
    await adapter.dispose()
  })

  test('Given run-1 已 settle 并确认 persisted When 以新 runId 再次 query Then 顺序 run 闭环成功且 bundle 互不冲突', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'kila-remote-adapter-seq-'))
    createdDirs.push(configDir)
    process.env.KILA_CONFIG_DIR = configDir

    const processLike = new FakeRuntimeProcess()
    const supervisor = new RuntimeSupervisor({
      entryPath: '/tmp/pi-runtime.cjs',
      appBootId: 'app-1',
      spawn: () => processLike,
    })
    const adapter = new RemotePiAgentAdapter({ supervisor })
    const tool: AnyAgentTool = {
      name: 'read',
      label: 'Read',
      description: 'read',
      parameters: { type: 'object' } as never,
      execute: async () => ({ content: [{ type: 'text', text: 'tool-ok' }], details: {} }),
    }
    // FakeRuntimeProcess 的 run.start 处理器固定回读 bundle 内 images/0-legacy-0，必须携带图片
    const baseQuery = (runId: string): PiAgentQueryOptions => ({
      sessionId: 'session-1',
      runId,
      prompt: 'hello',
      rawPrompt: 'hello',
      model: 'test-model',
      cwd: configDir,
      channel: { provider: 'custom', baseUrl: 'https://example.test' },
      apiKey: 'secret',
      systemPrompt: 'system',
      tools: [tool],
      promptImages: [{ type: 'image', data: 'c2VjcmV0LWltYWdl', mimeType: 'image/png' }],
    })

    const firstEvents: unknown[] = []
    for await (const event of adapter.query(baseQuery('run-seq-1'))) firstEvents.push(event)
    const firstBundlePath = processLike.runStartPayload?.bundlePath as string

    // 模拟 stream 层的中间确认：settled 之后、下一次 query 之前完成 persisted 闭环
    await expect(adapter.markRunPersisted('session-1', 'run-seq-1', 'message-1')).resolves.toBeUndefined()

    const secondEvents: unknown[] = []
    for await (const event of adapter.query(baseQuery('run-seq-2'))) secondEvents.push(event)
    const secondBundlePath = processLike.runStartPayload?.bundlePath as string

    expect(firstEvents).not.toContainEqual(expect.objectContaining({ type: 'typed_error' }))
    expect(secondEvents).not.toContainEqual(expect.objectContaining({ type: 'typed_error' }))
    expect(processLike.runStartPayload?.runId).toBe('run-seq-2')
    expect(secondBundlePath).not.toBe(firstBundlePath)
    await adapter.dispose()
  })

  test('Given run-1 已 settle 但未确认 persisted When 以相同 runId 再次 query Then 事件流返回 transfer 冲突 typed error', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'kila-remote-adapter-dup-'))
    createdDirs.push(configDir)
    process.env.KILA_CONFIG_DIR = configDir

    const processLike = new FakeRuntimeProcess()
    const supervisor = new RuntimeSupervisor({
      entryPath: '/tmp/pi-runtime.cjs',
      appBootId: 'app-1',
      spawn: () => processLike,
    })
    const adapter = new RemotePiAgentAdapter({ supervisor })
    const tool: AnyAgentTool = {
      name: 'read',
      label: 'Read',
      description: 'read',
      parameters: { type: 'object' } as never,
      execute: async () => ({ content: [{ type: 'text', text: 'tool-ok' }], details: {} }),
    }
    const baseQuery = (): PiAgentQueryOptions => ({
      sessionId: 'session-1',
      runId: 'run-dup',
      prompt: 'hello',
      rawPrompt: 'hello',
      model: 'test-model',
      cwd: configDir,
      channel: { provider: 'custom', baseUrl: 'https://example.test' },
      apiKey: 'secret',
      systemPrompt: 'system',
      tools: [tool],
      promptImages: [{ type: 'image', data: 'c2VjcmV0LWltYWdl', mimeType: 'image/png' }],
    })

    const firstEvents: unknown[] = []
    for await (const event of adapter.query(baseQuery())) firstEvents.push(event)
    expect(firstEvents).not.toContainEqual(expect.objectContaining({ type: 'typed_error' }))

    // 不做 markRunPersisted 直接以同 runId 重发：bundle 目录被上一 run 保留，冲突以 typed_error 事件返回
    const secondEvents: unknown[] = []
    for await (const event of adapter.query(baseQuery())) secondEvents.push(event)
    expect(secondEvents).toContainEqual(expect.objectContaining({
      type: 'typed_error',
      error: expect.objectContaining({ code: 'runtime_transfer_invalid_manifest' }),
    }))
    await adapter.dispose()
  })

  test('Given runId 不在 completedRuns When markRunPersisted Then 宽松模式静默返回、严格模式抛协议错误', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'kila-remote-adapter-strict-'))
    createdDirs.push(configDir)
    process.env.KILA_CONFIG_DIR = configDir

    const processLike = new FakeRuntimeProcess()
    const supervisor = new RuntimeSupervisor({
      entryPath: '/tmp/pi-runtime.cjs',
      appBootId: 'app-1',
      spawn: () => processLike,
    })
    const adapter = new RemotePiAgentAdapter({ supervisor })

    await expect(adapter.markRunPersisted('session-1', 'run-unknown')).resolves.toBeUndefined()
    await expect(adapter.markRunPersisted('session-1', 'run-unknown', undefined, { requireSettledRun: true }))
      .rejects.toThrow('runtime_protocol_desync')
    await adapter.dispose()
  })
})

class FakeRuntimeProcess implements RuntimeProcessLike {
  readonly pid = 1234
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  private controlSequence = 2
  private eventSequence = 1
  private runId = ''
  runStartPayload?: Record<string, unknown> & { runId: string; bundlePath: string }
  bundleSnapshot?: { bootstrapText: string; manifest: unknown; imageText: string }
  protocolVersion = 1
  resetRequested = false
  exited = false

  on(event: 'spawn' | 'exit' | 'message' | 'error', listener: (...args: unknown[]) => void): void {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
  }

  postMessage(message: unknown): void {
    const envelope = message as RuntimeMessageEnvelopeV1<Record<string, unknown>>
    if (envelope.type === 'runtime.handshake') {
      this.emit('message', { data: {
        version: 1,
        channel: 'control',
        sequence: 1,
        type: 'runtime.ready',
        payload: {
          protocolVersion: this.protocolVersion,
          appBootId: 'app-1',
          spawnNonce: (envelope.payload as { spawnNonce: string }).spawnNonce,
          bootId: 'boot-1',
          pid: this.pid,
          runtimeVersion: 'test',
        },
      } satisfies RuntimeMessageEnvelopeV1 })
      return
    }
    if (envelope.type === 'run.start') {
      this.runStartPayload = envelope.payload as Record<string, unknown> & { runId: string; bundlePath: string }
      this.runId = this.runStartPayload.runId
      const bundlePath = this.runStartPayload.bundlePath
      this.bundleSnapshot = {
        bootstrapText: readFileSync(join(bundlePath, 'bootstrap.json'), 'utf8'),
        manifest: JSON.parse(readFileSync(join(bundlePath, 'manifest.json'), 'utf8')),
        imageText: readFileSync(join(bundlePath, 'images/0-legacy-0'), 'utf8'),
      }
      this.emit('message', { data: {
        version: 1,
        channel: 'control',
        sequence: this.controlSequence++,
        type: 'run.submitted',
        payload: { sessionId: 'session-1', runId: this.runId, generation: 0 },
      } satisfies RuntimeMessageEnvelopeV1 })
      this.emitToolCall()
      return
    }
    if (envelope.type === 'tool.result') {
      this.emitRunEvents()
    }
    if (envelope.type === 'tool.update') {
      const payload = envelope.payload as {
        appBootId: string
        bootId: string
        sessionId: string
        generation: number
        runId: string
        toolId: string
        toolCallId: string
        updateSequence: number
      }
      this.emit('message', { data: {
        version: 1,
        channel: 'control',
        sequence: this.controlSequence++,
        type: 'tool.update_ack',
        payload: { ...payload, accepted: true },
      } satisfies RuntimeMessageEnvelopeV1 })
    }
    if (envelope.type === 'run.persisted') {
      const payload = envelope.payload as Record<string, unknown>
      this.emit('message', { data: {
        version: 1,
        channel: 'control',
        sequence: this.controlSequence++,
        type: 'run.persisted_ack',
        payload,
      } satisfies RuntimeMessageEnvelopeV1 })
    }
    if (envelope.type === 'runtime.reset_session') {
      this.resetRequested = true
      const payload = envelope.payload as { sessionId: string }
      this.emit('message', { data: {
        version: 1,
        channel: 'control',
        sequence: this.controlSequence++,
        type: 'runtime.reset_ack',
        payload: { bootId: 'boot-1', sessionId: payload.sessionId, ok: true },
      } satisfies RuntimeMessageEnvelopeV1 })
    }
    if (envelope.type === 'runtime.shutdown') {
      this.exited = true
      this.emit('exit', 0)
    }
  }

  kill(): boolean {
    this.exited = true
    this.emit('exit', 137)
    return true
  }

  private emitToolCall(): void {
    this.emit('message', { data: {
      version: 1,
      channel: 'event',
      sequence: this.eventSequence++,
      type: 'run.event',
      payload: {
        sessionId: 'session-1',
        runId: this.runId,
        generation: 0,
        eventSequence: 1,
        event: { type: 'tool_start', toolUseId: 'tool-1', toolName: 'read', input: { requested: true } },
      },
    } satisfies RuntimeMessageEnvelopeV1 })
    this.emit('message', { data: {
      version: 1,
      channel: 'control',
      sequence: this.controlSequence++,
      type: 'tool.call',
      payload: {
        appBootId: 'app-1',
        bootId: 'boot-1',
        sessionId: 'session-1',
        generation: 0,
        runId: this.runId,
        toolId: 'pi/read',
        toolCallId: 'tool-1',
        toolName: 'read',
        requestedArgs: {},
        approvedArgs: {},
        argsModified: false,
      },
    } satisfies RuntimeMessageEnvelopeV1 })
  }

  private emitRunEvents(): void {
    this.emit('message', { data: {
      version: 1,
      channel: 'event',
      sequence: this.eventSequence++,
      type: 'run.event',
      payload: {
        sessionId: 'session-1',
        runId: this.runId,
        generation: 0,
        eventSequence: 2,
        event: { type: 'tool_result', toolUseId: 'tool-1', result: 'tool-ok', isError: false },
      },
    } satisfies RuntimeMessageEnvelopeV1 })
    this.emit('message', { data: {
      version: 1,
      channel: 'control',
      sequence: this.controlSequence++,
      type: 'run.settled',
      payload: { sessionId: 'session-1', runId: this.runId, generation: 0, finalEventSequence: 2 },
    } satisfies RuntimeMessageEnvelopeV1 })
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
}
