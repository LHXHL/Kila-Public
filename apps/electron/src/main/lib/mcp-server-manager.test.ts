/**
 * MCP 连接生命周期回归测试
 *
 * 覆盖 P0：MCP 连接从不关闭导致 stdio 子进程必然泄漏。
 * 断开、连接失败、shutdown、reload 重连四条路径都必须真正调用 close。
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { McpServerEntry } from '@kila/shared'
import {
  McpServerClient,
  McpServerManager,
  isSecretEnvName,
  type McpConnectionFactory,
  type McpRuntimeClient,
  type McpTransportLike,
} from './mcp-server-manager'

const originalConfigDir = process.env.KILA_CONFIG_DIR
const tempDirs: string[] = []

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'kila-mcp-manager-'))
  tempDirs.push(dir)
  process.env.KILA_CONFIG_DIR = dir
})

afterAll(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  if (typeof originalConfigDir === 'string') {
    process.env.KILA_CONFIG_DIR = originalConfigDir
  } else {
    delete process.env.KILA_CONFIG_DIR
  }
})

interface ConnectionSpy {
  factory: McpConnectionFactory
  clientCloseCount: number
  transportCloseCount: number
  createdClients: number
}

function createConnectionSpy(options: {
  connectFails?: boolean
  clientCloseFails?: boolean
} = {}): ConnectionSpy {
  const spy: ConnectionSpy = {
    clientCloseCount: 0,
    transportCloseCount: 0,
    createdClients: 0,
    factory: {
      createClient: (): McpRuntimeClient => {
        spy.createdClients += 1
        return {
          connect: async () => {
            if (options.connectFails) throw new Error('连接失败')
          },
          close: async () => {
            spy.clientCloseCount += 1
            if (options.clientCloseFails) throw new Error('关闭失败')
          },
          listTools: async () => ({ tools: [] }),
          callTool: async () => ({ content: [] }),
        }
      },
      createTransport: (): McpTransportLike => ({
        close: async () => {
          spy.transportCloseCount += 1
        },
      }),
    },
  }
  return spy
}

const HTTP_ENTRY: McpServerEntry = {
  type: 'http',
  url: 'https://example.com/mcp',
  enabled: true,
}

function createManager(spy: ConnectionSpy): McpServerManager {
  return new McpServerManager(
    (serverName, entry, baseDir) => new McpServerClient(serverName, entry, baseDir, spy.factory),
  )
}

describe('单个 MCP 客户端的关闭行为', () => {
  test('Given 已连接的客户端 When disconnect Then 真正调用 client.close 并清空运行状态', async () => {
    const spy = createConnectionSpy()
    const client = new McpServerClient('srv', HTTP_ENTRY, undefined, spy.factory)

    await client.connect()
    expect(client.isRunning()).toBe(true)

    await client.disconnect()

    expect(spy.clientCloseCount).toBe(1)
    expect(client.isRunning()).toBe(false)
  })

  test('Given client.close 抛错 When disconnect Then 兜底关闭 transport 回收子进程', async () => {
    const spy = createConnectionSpy({ clientCloseFails: true })
    const client = new McpServerClient('srv', HTTP_ENTRY, undefined, spy.factory)

    await client.connect()
    await client.disconnect()

    expect(spy.clientCloseCount).toBe(1)
    expect(spy.transportCloseCount).toBe(1)
    expect(client.isRunning()).toBe(false)
  })

  test('Given 连接失败 When connect 抛出 Then 已创建的连接被关闭而不是直接丢弃引用', async () => {
    const spy = createConnectionSpy({ connectFails: true })
    const client = new McpServerClient('srv', HTTP_ENTRY, undefined, spy.factory)

    await expect(client.connect()).rejects.toThrow('连接失败')

    expect(spy.clientCloseCount).toBe(1)
    expect(client.isRunning()).toBe(false)
  })

  test('Given 从未连接的客户端 When disconnect Then 安全返回且不调用 close', async () => {
    const spy = createConnectionSpy()
    const client = new McpServerClient('srv', HTTP_ENTRY, undefined, spy.factory)

    await client.disconnect()

    expect(spy.clientCloseCount).toBe(0)
    expect(spy.transportCloseCount).toBe(0)
  })
})

describe('连接池 shutdown', () => {
  test('Given 多个已连接服务器 When shutdown Then 等待全部 close 完成再清空连接池', async () => {
    const spy = createConnectionSpy()
    const manager = createManager(spy)

    await manager.startServer('a', HTTP_ENTRY)
    await manager.startServer('b', HTTP_ENTRY)
    expect(manager.getRunningClients()).toHaveLength(2)

    await manager.shutdown()

    expect(spy.clientCloseCount).toBe(2)
    expect(manager.getClient('a')).toBeUndefined()
    expect(manager.getClient('b')).toBeUndefined()
    expect(manager.getRunningClients()).toHaveLength(0)
  })

  test('Given 某个服务器关闭失败 When shutdown Then 其余服务器仍被关闭且连接池清空', async () => {
    const spy = createConnectionSpy({ clientCloseFails: true })
    const manager = createManager(spy)

    await manager.startServer('a', HTTP_ENTRY)
    await manager.startServer('b', HTTP_ENTRY)

    await manager.shutdown()

    expect(spy.clientCloseCount).toBe(2)
    expect(spy.transportCloseCount).toBe(2)
    expect(manager.getRunningClients()).toHaveLength(0)
  })
})

describe('reload 结构化对比连接参数', () => {
  test('Given 已启用服务器的 command 变更 When reload Then 停掉旧连接并按新配置重连', async () => {
    const spy = createConnectionSpy()
    const manager = createManager(spy)

    const before: McpServerEntry = { type: 'stdio', command: 'ls', enabled: true }
    await manager.startServer('srv', before)
    const firstClient = manager.getClient('srv')

    await manager.reload({ servers: { srv: { type: 'stdio', command: 'echo', enabled: true } } })

    expect(spy.clientCloseCount).toBe(1)
    expect(manager.getClient('srv')).not.toBe(firstClient)
    expect(manager.getClient('srv')?.entry.command).toBe('echo')
    expect(manager.isServerRunning('srv')).toBe(true)
  })

  test('Given 已启用服务器的 url 变更 When reload Then 同样重连', async () => {
    const spy = createConnectionSpy()
    const manager = createManager(spy)

    await manager.startServer('srv', HTTP_ENTRY)
    const firstClient = manager.getClient('srv')

    await manager.reload({
      servers: { srv: { type: 'http', url: 'https://other.example.com/mcp', enabled: true } },
    })

    expect(spy.clientCloseCount).toBe(1)
    expect(manager.getClient('srv')).not.toBe(firstClient)
    expect(manager.getClient('srv')?.entry.url).toBe('https://other.example.com/mcp')
  })

  test('Given 配置完全没变 When reload Then 复用原连接不重连', async () => {
    const spy = createConnectionSpy()
    const manager = createManager(spy)

    await manager.startServer('srv', HTTP_ENTRY)
    const firstClient = manager.getClient('srv')

    await manager.reload({ servers: { srv: { ...HTTP_ENTRY } } })

    expect(spy.clientCloseCount).toBe(0)
    expect(manager.getClient('srv')).toBe(firstClient)
  })

  test('Given 服务器被禁用或移除 When reload Then 关闭连接', async () => {
    const spy = createConnectionSpy()
    const manager = createManager(spy)

    await manager.startServer('disabled', HTTP_ENTRY)
    await manager.startServer('removed', HTTP_ENTRY)

    await manager.reload({ servers: { disabled: { ...HTTP_ENTRY, enabled: false } } })

    expect(spy.clientCloseCount).toBe(2)
    expect(manager.getClient('disabled')).toBeUndefined()
    expect(manager.getClient('removed')).toBeUndefined()
  })
})

describe('session 级自定义连接登记进连接池', () => {
  test('Given 自定义服务器 When ensureCustomServer Then 登记到连接池并可被 shutdown 关闭', async () => {
    const spy = createConnectionSpy()
    const manager = createManager(spy)

    const client = await manager.ensureCustomServer({
      registryKey: 'custom:session-1:my-server',
      serverName: 'my-server',
      entry: HTTP_ENTRY,
    })

    expect(client.serverName).toBe('my-server')
    expect(manager.getClient('custom:session-1:my-server')).toBe(client)

    await manager.shutdown()
    expect(spy.clientCloseCount).toBe(1)
  })

  test('Given 同一自定义服务器 When 重复 ensureCustomServer Then 复用连接而不是每轮新建', async () => {
    const spy = createConnectionSpy()
    const manager = createManager(spy)

    const first = await manager.ensureCustomServer({
      registryKey: 'custom:session-1:my-server',
      serverName: 'my-server',
      entry: HTTP_ENTRY,
    })
    const second = await manager.ensureCustomServer({
      registryKey: 'custom:session-1:my-server',
      serverName: 'my-server',
      entry: HTTP_ENTRY,
    })

    expect(second).toBe(first)
    expect(spy.createdClients).toBe(1)
  })

  test('Given 全局配置里没有自定义服务器 When reload Then 自定义连接不被误停', async () => {
    const spy = createConnectionSpy()
    const manager = createManager(spy)

    await manager.ensureCustomServer({
      registryKey: 'custom:session-1:my-server',
      serverName: 'my-server',
      entry: HTTP_ENTRY,
    })

    await manager.reload({ servers: {} })

    expect(spy.clientCloseCount).toBe(0)
    expect(manager.getClient('custom:session-1:my-server')?.isRunning()).toBe(true)
  })
})

describe('stdio 子进程环境变量收窄', () => {
  test('Given 疑似凭证的变量名 When 判断 Then 全部识别为需要过滤', () => {
    const secretNames = [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'GITHUB_TOKEN',
      'GH_TOKEN',
      'NPM_TOKEN',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_SESSION_TOKEN',
      'DB_PASSWORD',
      'SOME_CREDENTIAL',
      'MY_PRIVATE_KEY',
    ]

    for (const name of secretNames) {
      expect(isSecretEnvName(name)).toBe(true)
    }
  })

  test('Given 常规开发变量 When 判断 Then 保留不过滤', () => {
    const keepNames = ['PATH', 'HOME', 'LANG', 'TMPDIR', 'SHELL', 'NODE_OPTIONS', 'NODE_ENV', 'KEYBOARD_LAYOUT']

    for (const name of keepNames) {
      expect(isSecretEnvName(name)).toBe(false)
    }
  })
})
