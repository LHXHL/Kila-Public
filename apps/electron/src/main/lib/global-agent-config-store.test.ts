import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { McpServerEntry, WorkspaceMcpConfig } from '@kila/shared'
import {
  getGlobalAgentMcpConfig,
  isGlobalAgentConfigDegraded,
  mutateGlobalAgentMcpConfig,
  saveGlobalAgentMcpConfig,
} from './global-agent-config-store'
import { toggleGlobalAgentMcpServer } from './global-agent-config-manager'

const tempDirs: string[] = []
const originalConfigDir = process.env.KILA_CONFIG_DIR

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  if (typeof originalConfigDir === 'string') {
    process.env.KILA_CONFIG_DIR = originalConfigDir
  } else {
    delete process.env.KILA_CONFIG_DIR
  }
})

interface McpTestContext {
  configDir: string
  mcpDir: string
  mcpPath: string
}

function createConfigDir(): McpTestContext {
  const configDir = mkdtempSync(join(tmpdir(), 'kila-global-agent-test-'))
  tempDirs.push(configDir)
  process.env.KILA_CONFIG_DIR = configDir

  const mcpDir = join(configDir, 'global-agent')
  mkdirSync(mcpDir, { recursive: true })
  return { configDir, mcpDir, mcpPath: join(mcpDir, 'mcp.json') }
}

function server(name: string, enabled: boolean): McpServerEntry {
  return { type: 'stdio', command: `/bin/${name}`, args: ['mcp'], enabled }
}

function writeMcpFile(context: McpTestContext, config: WorkspaceMcpConfig): void {
  writeFileSync(context.mcpPath, JSON.stringify(config, null, 2), 'utf-8')
}

function readMcpFile(context: McpTestContext): WorkspaceMcpConfig {
  return JSON.parse(readFileSync(context.mcpPath, 'utf-8')) as WorkspaceMcpConfig
}

describe('全局 Agent MCP 配置护栏', () => {
  test('Given 配置文件不存在，When 读取，Then 视为可信首装并允许写入', () => {
    const context = createConfigDir()

    expect(getGlobalAgentMcpConfig()).toEqual({ servers: {} })
    expect(isGlobalAgentConfigDegraded(context.mcpPath)).toBe(false)

    saveGlobalAgentMcpConfig({ servers: { alpha: server('alpha', true) } })

    expect(readMcpFile(context).servers.alpha!.enabled).toBe(true)
    expect(existsSync(`${context.mcpPath}.bak`)).toBe(true)
  })

  test('Given 主文件损坏但备份有效，When 读取，Then 从备份恢复而不是返回空配置', () => {
    const context = createConfigDir()
    saveGlobalAgentMcpConfig({ servers: { alpha: server('alpha', true) } })
    writeFileSync(context.mcpPath, '{ 写到一半', 'utf-8')

    expect(Object.keys(getGlobalAgentMcpConfig().servers)).toEqual(['alpha'])
    expect(isGlobalAgentConfigDegraded(context.mcpPath)).toBe(false)
  })

  test('Given 主备双双损坏，When 读取，Then 留档并进入降级而不是静默返回空对象', () => {
    const context = createConfigDir()
    saveGlobalAgentMcpConfig({ servers: { alpha: server('alpha', true) } })
    writeFileSync(context.mcpPath, '{ 主文件坏了', 'utf-8')
    writeFileSync(`${context.mcpPath}.bak`, '{ 备份也坏了', 'utf-8')

    expect(getGlobalAgentMcpConfig()).toEqual({ servers: {} })
    expect(isGlobalAgentConfigDegraded(context.mcpPath)).toBe(true)
    expect(readdirSync(context.mcpDir).filter((name) => name.includes('mcp.json.corrupt-'))).toHaveLength(2)
    // 降级后任何写入都必须失败，否则用户所有 MCP 服务器会被空配置永久固化
    expect(() => saveGlobalAgentMcpConfig({ servers: {} })).toThrow(/降级只读/)
    expect(existsSync(context.mcpPath)).toBe(false)
  })

  test('Given servers 字段结构非法，When 读取，Then 按损坏处理而不是当作空服务器列表', () => {
    const context = createConfigDir()
    writeMcpFile(context, { servers: ['alpha'] } as unknown as WorkspaceMcpConfig)

    expect(getGlobalAgentMcpConfig()).toEqual({ servers: {} })
    expect(isGlobalAgentConfigDegraded(context.mcpPath)).toBe(true)
  })

  test('Given 手里的快照已过期，When 通过 mutate 改写，Then 读改写在同一临界区内取到最新落盘内容', () => {
    const context = createConfigDir()
    saveGlobalAgentMcpConfig({ servers: { alpha: server('alpha', false) } })
    const staleSnapshot = getGlobalAgentMcpConfig()

    // 模拟并发写入：另一条链路在快照之后又注册了一个服务器
    writeMcpFile(context, {
      servers: { ...staleSnapshot.servers, beta: server('beta', true) },
    })

    mutateGlobalAgentMcpConfig((current) => ({
      ...current,
      servers: { ...current.servers, alpha: { ...current.servers.alpha!, enabled: true } },
    }))

    const persisted = readMcpFile(context)
    expect(Object.keys(persisted.servers).sort()).toEqual(['alpha', 'beta'])
    expect(persisted.servers.alpha!.enabled).toBe(true)
  })

  test('Given mutate 回调里再次触发写入，When 执行，Then 以重入错误暴露嵌套读改写', () => {
    createConfigDir()
    saveGlobalAgentMcpConfig({ servers: { alpha: server('alpha', true) } })

    expect(() => mutateGlobalAgentMcpConfig((current) => {
      saveGlobalAgentMcpConfig(current)
      return current
    })).toThrow(/临界区重入/)

    // 重入抛错后锁必须释放，正常写入不受影响
    expect(() => saveGlobalAgentMcpConfig({ servers: {} })).not.toThrow()
  })

  test('Given 切换开关期间有其他服务器写入，When 执行 toggle，Then 只改目标服务器且不吞掉并发改动', () => {
    const context = createConfigDir()
    writeMcpFile(context, { servers: { alpha: server('alpha', false) } })

    toggleGlobalAgentMcpServer('alpha', true)
    // toggle 之后再注册一个服务器，随后再次 toggle，验证不会整段覆盖
    writeMcpFile(context, { ...readMcpFile(context), servers: { ...readMcpFile(context).servers, gamma: server('gamma', true) } })
    toggleGlobalAgentMcpServer('alpha', false)

    const persisted = readMcpFile(context)
    expect(Object.keys(persisted.servers).sort()).toEqual(['alpha', 'gamma'])
    expect(persisted.servers.alpha!.enabled).toBe(false)
    expect(persisted.servers.gamma!.enabled).toBe(true)
  })
})
