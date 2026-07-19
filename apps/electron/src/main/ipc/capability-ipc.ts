/**
 * 工作区能力 IPC 处理器
 *
 * MCP/Skill（工作区 + 全局 Agent）
 */

import { shell } from 'electron'
import { AGENT_IPC_CHANNELS } from '@kila/shared'
import type {
  GlobalSkillEntry,
  GlobalSkillDetail,
  GlobalSkillInstallInput,
  GlobalSkillInstallResult,
  WorkspaceMcpConfig,
  SkillMeta,
  WorkspaceCapabilities,
} from '@kila/shared'
import { handle, assertGlobalAgentPathAccess } from './shared'
import {
  getWorkspaceMcpConfig,
  saveWorkspaceMcpConfig,
  getAllWorkspaceSkills,
  getWorkspaceCapabilities,
  deleteWorkspaceSkill,
  toggleWorkspaceSkill,
} from '../lib/agent-workspace-manager'
import {
  deleteGlobalAgentSkill,
  getGlobalSkillLibraryEntries,
  getGlobalAgentSkillDetail,
  getGlobalAgentCapabilities,
  getGlobalAgentMcpConfig,
  installGlobalAgentSkill,
  saveGlobalAgentMcpConfig,
  toggleGlobalAgentSkill,
  updateGlobalAgentSkill,
} from '../lib/global-agent-config-manager'
import {
  getGlobalAgentMcpPath,
  getGlobalAgentSkillsDir,
  getWorkspaceSkillsDir,
} from '../lib/config-paths'
import { assertBoolean, assertString, validateWorkspaceMcpConfig } from './validation'

