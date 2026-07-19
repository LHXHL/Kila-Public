/**
 * Shell 环境变量加载模块
 *
 * macOS：通过 Finder/Dock 启动的 GUI 应用只继承最小的 launchd 环境，
 *   PATH 仅包含 /usr/bin:/bin:/usr/sbin:/sbin。通过 login shell 提取完整环境。
 *
 * Windows：桌面快捷方式启动时只继承有限的系统 PATH，用户安装的工具
 *   （scoop、choco、bun 等）路径缺失。通过注册表精确读取系统级 + 用户级 PATH。
 */

import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { app } from 'electron'
import type { ShellEnvResult } from '@kila/shared'

import { createLogger } from './logger'
const log = createLogger('Shell 环境')

export function getUserShell(): string {
  return process.env.SHELL || '/bin/zsh'
}

/**
 * 需要从导入环境中排除的变量
 */
const EXCLUDED_ENV_VARS = new Set([
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ASAR',
  'VITE_DEV_SERVER_URL',
  'SHLVL',
  'PWD',
  'OLDPWD',
  '_',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'TERM_SESSION_ID',
])

/**
 * 从 Shell 输出解析环境变量
 */
function parseEnvOutput(output: string): Record<string, string> {
  const env: Record<string, string> = {}
  const lines = output.split('\n')

  for (const line of lines) {
    if (!line.trim()) continue
    const eqIndex = line.indexOf('=')
    if (eqIndex <= 0) continue
    const key = line.substring(0, eqIndex)
    const value = line.substring(eqIndex + 1)
    if (EXCLUDED_ENV_VARS.has(key)) continue
    if (key.startsWith('VITE_')) continue
    if (key.startsWith('npm_')) continue
    if (key.startsWith('BUN_')) continue
    env[key] = value
  }

  return env
}

/**
 * 从用户 Shell 获取完整环境变量
 */
