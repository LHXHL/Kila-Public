/**
 * Shell 统一解析入口（Electron 感知层）
 *
 * 从真实运行环境采集输入，调用 shell-resolution 纯逻辑并缓存结果。
 * 执行层（process-registry）、状态检测（git-bash-detector）与
 * system prompt 注入（agent-prompt-builder）都从这里取同一份解析结果，
 * 保证 UI 显示的状态 = 实际执行使用的 shell = 模型被告知的能力。
 */

import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveShellFrom, type ResolvedShell } from './shell-resolution'

import { createLogger } from './logger'
const log = createLogger('Shell 解析')

let cachedShell: ResolvedShell | undefined

/**
 * 解析当前环境实际可用的 shell（首次调用后缓存）
 *
 * 缓存安全性：Windows 打包模式只看 resources 内置路径（与 PATH 无关）；
 * 开发模式 PATH 来自终端启动，不会中途变化；macOS/Linux 走 /bin/bash 短路。
 */
export function resolveShell(): ResolvedShell {
  if (cachedShell) return cachedShell

  const isWindows = process.platform === 'win32'
  const resolved = resolveShellFrom({
    platform: process.platform,
    isPackaged: app.isPackaged,
    bundledBashPath: isWindows
      ? join(process.resourcesPath, 'vendor', 'bash', 'bash.exe')
      : null,
    devVendorBashPath: isWindows
      ? join(app.getAppPath(), 'vendor', 'bash', 'win32-x64', 'bash.exe')
      : null,
    pathEnv: process.env.PATH ?? '',
    systemRoot: process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows',
    fileExists: existsSync,
  })

  if (resolved.kind === 'none') {
    log.warn(`[Shell 解析] 无可用 shell: ${resolved.error}`)
  } else {
    log.info(`[Shell 解析] 使用 ${resolved.kind}: ${resolved.path}`)
  }

  cachedShell = resolved
  return resolved
}
