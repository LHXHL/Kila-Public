/**
 * Bash 环境检测模块（Windows 平台）
 *
 * 状态检测统一委托给 shell-resolver（与执行层 process-registry 共享同一
 * 真相源），保证设置页显示的状态与 Agent 实际使用的 shell 一致：
 * - 打包模式：内置 busybox bash（开箱即用，不依赖系统 Git Bash）
 * - 开发模式：PATH 中的真 bash（排除 System32 的 WSL 启动器）→ 开发版内置 busybox
 * - 都不可用时携带明确的修复指引，不降级
 */

import type { GitBashStatus } from '@kila/shared'
import { resolveShell } from './shell-resolver'

/**
 * 检测 Bash 环境
 *
 * @returns Bash 可用状态（version 字段：busybox = 内置 shell，system = 系统真 bash）
 */
export async function detectGitBash(): Promise<GitBashStatus> {
  // 仅在 Windows 平台执行
  if (process.platform !== 'win32') {
    return {
      available: false,
      path: null,
      version: null,
      error: '非 Windows 平台',
    }
  }

  const shell = resolveShell()
  if (shell.kind === 'none' || !shell.path) {
    return {
      available: false,
      path: null,
      version: null,
      error: shell.error,
    }
  }

  return {
    available: true,
    path: shell.path,
    version: shell.kind === 'busybox' ? 'busybox' : 'system',
    error: null,
  }
}
