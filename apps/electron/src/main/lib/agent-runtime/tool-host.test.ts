import { describe, expect, test } from 'bun:test'
import type { RuntimeToolCallV1, RuntimeToolDescriptorV1 } from '@kila/shared'
import type { AnyAgentTool } from '../agent-tool-names'
import { createPiToolHostProxies } from './pi-tool-host-bridge'
import { ToolHost } from './tool-host'

const descriptor: RuntimeToolDescriptorV1 = {
  version: 1,
  toolId: 'kila-coding/write',
  name: 'write',
  description: '测试工具',
  parameters: { type: 'object' },
  source: 'kila-coding',
  permission: 'write',
  resultKinds: ['text', 'structured'],
  supportsStreaming: false,
}

function call(overrides: Partial<RuntimeToolCallV1> = {}): RuntimeToolCallV1 {
  return {
    appBootId: 'app-1',
    bootId: 'boot-1',
    sessionId: 'session-1',
    generation: 0,
    runId: 'run-1',
    toolId: descriptor.toolId,
    toolCallId: 'call-1',
    requestedArgs: { path: 'a.txt', content: 'requested' },
    approvedArgs: { path: 'a.txt', content: 'approved' },
    argsModified: true,
    ...overrides,
  }
}

describe('ToolHost / ToolRegistry', () => {
  test('Given 同一个复合 key 被重复调用 When 首次执行尚未结束 Then 不重复执行副作用', async () => {
    const host = new ToolHost()
    let executions = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    host.register(descriptor, {
      execute: async ({ approvedArgs }) => {
        executions += 1
        await gate
        return { text: String(approvedArgs.content), isError: false }
      },
    })

    const first = host.call(call())
    const second = host.call(call({ approvedArgs: { path: 'a.txt', content: 'changed-again' } }))
    release()

    expect(await first).toEqual({ text: 'approved', isError: false })
    expect(await second).toEqual({ text: 'approved', isError: false })
    expect(executions).toBe(1)
  })

  test('Given Permission 修改 approvedArgs When ToolHost 执行 Then executor 只收到 approvedArgs', async () => {
    const host = new ToolHost()
    let received: Record<string, unknown> | undefined
    host.register(descriptor, {
      execute: async ({ approvedArgs }) => {
        received = approvedArgs
        return { text: 'ok', isError: false }
      },
    })

    await host.call(call())
    expect(received).toEqual({ path: 'a.txt', content: 'approved' })
  })

  test('Given pending tool call When cancel Then AbortSignal 被触发且 terminal 结果可复用', async () => {
    const host = new ToolHost()
    let identity: RuntimeToolCallV1 | undefined
    host.register(descriptor, {
      execute: ({ signal }) => new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve({ text: 'cancelled', isError: true }), { once: true })
      }),
    })
    const input = call({ toolCallId: 'call-cancel' })
    identity = input
    const pending = host.call(input)
    expect(host.registry.cancel(identity)).toBe(true)
    expect(await pending).toEqual({ text: 'cancelled', isError: true })
    expect(await host.call(input)).toEqual({ text: 'cancelled', isError: true })
  })

  test('Given 同一产品 turn 内跨 runtime run 迭代 When proxy 以相同 toolCallId 重复执行 Then 返回缓存结果且不重复副作用', async () => {
    // 锁死 ToolHost 的 turn 级幂等作用域：proxy identity 的 runId 是 turn 级 token，
    // 续跑迭代轮转 runtime runId 后重复 toolCallId 仍命中同一 registry 条目。
    // 这是有意设计——对 bash/write 等副作用工具，返回缓存结果比跨迭代重新执行更安全。
    const host = new ToolHost()
    let executions = 0
    const tool: AnyAgentTool = {
      name: 'write',
      label: 'Write',
      description: 'write',
      parameters: { type: 'object' } as never,
      execute: async () => {
        executions += 1
        return { content: [{ type: 'text', text: 'written' }], details: {} }
      },
    }
    const proxies = createPiToolHostProxies(host, [{ tool, kind: 'builtin' }], {
      appBootId: 'main-process',
      bootId: 'in-process',
      sessionId: 'session-1',
      generation: 0,
      runId: 'turn-run-1',
    })
    const proxy = proxies[0]
    if (!proxy) throw new Error('proxy 工具未生成')

    const first = await proxy.execute('call-dup', { path: 'a.txt' } as never)
    const second = await proxy.execute('call-dup', { path: 'a.txt' } as never)

    expect(executions).toBe(1)
    expect(first).toEqual(second)
    expect(first.content).toEqual([{ type: 'text', text: 'written' }])
  })
})

