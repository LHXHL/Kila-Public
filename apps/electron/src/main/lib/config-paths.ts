/**
 * 配置路径工具 — 核心路径与通用配置
 *
 * 管理 ~/.kila/ 目录下的通用配置文件路径。
 * 领域特定路径已拆分至：
 *   - config-paths-skills.ts  — Skills 相关路径与同步
 *   - config-paths-bridge.ts  — IM Bridge 路径
 *   - config-paths-tasks.ts   — 定时任务路径
 *
 * 本文件同时作为 re-export barrel，保持所有消费者零改动。
 */

import { isAbsolute, join, relative, resolve } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'


import { createLogger } from './logger'
const log = createLogger('配置')

const CONFIG_DIR_NAME = '.kila'

export function getConfigDir(): string {
  const overriddenDir = process.env.KILA_CONFIG_DIR?.trim()
  const configDir = overriddenDir
    ? (isAbsolute(overriddenDir) ? overriddenDir : resolve(overriddenDir))
    : join(homedir(), CONFIG_DIR_NAME)

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
    log.info(`[配置] 已创建配置目录: ${configDir}`)
  }

  return configDir
}

// ===== 文件路径（无目录初始化） =====

export function getChannelsPath(): string {
  return join(getConfigDir(), 'channels.json')
}

export function getSettingsPath(): string {
  return join(getConfigDir(), 'settings.json')
}

export function getTokenUsagePath(): string {
  return join(getConfigDir(), 'token-usage.jsonl')
}

export function getTokenUsageMonthPath(monthKey: string): string {
  return join(getConfigDir(), `token-usage-${monthKey}.jsonl`)
}

export function getSearchIndexPath(): string {
  return join(getConfigDir(), 'search-index.json')
}

export function getUserProfilePath(): string {
  return join(getConfigDir(), 'user-profile.json')
}


export function getProxySettingsPath(): string {
  return join(getConfigDir(), 'proxy-settings.json')
}

export function getSystemPromptsPath(): string {
  return join(getConfigDir(), 'system-prompts.json')
}

export function getPersonalitySoulPath(): string {
  return join(getConfigDir(), 'SOUL.md')
}

export function getPersonalityUserPath(): string {
  return join(getConfigDir(), 'USER.md')
}

export function getUserProfileAutomationStatePath(): string {
  return join(getConfigDir(), 'user-profile.automation.json')
}

export function getLegacySystemPromptsArchivePath(): string {
  return join(getConfigDir(), 'system-prompts.legacy.json')
}

export function getCliBridgeDiscoveryPath(): string {
  return join(getConfigDir(), 'cli-bridge.json')
}

export function getAgentToolsConfigPath(): string {
  return join(getConfigDir(), 'agent-tools.json')
}

export function getLegacyChatToolsConfigPath(): string {
  return join(getConfigDir(), 'chat-tools.json')
}

export function getMemoryStateStorePath(): string {
  return join(getConfigDir(), 'memory-state.json')
}

export function getSessionsIndexPath(): string {
  return join(getConfigDir(), 'sessions.json')
}

export function getSessionMessagesPath(id: string): string {
  return join(getSessionsDir(), `${id}.jsonl`)
}

/** Pi SDK 的独立 agentDir；仅承载 Pi 运行时资源边界，不替代 Kila 配置真相源。 */
export function getPiAgentDir(): string {
  const dir = join(getConfigDir(), 'pi-agent')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    log.info(`[配置] 已创建 Pi Agent 运行时目录: ${dir}`)
  }
  return dir
}

export function getPiSessionsDir(): string {
  const dir = join(getConfigDir(), 'pi-sessions')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    log.info(`[配置] 已创建 Pi Session sidecar 目录: ${dir}`)
  }
  return dir
}

export function getAuditLogPath(): string {
  return join(getConfigDir(), 'audit.jsonl')
}

/**
 * 将外部传入的 ID 净化为单个安全目录名
 *
 * 只保留 `[a-zA-Z0-9_-]`，其余字符（含 `.`、`/`、`\`、NUL）一律替换为 `_`，
 * 从根本上消除 `../../../tmp/x` 这类目录穿越写入。
 * Session ID 由 randomUUID() 生成，净化对合法 ID 是无操作。
 */
