import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBashTool } from './bash-tool'
import { createCodingPathPolicy } from './path-policy'

describe('Kila bash tool', () => {
  test('Given approved command When execute Then 使用 session/toolCall 追踪并传递毫秒转秒的 timeout', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kila-bash-tool-'))
    const policy = createCodingPathPolicy({ sessionId: 'session-bash', cwd: root })
    let received: { sessionId: string; toolCallId: string; timeout?: number } | undefined
    const tool = createBashTool(policy, {
      createOperations: (sessionId, toolCallId) => ({
        exec: async (_command, _cwd, options) => {
          received = { sessionId, toolCallId, timeout: options.timeout }
          options.onData(Buffer.from('hello'))
          return { exitCode: 0 }
        },
      }),
    })

    const result = await tool.execute('call-bash', { command: 'printf hello', timeout: 2_000 })

    expect(received).toEqual({ sessionId: 'session-bash', toolCallId: 'call-bash', timeout: 2 })
    expect(result.text).toBe('hello')
    expect(result.details).toMatchObject({ exitCode: 0, processId: 'call-bash' })
  })

  test('Given timeout 小于 1 秒 When execute Then 在产生副作用前拒绝', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kila-bash-tool-invalid-'))
    const policy = createCodingPathPolicy({ sessionId: 'session-bash', cwd: root })
    let executed = false
    const tool = createBashTool(policy, {
      createOperations: () => ({
        exec: async () => {
          executed = true
          return { exitCode: 0 }
        },
      }),
    })

    await expect(tool.execute('call-bash', { command: 'echo nope', timeout: 999 })).rejects.toMatchObject({
      code: 'coding_bash_invalid_timeout',
    })
    expect(executed).toBe(false)
  })

  test('Given AbortSignal 在命令运行中触发 When execute Then 传给执行器并收敛为 abort 结果', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kila-bash-tool-abort-'))
    const policy = createCodingPathPolicy({ sessionId: 'session-bash', cwd: root })
    const controller = new AbortController()
    let aborted = false
    const tool = createBashTool(policy, {
      createOperations: () => ({
        exec: async (_command, _cwd, options) => new Promise((resolve) => {
          options.signal?.addEventListener('abort', () => {
            aborted = true
            resolve({ exitCode: null })
          }, { once: true })
        }),
      }),
    })

    const pending = tool.execute('call-abort', { command: 'sleep 1' }, controller.signal)
    controller.abort()

    expect(await pending).toMatchObject({ text: '(命令没有输出)' })
    expect(aborted).toBe(true)
  })
})
