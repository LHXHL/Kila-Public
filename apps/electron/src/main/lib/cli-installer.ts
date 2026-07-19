import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { app } from 'electron'
import { getRuntimeStatus } from './runtime-init'
import {
  buildCliWrapperScript,
  getCliInstallDir,
  getCliInstallPath,
} from './cli-installer-shared'

import { createLogger } from './logger'
const log = createLogger('CLI Installer')

export function getBundledCliEntrypointPath(): string | null {
  const cliPath = app.isPackaged
    ? join(process.resourcesPath, 'cli', 'main.js')
    : join(app.getAppPath(), '..', 'cli', 'dist', 'main.js')

  return existsSync(cliPath) ? cliPath : null
}

/**
 * 从系统 PATH 查找可执行文件
 * - Windows: 使用 where.exe
 * - macOS/Linux: 使用 which
 */
function findInPath(name: string): string | null {
  try {
    const cmd = process.platform === 'win32'
      ? `where.exe ${name}`
      : `which ${name} 2>/dev/null`
    const result = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 3000,
      windowsHide: true,
    })
    const path = result.trim().split('\n')[0]?.trim() ?? ''
    return path && existsSync(path) ? path : null
  } catch {
    return null
  }
}

/**
 * 按优先级查找可用的 JS 运行时：
 * 1. 已检测到的运行时（bundled / system bun）
 * 2. 系统 PATH 中的 bun
 * 3. 系统 PATH 中的 node
 */
function findAvailableRuntime(): string | null {
  // 优先使用已检测到的运行时
  const runtime = getRuntimeStatus()
  if (runtime?.bun.available && runtime.bun.path && existsSync(runtime.bun.path)) {
    return runtime.bun.path
  }

  // 回退到系统 bun
  const systemBun = findInPath('bun')
  if (systemBun) {
    log.info(`[CLI Installer] 使用系统 bun: ${systemBun}`)
    return systemBun
  }

  // 回退到系统 node
  const systemNode = findInPath('node')
  if (systemNode) {
    log.info(`[CLI Installer] 使用系统 node: ${systemNode}`)
    return systemNode
  }

  return null
}

/**
 * 确保 Windows 用户 PATH 包含指定目录
 * 通过读写注册表实现，不需要管理员权限
 */
function ensureWindowsPathContains(dir: string): void {
  try {
    // 读取当前用户 PATH
    const currentPath = execSync(
      'reg query "HKCU\\Environment" /v Path',
      { encoding: 'utf-8', timeout: 5000, windowsHide: true },
    ).trim()

    // 提取 Path 值（格式: "    Path    REG_SZ    C:\xxx;C:\yyy"）
    const match = currentPath.match(/Path\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)/i)
    const pathValue = match?.[1]?.trim() ?? ''

    // 检查是否已包含该目录（大小写不敏感）
    const paths = pathValue.split(';').map(p => p.trim().toLowerCase())
    if (paths.includes(dir.toLowerCase())) {
      log.info(`[CLI Installer] Windows PATH 已包含: ${dir}`)
      return
    }

    // 追加到用户 PATH
    const newPath = pathValue ? `${pathValue};${dir}` : dir
    execSync(
      `reg add "HKCU\\Environment" /v Path /t REG_EXPAND_SZ /d "${newPath}" /f`,
      { encoding: 'utf-8', timeout: 5000, windowsHide: true },
    )
    log.info(`[CLI Installer] 已将 ${dir} 添加到 Windows 用户 PATH`)

    // 通知系统 PATH 已变更（广播 WM_SETTINGCHANGE）
    try {
      execSync(
        `powershell -Command "[System.Environment]::SetEnvironmentVariable('Path', [System.Environment]::GetEnvironmentVariable('Path', 'User'), 'User')"`,
        { encoding: 'utf-8', timeout: 5000, windowsHide: true },
      )
    } catch {
      // 广播失败不影响功能，新终端窗口即可生效
    }
  } catch (err) {
    log.warn(`[CLI Installer] 更新 Windows PATH 失败: ${err}`)
  }
}

export async function ensureBundledCliInstalled(): Promise<void> {
  const runtimePath = findAvailableRuntime()
  const cliEntrypointPath = getBundledCliEntrypointPath()

  if (!runtimePath) {
    log.warn('[CLI Installer] 跳过安装：未找到任何可用的 JS 运行时（bun / node）')
    return
  }

  if (!cliEntrypointPath) {
    log.warn('[CLI Installer] 跳过安装：未找到 CLI 入口产物')
    return
  }

  const installDir = getCliInstallDir()
  const installPath = getCliInstallPath()
  const wrapper = buildCliWrapperScript(runtimePath, cliEntrypointPath)

  mkdirSync(installDir, { recursive: true })

  const current = existsSync(installPath)
    ? readFileSync(installPath, 'utf-8')
    : null

  if (current !== wrapper) {
    writeFileSync(installPath, wrapper, 'utf-8')
  }

  // macOS/Linux 需要设置可执行权限
  if (process.platform !== 'win32') {
    chmodSync(installPath, 0o755)
  }

  // Windows 需要确保安装目录在用户 PATH 中
  if (process.platform === 'win32') {
    ensureWindowsPathContains(installDir)
  }

  log.info(`[CLI Installer] 已确保 kila CLI wrapper 存在: ${installPath} (runtime: ${runtimePath})`)
}