export async function getShellEnv(shell: string): Promise<Record<string, string>> {
  const marker = '__KILA_ENV_START__'
  const command = `echo ${marker} && env`

  const output = execSync(`${shell} -l -i -c '${command}'`, {
    encoding: 'utf-8',
    timeout: 10000,
    windowsHide: true,
    env: {
      HOME: process.env.HOME,
      USER: process.env.USER,
      SHELL: shell,
      TERM: 'xterm-256color',
      APPLE_SUPPRESS_DEVELOPER_TOOL_POPUP: '1',
      GIT_TERMINAL_PROMPT: '0',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const markerIndex = output.indexOf(marker)
  if (markerIndex === -1) {
    throw new Error('无法找到环境变量输出标记')
  }

  const envSection = output.substring(markerIndex + marker.length)
  return parseEnvOutput(envSection)
}

/**
 * 将环境变量合并到 process.env
 */
function mergeEnvToProcess(env: Record<string, string>): number {
  let count = 0

  for (const [key, value] of Object.entries(env)) {
    if (!process.env[key]) {
      process.env[key] = value
      count++
    }
  }

  if (env.PATH) {
    const currentPath = process.env.PATH || ''
    const newPaths = env.PATH.split(':')
    const currentPaths = currentPath.split(':')
    const mergedPaths = [...new Set([...newPaths, ...currentPaths])]
    process.env.PATH = mergedPaths.join(':')
  }

  return count
}

// ============================================
// macOS fallback 路径
// ============================================

const MACOS_FALLBACK_PATHS = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/local/sbin',
  `${process.env.HOME}/.local/bin`,
  `${process.env.HOME}/.bun/bin`,
  `${process.env.HOME}/.cargo/bin`,
]

function applyMacOSFallbackPaths(): void {
  const currentPath = process.env.PATH || '/usr/bin:/bin'
  const currentPaths = currentPath.split(':')
  const mergedPaths = [...new Set([...MACOS_FALLBACK_PATHS, ...currentPaths])]
  process.env.PATH = mergedPaths.join(':')
}

// ============================================
// Windows 注册表 PATH 加载
// ============================================

/**
 * 从 Windows 注册表精确读取指定值
 */
function readRegistryValue(key: string, valueName: string): string | null {
  try {
    const output = execSync(
      `reg query "${key}" /v "${valueName}"`,
      { encoding: 'utf-8', timeout: 5000, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    const escaped = valueName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = output.match(new RegExp(`${escaped}\\s+REG_\\w+\\s+(.+)`, 'i'))
    return match?.[1]?.trim() || null
  } catch {
    return null
  }
}

/**
 * 展开 Windows %VAR% 引用
 */
function expandEnvVars(value: string): string {
  return value.replace(/%([^%]+)%/g, (_, varName: string) => {
    return process.env[varName] || `%${varName}%`
  })
}

/**
 * 路径大小写不敏感去重比较
 */
function normalizePathForCompare(p: string): string {
  return p.replace(/[/\\]+$/, '').toLowerCase()
}

/**
 * 将注册表 PATH 合并到 process.env.PATH
 * 注册表路径放在前面（优先级更高），仅添加实际存在的目录
 */
function mergeRegistryPath(registryPath: string): number {
  const currentPath = process.env.PATH || ''
  const currentEntries = currentPath.split(';').filter(Boolean)
  const currentSet = new Set(currentEntries.map(normalizePathForCompare))

  const registryEntries = registryPath
    .split(';')
    .filter(Boolean)
    .map(expandEnvVars)
    .filter((p) => existsSync(p))

  let addedCount = 0
  const newEntries: string[] = []

  for (const entry of registryEntries) {
    const normalized = normalizePathForCompare(entry)
    if (!currentSet.has(normalized)) {
      currentSet.add(normalized)
      newEntries.push(entry)
      addedCount++
    }
  }

  if (addedCount > 0) {
    process.env.PATH = [...newEntries, ...currentEntries].join(';')
  }

  return addedCount
}

/**
 * Windows 注册表工具安装路径探测
 *
 * Git/Node/Bun 官方安装器会在注册表写入安装路径信息，
 * 比 PATH fallback 更精准可靠。
 */
export function getGitForWindowsInstallPath(): string | null {
  let path = readRegistryValue('HKLM\\SOFTWARE\\GitForWindows', 'InstallPath')
  if (path) return path
  path = readRegistryValue('HKCU\\SOFTWARE\\GitForWindows', 'InstallPath')
  return path
}

export function getNodeInstallPathFromRegistry(): string | null {
  if (process.platform !== 'win32') return null
  let path = readRegistryValue('HKLM\\SOFTWARE\\Node.js', 'InstallPath')
  if (path) return path
  path = readRegistryValue('HKCU\\SOFTWARE\\Node.js', 'InstallPath')
  return path
}

/**
 * Windows fallback 路径：覆盖 scoop、fnm、nvm-windows、Bun 等主流安装方式
 */
const WINDOWS_FALLBACK_PATHS = [
  `${process.env.USERPROFILE}\\.bun\\bin`,
  `${process.env.USERPROFILE}\\AppData\\Local\\bun`,
  `${process.env.USERPROFILE}\\scoop\\shims`,
  'C:\\Program Files\\Git\\cmd',
  'C:\\Program Files (x86)\\Git\\cmd',
  `${process.env.USERPROFILE}\\AppData\\Local\\Programs\\Git\\cmd`,
  'C:\\Program Files\\nodejs',
  `${process.env.USERPROFILE}\\AppData\\Roaming\\nvm`,
  `${process.env.USERPROFILE}\\AppData\\Local\\fnm`,
  `${process.env.USERPROFILE}\\.cargo\\bin`,
]

function applyWindowsFallbackPaths(): void {
  const currentPath = process.env.PATH || ''
  const currentEntries = currentPath.split(';').filter(Boolean)
  const currentSet = new Set(currentEntries.map(normalizePathForCompare))

  const validFallbacks = WINDOWS_FALLBACK_PATHS.filter((p) => {
    return existsSync(p) && !currentSet.has(normalizePathForCompare(p))
  })

  if (validFallbacks.length > 0) {
    process.env.PATH = [...validFallbacks, ...currentEntries].join(';')
  }
}

/**
 * 从注册表探测 Git/Node 安装路径并注入 PATH
 */
function injectRegistryInstallPaths(): void {
  const gitPath = getGitForWindowsInstallPath()
  if (gitPath) {
    const gitBin = `${gitPath}\\bin`
    const gitCmd = `${gitPath}\\cmd`
    const currentSet = new Set((process.env.PATH || '').split(';').map(normalizePathForCompare))
    const additions: string[] = []
    if (!currentSet.has(normalizePathForCompare(gitBin)) && existsSync(gitBin)) additions.push(gitBin)
    if (!currentSet.has(normalizePathForCompare(gitCmd)) && existsSync(gitCmd)) additions.push(gitCmd)
    if (additions.length > 0) {
      process.env.PATH = [...additions, ...(process.env.PATH || '').split(';')].join(';')
    }
  }

  const nodePath = getNodeInstallPathFromRegistry()
  if (nodePath) {
    const currentSet = new Set((process.env.PATH || '').split(';').map(normalizePathForCompare))
    if (!currentSet.has(normalizePathForCompare(nodePath)) && existsSync(nodePath)) {
      process.env.PATH = [nodePath, ...(process.env.PATH || '').split(';')].join(';')
    }
  }
}

// ============================================
// 统一入口
// ============================================

/**
 * 加载 Shell 环境到 process.env
 *
 * - macOS: 通过 login shell 提取完整环境
 * - Windows: 从注册表精确读取系统级 + 用户级 PATH，并探测注册表中的安装路径
 * - 开发模式下跳过（从终端启动已有完整环境）
 */
export async function loadShellEnv(): Promise<ShellEnvResult> {
  if (!app.isPackaged) {
    return { success: true, loadedCount: 0, error: null }
  }

  // Windows: 注册表 PATH 加载 + 安装路径探测
  if (process.platform === 'win32') {
    try {
      log.info('[Shell 环境] 正在从注册表加载 Windows PATH（HKLM + HKCU）...')
      let totalAdded = 0

      // 1. 系统级 PATH
      const systemPath = readRegistryValue(
        'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
        'Path',
      )
      if (systemPath) {
        const added = mergeRegistryPath(systemPath)
        totalAdded += added
        log.info(`[Shell 环境] 系统 PATH: 新增 ${added} 个路径`)
      }

      // 2. 用户级 PATH
      const userPath = readRegistryValue('HKCU\\Environment', 'Path')
      if (userPath) {
        const added = mergeRegistryPath(userPath)
        totalAdded += added
        log.info(`[Shell 环境] 用户 PATH: 新增 ${added} 个路径`)
      }

      // 3. 从注册表探测 Git/Node 安装路径
      injectRegistryInstallPaths()

      // 4. fallback 路径补充
      if (totalAdded === 0) {
        log.info('[Shell 环境] 注册表未获得新路径，应用 fallback...')
        applyWindowsFallbackPaths()
      }

      log.info(`[Shell 环境] PATH 加载完成，共新增 ${totalAdded} 个路径`)
      return { success: true, loadedCount: totalAdded, error: null }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.warn(`[Shell 环境] PATH 加载失败: ${errorMessage}`)
      applyWindowsFallbackPaths()
      injectRegistryInstallPaths()
      return { success: false, loadedCount: 0, error: errorMessage }
    }
  }

  // macOS: 通过 login shell 提取完整环境
  if (process.platform === 'darwin') {
    const shell = getUserShell()
    try {
      log.info(`[Shell 环境] 正在从 ${shell} 加载环境变量...`)
      const shellEnv = await getShellEnv(shell)
      const loadedCount = mergeEnvToProcess(shellEnv)
      log.info(`[Shell 环境] 成功加载 ${loadedCount} 个环境变量`)
      return { success: true, loadedCount, error: null }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.warn(`[Shell 环境] 加载失败: ${errorMessage}`)
      log.warn('[Shell 环境] 应用 fallback 路径...')
      applyMacOSFallbackPaths()
      return { success: false, loadedCount: 0, error: errorMessage }
    }
  }

  return { success: true, loadedCount: 0, error: null }
}
