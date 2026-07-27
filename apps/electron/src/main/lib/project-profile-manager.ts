/**
 * Project profile manager
 *
 * 隐藏承接项目级配置。
 * 当前没有活跃的 project-bound 权限模式配置；保留该壳用于未来需要稳定绑定到 session project 的隐藏状态。
 * profileId 由规范化项目路径哈希生成，同一路径稳定复用同一份配置。
 */

import { createHash } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { getProjectProfilePath } from './config-paths'

export interface ProjectProfile {
  id: string
  projectPath: string
  rootPath: string
}

function normalizeProjectPath(projectPath: string): string {
  const resolved = resolve(projectPath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export function getProjectProfileId(projectPath: string): string {
  return createHash('sha1')
    .update(normalizeProjectPath(projectPath))
    .digest('hex')
    .slice(0, 16)
}

export function ensureProjectProfile(projectPath: string): ProjectProfile {
  const id = getProjectProfileId(projectPath)
  const rootPath = getProjectProfilePath(id)
  return {
    id,
    projectPath: resolve(projectPath),
    rootPath,
  }
}

export function deleteProjectProfile(profileId: string): void {
  const profilePath = getProjectProfilePath(profileId)
  if (existsSync(profilePath)) {
    rmSync(profilePath, { recursive: true, force: true })
  }
}
