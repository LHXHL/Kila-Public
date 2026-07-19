/**
 * Skills 路径工具
 *
 * 管理工作区 Skills、全局 Skills 与内置 Skills 源目录的路径与同步逻辑。
 * 从 config-paths.ts 中按领域拆出。
 */

import { isAbsolute, join, resolve } from 'node:path'
import { mkdirSync, existsSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { getAgentWorkspacePath, getGlobalAgentConfigDir } from './config-paths'
import { createLogger } from './logger'

const log = createLogger('配置')

export function getWorkspaceSkillsDir(slug: string): string {
  const workspaceDir = getAgentWorkspacePath(slug)
  const dir = join(workspaceDir, '.agents', 'skills')
  const legacyDir = join(workspaceDir, 'skills')

  if (existsSync(legacyDir) && !existsSync(dir)) {
    try {
      mkdirSync(join(workspaceDir, '.agents'), { recursive: true })
      renameSync(legacyDir, dir)
      log.info(`[配置] 已迁移工作区 Skills 目录: ${legacyDir} -> ${dir}`)
    } catch (error) {
      log.warn('[配置] 迁移旧 Skills 目录失败，将继续使用新目录:', error)
    }
  }

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  return dir
}

export function getWorkspaceFilesDir(slug: string): string {
  const dir = join(getAgentWorkspacePath(slug), 'workspace-files')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  return dir
}

export function getInactiveSkillsDir(slug: string): string {
  const workspaceDir = getAgentWorkspacePath(slug)
  const dir = join(workspaceDir, '.agents', 'skills-inactive')
  const legacyDir = join(workspaceDir, 'skills-inactive')

  if (existsSync(legacyDir) && !existsSync(dir)) {
    try {
      mkdirSync(join(workspaceDir, '.agents'), { recursive: true })
      renameSync(legacyDir, dir)
      log.info(`[配置] 已迁移工作区停用 Skills 目录: ${legacyDir} -> ${dir}`)
    } catch (error) {
      log.warn('[配置] 迁移旧停用 Skills 目录失败，将继续使用新目录:', error)
    }
  }

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  return dir
}

export function getGlobalAgentSkillsDir(): string {
  const globalDir = getGlobalAgentConfigDir()
  const dir = join(globalDir, '.agents', 'skills')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  return dir
}

export function getGlobalAgentInactiveSkillsDir(): string {
  const globalDir = getGlobalAgentConfigDir()
  const dir = join(globalDir, '.agents', 'skills-inactive')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  return dir
}

export function getAlmaSkillsDir(): string {
  return join(homedir(), '.config', 'alma', 'skills')
}

function resolveExternalRootDir(envName: 'CODEX_HOME' | 'CLAUDE_HOME', fallbackDirName: string): string {
  const overriddenDir = process.env[envName]?.trim()
  if (!overriddenDir) {
    return join(homedir(), fallbackDirName)
  }

  return isAbsolute(overriddenDir) ? overriddenDir : resolve(overriddenDir)
}

export function getCodexRootDir(): string {
  return resolveExternalRootDir('CODEX_HOME', '.codex')
}

export function getCodexSkillsDir(): string {
  return join(getCodexRootDir(), 'skills')
}

export function getCodexPluginsDir(): string {
  return join(getCodexRootDir(), 'plugins')
}

export function getClaudeRootDir(): string {
  return resolveExternalRootDir('CLAUDE_HOME', '.claude')
}

export function getClaudeSkillsDir(): string {
  return join(getClaudeRootDir(), 'skills')
}

export function getClaudeHackSkillsDir(): string {
  return join(getClaudeRootDir(), 'hack-skills-library')
}

export function getClaudePluginsDir(): string {
  return join(getClaudeRootDir(), 'plugins')
}

export function getGlobalSkillLibraryBrowseRoots(): string[] {
  return [
    getGlobalAgentConfigDir(),
    getCodexSkillsDir(),
    getCodexPluginsDir(),
    getClaudeSkillsDir(),
    getClaudeHackSkillsDir(),
    getClaudePluginsDir(),
  ]
}

export function getBuiltinSkillSourceDirs(): string[] {
  const { app } = require('electron')
  const builtinDir = app.isPackaged
    ? join(process.resourcesPath, 'builtin-skills')
    : join(__dirname, '../../builtin-skills')
  const almaDir = getAlmaSkillsDir()

  return [builtinDir, almaDir].filter((dir) => existsSync(dir))
}
