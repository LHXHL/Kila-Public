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

import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { existsSync, lstatSync, readlinkSync, realpathSync } from 'node:fs'
import type { SessionMeta } from '@kila/shared'

interface BuildFileAccessRootsInput {
  legacyWorkspaceRoot?: string
  sessions?: Array<Pick<SessionMeta, 'id' | 'project' | 'attachedDirectories'>>
  extraRoots?: string[]
  resolveSessionExtraRoots?: (
    session: Pick<SessionMeta, 'id' | 'project' | 'attachedDirectories'>,
  ) => Array<string | null | undefined>
}

/** 符号链接解引用的最大跳数，避免链环导致死循环 */
const MAX_SYMLINK_HOPS = 8

/**
 * 解引用路径上的符号链接后再返回绝对路径
 *
 * 纯词法的 resolve() + relative() 无法识别符号链接：
 * 恶意仓库或 Agent 在项目内植入 `notes.txt -> ~/.ssh/id_rsa`，
 * 词法上仍在根目录内，实际读到的却是根外文件。
 *
 * 处理三种情况：
 * 1. 路径存在 → 直接 realpath；
 * 2. 路径不存在（新建文件/目录的写入场景）→ 回退到最近的存在祖先目录做 realpath，
 *    再拼回剩余片段，既不误杀写入路径，也能识别祖先目录上的符号链接；
 * 3. 断链符号链接（existsSync 为假但 lstat 存在）→ 解析链接目标后继续解引用，
 *    避免「指向根外且暂不存在」的链接绕过校验。
 */
function realResolve(targetPath: string, hop = 0): string {
  const absolute = resolve(targetPath)

  let current = absolute
  const pending: string[] = []

  while (true) {
    if (existsSync(current)) {
      try {
        const realCurrent = realpathSync(current)
        return pending.length > 0 ? resolve(realCurrent, ...pending) : realCurrent
      } catch {
        return absolute
      }
    }

    // 断链符号链接：existsSync 跟随链接因而为假，但链接本身存在
    if (hop < MAX_SYMLINK_HOPS) {
      try {
        if (lstatSync(current).isSymbolicLink()) {
          const linkTarget = resolve(dirname(current), readlinkSync(current))
          const realTarget = realResolve(linkTarget, hop + 1)
          return pending.length > 0 ? resolve(realTarget, ...pending) : realTarget
        }
      } catch {
        // lstat/readlink 失败：按普通不存在路径继续向上回溯
      }
    }

    const parent = dirname(current)
    if (parent === current) return absolute

    pending.unshift(basename(current))
    current = parent
  }
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
  // 两侧同时解引用：根目录自身也可能位于符号链接下（如 macOS 的 /tmp → /private/tmp）
  const safeTargetPath = realResolve(targetPath)
  const safeRootPath = realResolve(rootPath)
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
