/**
 * Session project manager
 *
 * 管理会话绑定项目目录的创建、切换、锁定与清理。
 */

import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import type { SessionMeta, SessionProject } from '@kila/shared'
import { ensureProjectProfile } from './project-profile-manager'
import { getTempSessionProjectPath } from './config-paths'

function resolveProjectName(projectPath: string): string {
  const trimmed = projectPath.replace(/[\\/]+$/, '')
  return basename(trimmed) || basename(resolve(trimmed)) || 'project'
}

function ensureProjectDirectory(projectPath: string): string {
  const resolved = resolve(projectPath)
  if (!existsSync(resolved)) {
    mkdirSync(resolved, { recursive: true })
  }
  return resolved
}

export function createTempSessionProject(sessionId: string): SessionProject {
  const path = getTempSessionProjectPath(sessionId)
  const profile = ensureProjectProfile(path)

  return {
    path,
    name: resolveProjectName(path),
    source: 'temp',
    profileId: profile.id,
  }
}

export function createSessionProjectFromPath(projectPath: string, source: 'temp' | 'user' = 'user'): SessionProject {
  const resolvedPath = ensureProjectDirectory(projectPath)
  const profile = ensureProjectProfile(resolvedPath)

  return {
    path: resolvedPath,
    name: resolveProjectName(resolvedPath),
    source,
    profileId: profile.id,
  }
}

/**
 * 确保已有 Session 的项目目录在 runtime 启动前可用。
 *
 * 系统可能在应用退出期间清理临时目录；这类目录可以安全重建。
 * 用户项目目录则不能静默创建，否则会把“磁盘未挂载/目录被移动”伪装成空项目。
 */
export function ensureSessionProjectReady(project: SessionProject): { restored: boolean } {
  const resolvedPath = resolve(project.path)

  if (existsSync(resolvedPath)) {
    if (!statSync(resolvedPath).isDirectory()) {
      throw new Error(`会话项目路径不是目录: ${resolvedPath}`)
    }
    return { restored: false }
  }

  if (project.source === 'temp') {
    mkdirSync(resolvedPath, { recursive: true })
    return { restored: true }
  }

  throw new Error(`会话项目目录不存在，请重新选择项目目录: ${resolvedPath}`)
}

export function lockSessionProject(project: SessionProject): SessionProject {
  if (project.lockedAt) return project
  return {
    ...project,
    lockedAt: Date.now(),
  }
}

export function isSessionProjectLocked(project: SessionProject | undefined): boolean {
  return Boolean(project?.lockedAt)
}

export function cleanupSessionProject(project: SessionProject | undefined, options?: { force?: boolean }): void {
  if (!project) return
  if (project.source !== 'temp' && !options?.force) return

  if (existsSync(project.path)) {
    rmSync(project.path, { recursive: true, force: true })
  }
}

export function replaceSessionProject(
  session: Pick<SessionMeta, 'project'>,
  nextProjectPath: string,
): {
  nextProject: SessionProject
  previousProject?: SessionProject
} {
  if (isSessionProjectLocked(session.project)) {
    throw new Error('当前会话项目目录已锁定，无法修改')
  }

  const nextProject = createSessionProjectFromPath(nextProjectPath, 'user')
  return {
    nextProject,
    previousProject: session.project,
  }
}