export function safePathSegment(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('路径片段不能为空')
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

export function getPiSessionDir(sessionId: string): string {
  const dir = join(getPiSessionsDir(), safePathSegment(sessionId))
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getAgentWorkspacesIndexPath(): string {
  return join(getConfigDir(), 'agent-workspaces.json')
}

export function getWorkspaceMcpPath(slug: string): string {
  return join(getAgentWorkspacePath(slug), 'mcp.json')
}

export function getProjectProfileConfigPath(profileId: string): string {
  return join(getProjectProfilePath(profileId), 'config.json')
}

export function getGlobalAgentMcpPath(): string {
  return join(getGlobalAgentConfigDir(), 'mcp.json')
}

export function getGlobalAgentStatePath(): string {
  return join(getGlobalAgentConfigDir(), 'config.json')
}

/**
 * 将附件的 localPath 解析为磁盘绝对路径
 *
 * 默认只接受 `{conversationId}/{uuid}.ext` 形式的相对路径，并强制约束在
 * `~/.kila/attachments/` 内；任何越界（`../`）或绝对路径都会抛错。
 *
 * `allowAbsolute` 仅供「已在上层完成白名单校验」的存量绝对路径附件使用
 * （会话导入导出 / 历史消息转换），不得在 IPC 入口直接开启。
 */
export function resolveAttachmentPath(localPath: string, options: { allowAbsolute?: boolean } = {}): string {
  if (typeof localPath !== 'string') {
    throw new Error('附件路径必须是字符串')
  }
  if (localPath.includes('\0')) {
    throw new Error('附件路径包含非法字符')
  }

  if (isAbsolute(localPath)) {
    if (options.allowAbsolute) {
      return resolve(localPath)
    }
    throw new Error('附件路径必须是相对路径')
  }

  const attachmentsDir = resolve(getAttachmentsDir())
  const fullPath = resolve(attachmentsDir, localPath)
  const rel = relative(attachmentsDir, fullPath)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('附件路径越界')
  }
  return fullPath
}

// ===== 目录路径（含自动创建） =====

export function getThemesDir(): string {
  const dir = join(getConfigDir(), 'themes')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    log.info(`[配置] 已创建主题目录: ${dir}`)
  }
  return dir
}

export function getAttachmentsDir(): string {
  const dir = join(getConfigDir(), 'attachments')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    log.info(`[配置] 已创建附件目录: ${dir}`)
  }
  return dir
}

/**
 * 获取某个会话的附件目录（会话 ID 先净化，杜绝目录穿越写入）
 */
export function getConversationAttachmentsDir(conversationId: string): string {
  const dir = join(getAttachmentsDir(), safePathSegment(conversationId))
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getSessionsDir(): string {
  const dir = join(getConfigDir(), 'sessions')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    log.info(`[配置] 已创建统一 Session 目录: ${dir}`)
  }
  return dir
}

export function getAgentWorkspacesDir(): string {
  const dir = join(getConfigDir(), 'agent-workspaces')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    log.info(`[配置] 已创建 Agent 工作区目录: ${dir}`)
  }
  return dir
}

export function getAgentWorkspacePath(slug: string): string {
  const dir = join(getAgentWorkspacesDir(), slug)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    log.info(`[配置] 已创建 Agent 工作区: ${dir}`)
  }
  return dir
}

export function getProjectProfilesDir(): string {
  const dir = join(getConfigDir(), 'project-profiles')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    log.info(`[配置] 已创建项目 profile 目录: ${dir}`)
  }
  return dir
}

export function getProjectProfilePath(profileId: string): string {
  const dir = join(getProjectProfilesDir(), profileId)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    log.info(`[配置] 已创建项目 profile: ${dir}`)
  }
  return dir
}

export function getTempSessionProjectsDir(): string {
  const dir = join(tmpdir(), 'Kila', 'session-projects')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    log.info(`[配置] 已创建临时项目目录根: ${dir}`)
  }
  return dir
}

export function getTempSessionProjectPath(sessionId: string): string {
  const dir = join(getTempSessionProjectsDir(), sessionId)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getAgentSessionWorkspacePath(workspaceSlug: string, sessionId: string): string {
  const dir = join(getAgentWorkspacePath(workspaceSlug), sessionId)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    log.info(`[配置] 已创建 Agent 会话工作目录: ${dir}`)
  }
  return dir
}

export function getGlobalAgentConfigDir(): string {
  const dir = join(getConfigDir(), 'global-agent')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    log.info(`[配置] 已创建全局 Agent 配置目录: ${dir}`)
  }
  return dir
}

export function getSdkConfigDir(): string {
  const dir = join(getConfigDir(), 'sdk-config')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    log.info(`[配置] 已创建 SDK 配置目录: ${dir}`)
  }
  return dir
}

export function getDailyNotesDir(): string {
  const dir = join(getConfigDir(), 'daily-notes')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    log.info(`[配置] 已创建每日笔记目录: ${dir}`)
  }
  return dir
}

export function getDailyNotePath(dateStr: string): string {
  return join(getDailyNotesDir(), `${dateStr}.md`)
}

// ===== 领域子模块 re-export（保持消费者零改动） =====

export {
  getWorkspaceSkillsDir,
  getWorkspaceFilesDir,
  getInactiveSkillsDir,
  getGlobalAgentSkillsDir,
  getGlobalAgentInactiveSkillsDir,
  getAlmaSkillsDir,
  getCodexRootDir,
  getCodexSkillsDir,
  getCodexPluginsDir,
  getClaudeRootDir,
  getClaudeSkillsDir,
  getClaudeHackSkillsDir,
  getClaudePluginsDir,
  getGlobalSkillLibraryBrowseRoots,
  getBuiltinSkillSourceDirs,
} from './config-paths-skills'

export {
  getImBridgeDir,
  getImBridgeConfigPath,
  getImBridgeBindingsPath,
  getImBridgeRuntimePath,
  getImBridgeFilesDir,
  getImBridgeSessionFilesDir,
  getImBridgeAuditDir,
} from './config-paths-bridge'

export {
  getScheduledTasksDir,
  getScheduledTasksIndexPath,
  getScheduledTaskRunsDir,
  getScheduledTaskRunPath,
} from './config-paths-tasks'
