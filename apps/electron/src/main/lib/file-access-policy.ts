/**
 * File access policy
 *
 * 统一收口文件系统访问白名单：
 * - 旧 agent workspace 根目录
 * - unified session 的 project.path
 * - session 级隐藏配置目录 / 附加目录
 *
 * 全局 Agent 配置目录单独走 assertGlobalAgentPathAccess，不混入这里。
 */

import { isAbsolute, relative, resolve } from 'node:path'
import type { SessionMeta } from '@kila/shared'

interface BuildFileAccessRootsInput {
  legacyWorkspaceRoot?: string
  sessions?: Array<Pick<SessionMeta, 'id' | 'project' | 'attachedDirectories'>>
  extraRoots?: string[]
  resolveSessionExtraRoots?: (
    session: Pick<SessionMeta, 'id' | 'project' | 'attachedDirectories'>,
  ) => Array<string | null | undefined>
}

function normalizeRoots(roots: Array<string | null | undefined>): string[] {
  const uniqueRoots = new Set<string>()

  for (const root of roots) {
    if (!root || !root.trim()) continue
    uniqueRoots.add(resolve(root))
  }

  return Array.from(uniqueRoots)
}

export function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const safeTargetPath = resolve(targetPath)
  const safeRootPath = resolve(rootPath)
  const relPath = relative(safeRootPath, safeTargetPath)

  return relPath === '' || (!relPath.startsWith('..') && !isAbsolute(relPath))
}

export function buildFileAccessRoots(input: BuildFileAccessRootsInput): string[] {
  const sessionRoots = (input.sessions ?? []).flatMap((session) => [
    session.project.path,
    ...(input.resolveSessionExtraRoots?.(session) ?? []),
    ...(session.attachedDirectories ?? []),
  ])

  return normalizeRoots([
    input.legacyWorkspaceRoot,
    ...(input.extraRoots ?? []),
    ...sessionRoots,
  ])
}

export function isPathWithinAllowedRoots(targetPath: string, roots: string[]): boolean {
  const safeTargetPath = resolve(targetPath)
  return roots.some((root) => isPathInsideRoot(safeTargetPath, root))
}

export function assertPathWithinAllowedRoots(
  targetPath: string,
  roots: string[],
  errorMessage = '访问路径超出 Agent 工作区范围',
): string {
  const safeTargetPath = resolve(targetPath)

  if (!isPathWithinAllowedRoots(safeTargetPath, roots)) {
    throw new Error(errorMessage)
  }

  return safeTargetPath
}
