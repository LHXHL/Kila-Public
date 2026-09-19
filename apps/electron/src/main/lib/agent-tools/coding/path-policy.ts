import { existsSync, lstatSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { buildFileAccessRoots, assertPathWithinAllowedRoots } from '../../file-access-policy'
import { CodingToolError } from './schemas'

export interface CodingPathPolicy {
  sessionId: string
  cwd: string
  roots: string[]
  resolveReadPath: (requestedPath: string) => string
  resolveWritePath: (requestedPath: string) => string
}

export function createCodingPathPolicy(options: {
  sessionId: string
  cwd: string
  allowedRoots?: string[]
}): CodingPathPolicy {
  const roots = buildFileAccessRoots({
    extraRoots: [options.cwd, ...(options.allowedRoots ?? [])],
  })

  const resolveRequestedPath = (requestedPath: string): string => {
    if (typeof requestedPath !== 'string' || requestedPath.trim() === '' || requestedPath.includes('\0')) {
      throw new CodingToolError('coding_invalid_path', '文件路径无效')
    }
    return isAbsolute(requestedPath) ? resolve(requestedPath) : resolve(options.cwd, requestedPath)
  }

  const assertAllowed = (requestedPath: string): string => {
    const absolutePath = resolveRequestedPath(requestedPath)
    try {
      return assertPathWithinAllowedRoots(absolutePath, roots, '访问路径超出当前会话允许的工作区范围')
    } catch (error) {
      throw new CodingToolError(
        'coding_path_not_allowed',
        error instanceof Error ? error.message : '访问路径超出当前会话允许的工作区范围',
      )
    }
  }

  return {
    sessionId: options.sessionId,
    cwd: options.cwd,
    roots,
    resolveReadPath: (requestedPath) => {
      const absolutePath = assertAllowed(requestedPath)
      if (!existsSync(absolutePath)) {
        throw new CodingToolError('coding_file_not_found', `文件不存在: ${requestedPath}`)
      }
      return absolutePath
    },
    resolveWritePath: (requestedPath) => {
      const absolutePath = assertAllowed(requestedPath)
      // 不允许把现有符号链接当作目标直接覆盖；即使它最终落在允许根内，
      // 原子 rename 也会改变链接本身的语义，容易让模型误判实际写入目标。
      try {
        if (lstatSync(absolutePath).isSymbolicLink()) {
          throw new CodingToolError('coding_symlink_target', `不允许直接写入符号链接: ${requestedPath}`)
        }
      } catch (error) {
        if (error instanceof CodingToolError) throw error
        // 目标不存在时，assertAllowed 已经通过最近存在的祖先目录完成校验。
      }

      const parent = dirname(absolutePath)
      try {
        assertPathWithinAllowedRoots(parent, roots, '写入目录超出当前会话允许的工作区范围')
        return absolutePath
      } catch (error) {
        throw new CodingToolError(
          'coding_path_not_allowed',
          error instanceof Error ? error.message : '写入目录超出当前会话允许的工作区范围',
        )
      }
    },
  }
}