export function registerCapabilityHandlers(): void {
  // ===== 工作区能力（MCP + Skill） =====

  handle(
    AGENT_IPC_CHANNELS.GET_CAPABILITIES,
    async (_, workspaceSlug: string): Promise<WorkspaceCapabilities> => {
      return getWorkspaceCapabilities(assertString(workspaceSlug, 'workspaceSlug', { nonEmpty: true, max: 128 }))
    }
  )

  handle(
    AGENT_IPC_CHANNELS.GET_MCP_CONFIG,
    async (_, workspaceSlug: string): Promise<WorkspaceMcpConfig> => {
      return getWorkspaceMcpConfig(assertString(workspaceSlug, 'workspaceSlug', { nonEmpty: true, max: 128 }))
    }
  )

  handle(
    AGENT_IPC_CHANNELS.SAVE_MCP_CONFIG,
    async (_, workspaceSlug: string, config: WorkspaceMcpConfig): Promise<void> => {
      return saveWorkspaceMcpConfig(
        assertString(workspaceSlug, 'workspaceSlug', { nonEmpty: true, max: 128 }),
        validateWorkspaceMcpConfig(config),
      )
    }
  )

  // 测试 MCP 服务器连接
  handle(
    AGENT_IPC_CHANNELS.TEST_MCP_SERVER,
    async (_, name: string, entry: import('@kila/shared').McpServerEntry): Promise<{ success: boolean; message: string }> => {
      const { validateMcpServer } = await import('../lib/mcp-validator')
      const result = await validateMcpServer(
        assertString(name, 'MCP server name', { nonEmpty: true, max: 128 }),
        validateWorkspaceMcpConfig({ servers: { [name]: entry } }).servers[name]!,
      )
      return {
        success: result.valid,
        message: result.valid ? '连接成功' : (result.reason || '连接失败'),
      }
    }
  )

  handle(
    AGENT_IPC_CHANNELS.GET_SKILLS,
    async (_, workspaceSlug: string): Promise<SkillMeta[]> => {
      return getAllWorkspaceSkills(assertString(workspaceSlug, 'workspaceSlug', { nonEmpty: true, max: 128 }))
    }
  )

  handle(
    AGENT_IPC_CHANNELS.GET_SKILLS_DIR,
    async (_, workspaceSlug: string): Promise<string> => {
      return getWorkspaceSkillsDir(assertString(workspaceSlug, 'workspaceSlug', { nonEmpty: true, max: 128 }))
    }
  )

  handle(
    AGENT_IPC_CHANNELS.DELETE_SKILL,
    async (_, workspaceSlug: string, skillSlug: string): Promise<void> => {
      return deleteWorkspaceSkill(
        assertString(workspaceSlug, 'workspaceSlug', { nonEmpty: true, max: 128 }),
        assertString(skillSlug, 'skillSlug', { nonEmpty: true, max: 128 }),
      )
    }
  )

  handle(
    AGENT_IPC_CHANNELS.TOGGLE_SKILL,
    async (_, workspaceSlug: string, skillSlug: string, enabled: boolean): Promise<void> => {
      return toggleWorkspaceSkill(
        assertString(workspaceSlug, 'workspaceSlug', { nonEmpty: true, max: 128 }),
        assertString(skillSlug, 'skillSlug', { nonEmpty: true, max: 128 }),
        assertBoolean(enabled, 'enabled'),
      )
    }
  )

  // ===== 全局 Agent 配置 =====

  handle(
    AGENT_IPC_CHANNELS.GET_GLOBAL_CAPABILITIES,
    async (): Promise<WorkspaceCapabilities> => {
      return getGlobalAgentCapabilities()
    }
  )

  handle(
    AGENT_IPC_CHANNELS.GET_GLOBAL_MCP_CONFIG,
    async (): Promise<WorkspaceMcpConfig> => {
      return getGlobalAgentMcpConfig()
    }
  )

  handle(
    AGENT_IPC_CHANNELS.SAVE_GLOBAL_MCP_CONFIG,
    async (_, config: WorkspaceMcpConfig): Promise<void> => {
      const validated = validateWorkspaceMcpConfig(config)
      saveGlobalAgentMcpConfig(validated)
      // 通知 McpServerManager 重新加载连接
      const { mcpServerManager } = await import('../lib/mcp-server-manager')
      await mcpServerManager.reload(validated)
    }
  )

  handle(
    AGENT_IPC_CHANNELS.GET_GLOBAL_MCP_PATH,
    async (): Promise<string> => {
      return getGlobalAgentMcpPath()
    }
  )

  handle(
    AGENT_IPC_CHANNELS.GET_GLOBAL_SKILLS,
    async (): Promise<GlobalSkillEntry[]> => {
      return getGlobalSkillLibraryEntries()
    }
  )

  handle(
    AGENT_IPC_CHANNELS.GET_GLOBAL_SKILL_DETAIL,
    async (_, skillId: string): Promise<GlobalSkillDetail> => {
      return getGlobalAgentSkillDetail(assertString(skillId, 'skillId', { nonEmpty: true, max: 256 }))
    }
  )

  handle(
    AGENT_IPC_CHANNELS.GET_GLOBAL_SKILLS_DIR,
    async (): Promise<string> => {
      return getGlobalAgentSkillsDir()
    }
  )

  handle(
    AGENT_IPC_CHANNELS.INSTALL_GLOBAL_SKILL,
    async (_, input: GlobalSkillInstallInput): Promise<GlobalSkillInstallResult> => {
      return installGlobalAgentSkill({
        repoUrl: assertString(input?.repoUrl, 'repoUrl', { nonEmpty: true, max: 2048 }),
        subdir: input?.subdir ? assertString(input.subdir, 'subdir', { max: 512 }) : undefined,
        slug: input?.slug ? assertString(input.slug, 'slug', { max: 128 }) : undefined,
      })
    }
  )

  handle(
    AGENT_IPC_CHANNELS.UPDATE_GLOBAL_SKILL,
    async (_, skillSlug: string): Promise<GlobalSkillInstallResult> => {
      return updateGlobalAgentSkill(assertString(skillSlug, 'skillSlug', { nonEmpty: true, max: 128 }))
    }
  )

  handle(
    AGENT_IPC_CHANNELS.DELETE_GLOBAL_SKILL,
    async (_, skillSlug: string): Promise<void> => {
      deleteGlobalAgentSkill(assertString(skillSlug, 'skillSlug', { nonEmpty: true, max: 128 }))
    }
  )

  handle(
    AGENT_IPC_CHANNELS.TOGGLE_GLOBAL_SKILL,
    async (_, skillSlug: string, enabled: boolean): Promise<void> => {
      toggleGlobalAgentSkill(
        assertString(skillSlug, 'skillSlug', { nonEmpty: true, max: 128 }),
        assertBoolean(enabled, 'enabled'),
      )
    }
  )

  handle(
    AGENT_IPC_CHANNELS.OPEN_GLOBAL_PATH,
    async (_, filePath: string): Promise<void> => {
      const safePath = assertGlobalAgentPathAccess(filePath)
      await shell.openPath(safePath)
    }
  )
}
