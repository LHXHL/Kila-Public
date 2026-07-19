import { homedir } from 'node:os'
import { join } from 'node:path'

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * 获取 CLI 安装目录
 * - Windows: %LOCALAPPDATA%\Kila\bin
 * - macOS/Linux: ~/.local/bin
 */
export function getCliInstallDir(homePath = homedir()): string {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || join(homePath, 'AppData', 'Local')
    return join(localAppData, 'Kila', 'bin')
  }
  return join(homePath, '.local', 'bin')
}

/**
 * 获取 CLI wrapper 安装路径
 * - Windows: %LOCALAPPDATA%\Kila\bin\kila.cmd
 * - macOS/Linux: ~/.local/bin/kila
 */
export function getCliInstallPath(homePath = homedir()): string {
  const name = process.platform === 'win32' ? 'kila.cmd' : 'kila'
  return join(getCliInstallDir(homePath), name)
}

/**
 * 构建 CLI wrapper 脚本内容
 * - Windows: .cmd 批处理脚本
 * - macOS/Linux: POSIX shell 脚本
 */
export function buildCliWrapperScript(
  runtimePath: string,
  cliEntrypointPath: string,
): string {
  if (process.platform === 'win32') {
    // Windows .cmd 脚本：用 @echo off 隐藏回显，%~f0 获取脚本自身路径
    return [
      '@echo off',
      `"${runtimePath}" "${cliEntrypointPath}" %*`,
      '',
    ].join('\r\n')
  }

  return [
    '#!/bin/sh',
    `exec ${quoteShellArg(runtimePath)} ${quoteShellArg(cliEntrypointPath)} "$@"`,
    '',
  ].join('\n')
}
