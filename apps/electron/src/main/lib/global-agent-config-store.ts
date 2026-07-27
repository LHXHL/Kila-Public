/**
 * Global agent config store
 *
 * ~/.kila/global-agent/ 下两份配置的持久化层：
 *   - config.json —— 全局 Agent 状态（当前只有已删除 Skill 名单）
 *   - mcp.json    —— 全局 MCP 服务器配置
 *
 * 两份文件都遵循同一套护栏：原子写 + 备份、主备双失败时留档并进入降级只读、
 * mcp.json 的「读-改-写」收拢进同步互斥临界区。
 */

import { existsSync } from 'node:fs'
import type { WorkspaceMcpConfig } from '@kila/shared'
import { getGlobalAgentMcpPath, getGlobalAgentStatePath } from './config-paths'
import { readJsonWithBackup, writeTextAtomicWithBackup } from './safe-json-file'
import { createConfigMutex, createDegradedConfigRegistry, degradeCorruptConfig } from './config-file-guard'

import { createLogger } from './logger'
const log = createLogger('全局 Agent 配置')

export interface GlobalAgentState {
  deletedSkillSlugs?: string[]
}

/**
 * 全局 Agent 配置降级只读登记表。
 *
 * mcp.json / config.json 解析失败时内存里只有空对象；写回会让用户所有 MCP 服务器
 * 与已删除 Skill 记录「凭空消失」，且下一次开关操作会把空配置固化成永久状态。
 */
const degradedConfigs = createDegradedConfigRegistry()

/** mcp.json 的同步互斥临界区：保证「读-改-写」不会被并发写入穿插覆盖 */
const mcpConfigMutex = createConfigMutex('global-agent/mcp.json')

function assertWritable(filePath: string, label: string, lossHint: string): void {
  const degradedReason = degradedConfigs.getDegradedReason(filePath)
  if (!degradedReason) return

  log.error(`[全局 Agent 配置] ${label}处于降级只读模式，已拒绝写入: ${degradedReason}`)
  throw new Error(`${label}处于降级只读模式，已拒绝写入以避免${lossHint}（${degradedReason}）`)
}

export function readGlobalAgentState(): GlobalAgentState {
  const configPath = getGlobalAgentStatePath()

  // 文件不存在是可信的首次运行；「存在但读不出来」才是不可信状态。
  if (!existsSync(configPath)) {
    return {}
  }

  try {
    return readJsonWithBackup(configPath, (raw) => {
      const parsed = JSON.parse(raw) as GlobalAgentState
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('全局 Agent 状态不是合法的 JSON 对象')
      }
      return parsed
    })
  } catch (error) {
    degradeCorruptConfig(degradedConfigs, { filePath: configPath, label: '全局 Agent 状态', error })
    return {}
  }
}

export function writeGlobalAgentState(state: GlobalAgentState): void {
  const configPath = getGlobalAgentStatePath()
  assertWritable(configPath, '全局 Agent 状态', '已删除 Skill 名单丢失')
  writeTextAtomicWithBackup(configPath, JSON.stringify(state, null, 2))
}

export function getGlobalAgentMcpConfig(): WorkspaceMcpConfig {
  const mcpPath = getGlobalAgentMcpPath()

  if (!existsSync(mcpPath)) {
    return { servers: {} }
  }

  try {
    return readJsonWithBackup(mcpPath, (raw) => {
      const parsed = JSON.parse(raw) as Partial<WorkspaceMcpConfig>
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('MCP 配置不是合法的 JSON 对象')
      }
      if (
        parsed.servers !== undefined
        && (typeof parsed.servers !== 'object' || parsed.servers === null || Array.isArray(parsed.servers))
      ) {
        throw new Error('MCP 配置的 servers 字段不是对象')
      }
      return { servers: parsed.servers ?? {} }
    })
  } catch (error) {
    degradeCorruptConfig(degradedConfigs, { filePath: mcpPath, label: '全局 Agent MCP 配置', error })
    return { servers: {} }
  }
}

/** 不加锁的底层写入；只允许在 mcpConfigMutex 临界区内调用 */
function writeMcpConfigUnlocked(config: WorkspaceMcpConfig): void {
  const mcpPath = getGlobalAgentMcpPath()
  assertWritable(mcpPath, '全局 Agent MCP 配置', 'MCP 服务器丢失')
  writeTextAtomicWithBackup(mcpPath, JSON.stringify(config, null, 2))
}

export function saveGlobalAgentMcpConfig(config: WorkspaceMcpConfig): void {
  mcpConfigMutex.runExclusive(() => writeMcpConfigUnlocked(config))
}

/**
 * 在同一个同步临界区内完成 mcp.json 的「读-改-写」。
 *
 * 分开调用 get + save 时，两次调用之间的任何写入都会被后写者整段覆盖；
 * 这里保证 mutate 拿到的一定是最新落盘内容，且写入前不会被穿插。
 */
export function mutateGlobalAgentMcpConfig(
  mutate: (current: WorkspaceMcpConfig) => WorkspaceMcpConfig,
): WorkspaceMcpConfig {
  return mcpConfigMutex.runExclusive(() => {
    const next = mutate(getGlobalAgentMcpConfig())
    writeMcpConfigUnlocked(next)
    return next
  })
}

/** 全局 Agent 配置是否处于降级只读状态（供测试与诊断使用） */
export function isGlobalAgentConfigDegraded(filePath: string): boolean {
  return degradedConfigs.isDegraded(filePath)
}
