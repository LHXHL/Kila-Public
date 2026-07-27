/**
 * Cua Driver 服务
 *
 * 管理 cua-driver 的检测、安装、注册和生命周期。
 * cua-driver 是一个 Rust 编写的 MCP 服务器，提供桌面操控能力（截图、鼠标、键盘等）。
 * 通过标准 MCP stdio 协议与 Agent runtime 通信。
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import process from 'node:process'
import type {
  CuaDriverStatus,
  CuaDriverDetectResult,
  CuaDriverInstallResult,
  McpServerEntry,
  WorkspaceMcpConfig,
} from '@kila/shared'
import { getGlobalAgentMcpConfig, saveGlobalAgentMcpConfig } from './global-agent-config-manager'
import { mcpServerManager } from './mcp-server-manager'
import { createLogger } from './logger'

const log = createLogger('CuaDriver')
const execFileAsync = promisify(execFile)

/** MCP 配置中 cua-driver 的固定 key */
const CUA_DRIVER_MCP_KEY = 'cua-driver'

/**
 * 安装脚本供应链锁定
 *
 * cua-driver 的官方安装脚本来自第三方仓库 trycua/cua。
 * 直接 `curl | bash` / `irm | iex` 拉取 main 分支等于把第三方仓库的
 * 任意一次 push 变成本机代码执行（Windows 上还会提升到管理员）。
 *
 * 因此这里做双重锁定（与 scripts/download-bash.ts 的 busybox 锁定同一范式）：
 * 1. URL 锚定到具体 commit SHA，而不是 main 分支；
 * 2. 下载后计算 SHA256 并与固定期望值比对，不匹配立即中止且绝不执行。
 *
 * 升级步骤（必须同时更新 SHA 与两个哈希）：
 *   curl -s https://api.github.com/repos/trycua/cua/commits/main   # 取 commit SHA
 *   curl -fsSL <锚定 URL> | shasum -a 256                          # 取脚本哈希
 */
const INSTALL_SCRIPT_COMMIT = 'df368a7698a07ec9ba7e10952d483457c22841ff'

const INSTALL_SCRIPT_BASE_URL =
  `https://raw.githubusercontent.com/trycua/cua/${INSTALL_SCRIPT_COMMIT}/libs/cua-driver/scripts`

/** 脚本来源描述：URL + 期望 SHA256（空字符串表示未配置，拒绝安装） */
export interface InstallScriptSource {
  platform: 'macos' | 'windows'
  url: string
  /** 期望 SHA256（十六进制小写）；为空时拒绝安装 */
  expectedSha256: string
}

/** 2026-07-26 核对：与 commit df368a7 的脚本内容一致 */
export const INSTALL_SCRIPT_MACOS: InstallScriptSource = {
  platform: 'macos',
  url: `${INSTALL_SCRIPT_BASE_URL}/install.sh`,
  expectedSha256: '52293f8683c6c41ef8df0bb17907f3bd9266314e04f7b0c8f3c4576e7ba139f7',
}

export const INSTALL_SCRIPT_WINDOWS: InstallScriptSource = {
  platform: 'windows',
  url: `${INSTALL_SCRIPT_BASE_URL}/install.ps1`,
  expectedSha256: '85227ad5400240ccdcd8be18024ad871d1382d9e0b7f66dcce778e0ae4427f73',
}

/** 下载安装脚本的超时（毫秒） */
const SCRIPT_DOWNLOAD_TIMEOUT_MS = 30_000

/** 执行安装脚本的超时（毫秒） */
const SCRIPT_EXEC_TIMEOUT_MS = 120_000

/**
 * 构造子进程的最小必要环境变量
 *
 * 不再整体透传 `process.env`：Electron 主进程环境里含有代理凭证、
 * API Key 等敏感变量，没有必要交给第三方安装脚本或 MCP 子进程。
 */
function minimalChildEnv(extra: Record<string, string> = {}): Record<string, string> {
  const passthroughKeys = [
    // 通用
    'PATH', 'Path', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP', 'SHELL',
    // Windows
    'SystemRoot', 'SystemDrive', 'windir', 'ComSpec', 'PATHEXT',
    'USERPROFILE', 'USERNAME', 'HOMEDRIVE', 'HOMEPATH',
    'LOCALAPPDATA', 'APPDATA', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData',
  ]

  const env: Record<string, string> = {}
  for (const key of passthroughKeys) {
    const value = process.env[key]
    if (typeof value === 'string') env[key] = value
  }

  return { ...env, ...extra }
}

/**
 * 下载安装脚本并做 SHA256 校验
 *
 * 校验不通过（或未配置期望哈希）时抛出明确中文错误，绝不返回可执行内容。
 */
export async function fetchVerifiedInstallScript(source: InstallScriptSource): Promise<string> {
  if (!source.expectedSha256) {
    log.error(`[CuaDriver] 未配置 ${source.platform} 安装脚本的期望 SHA256，拒绝安装`)
    throw new Error(
      '未配置安装脚本的期望 SHA256 校验值，出于供应链安全考虑拒绝安装。'
      + '请升级 Kila 或在 cua-driver-service.ts 中补齐锁定哈希。',
    )
  }

  // 只记录来源与版本，不记录脚本内容
  log.info(`[CuaDriver] 准备下载安装脚本 platform=${source.platform} commit=${INSTALL_SCRIPT_COMMIT} url=${source.url}`)

  const response = await fetch(source.url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(SCRIPT_DOWNLOAD_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`下载安装脚本失败: HTTP ${response.status} ${response.statusText}`)
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  const actualSha256 = createHash('sha256').update(bytes).digest('hex')

  if (actualSha256 !== source.expectedSha256) {
    log.error(
      `[CuaDriver] 安装脚本 SHA256 校验失败 platform=${source.platform} `
      + `期望=${source.expectedSha256} 实际=${actualSha256}`,
    )
    throw new Error(
      '安装脚本校验失败，已中止安装。\n'
      + `  期望 SHA256: ${source.expectedSha256}\n`
      + `  实际 SHA256: ${actualSha256}\n`
      + '脚本内容与锁定版本不一致，可能是上游变更或供应链投毒。'
      + '请勿手动绕过，等待 Kila 更新锁定哈希后再安装。',
    )
  }

  log.info(`[CuaDriver] 安装脚本 SHA256 校验通过 platform=${source.platform}`)
  return bytes.toString('utf-8')
}

/**
 * 将脚本落盘到独占临时目录，交给回调执行，结束后无条件清理
 *
 * 相比 `bash -c <脚本内容>` / `irm | iex`：
 * - 脚本内容不再经过命令行拼接，消除引号与注入面
 * - 只有通过哈希校验的内容才会落盘
 */
async function withTempScript<T>(
  filename: string,
  content: string,
  run: (scriptPath: string) => Promise<T>,
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'kila-cua-install-'))
  const scriptPath = join(dir, filename)

  try {
    writeFileSync(scriptPath, content, { encoding: 'utf-8', mode: 0o700 })
    return await run(scriptPath)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * 获取当前平台标识
 */
function getPlatform(): 'macos' | 'windows' | 'linux' {
  switch (process.platform) {
    case 'darwin':
      return 'macos'
    case 'win32':
      return 'windows'
    default:
      return 'linux'
  }
}

/**
 * 在 PATH 和常见位置搜索 cua-driver 二进制
 */
async function findBinary(): Promise<{ path: string; version: string }> {
  const commands = ['cua-driver']

  // macOS 额外搜索路径
  if (process.platform === 'darwin') {
    commands.push(
      '/usr/local/bin/cua-driver',
      '/opt/homebrew/bin/cua-driver',
      `${process.env.HOME}/.local/bin/cua-driver`,
    )
  }

  // Windows 额外搜索路径（匹配 install.ps1 安装布局）
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? ''
    const userProfile = process.env.USERPROFILE ?? ''
    if (localAppData) {
      // 官方安装脚本默认 PATH 入口
      commands.push(`${localAppData}\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe`)
    }
    if (userProfile) {
      // 安装包实际目录（junction 指向这里）
      commands.push(`${userProfile}\\.cua-driver\\packages\\current\\cua-driver.exe`)
      // Rust/cargo 全局安装路径
      commands.push(`${userProfile}\\.cargo\\bin\\cua-driver.exe`)
    }
  }

  for (const cmd of commands) {
    try {
      // 先检查文件是否存在（绝对路径场景）
      if (isAbsolutePath(cmd) && !existsSync(cmd)) {
        continue
      }

      const { stdout } = await execFileAsync(cmd, ['--version'], {
        timeout: 5000,
        env: minimalChildEnv(),
        // Windows 隐藏终端闪烁
        windowsHide: true,
      })

      const version = stdout.trim().split('\n')[0]?.replace(/^cua-driver\s+/i, '') || ''

      // 将裸命令解析为绝对路径，避免 Electron 进程 PATH 不一致导致 spawn 失败
      const absolutePath = await resolveToAbsolutePath(cmd)
      log.info(`[CuaDriver] 检测到: ${absolutePath} (${version})`)
      return { path: absolutePath, version }
    } catch {
      // 忽略：命令不存在或执行失败
    }
  }

  return { path: '', version: '' }
}

/**
 * 将裸命令名解析为绝对路径
 *
 * Electron 从 Finder/Dock 启动时 PATH 可能不完整，
 * 裸命令名 spawn 可能失败。提前解析为绝对路径。
 */
async function resolveToAbsolutePath(cmd: string): Promise<string> {
  // 已经是绝对路径（Unix: /...  Windows: C:\...）
  if (isAbsolutePath(cmd)) return cmd

  try {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which'
    const { stdout } = await execFileAsync(whichCmd, [cmd], {
      timeout: 5000,
      env: minimalChildEnv(),
      windowsHide: true,
    })
    const resolved = stdout.trim().split('\n')[0]?.trim()
    // Windows: C:\...  Unix: /...
    if (resolved && (resolved.startsWith('/') || /^[A-Za-z]:/.test(resolved))) {
      return resolved
    }
  } catch {
    // which 失败，返回原命令
  }

  return cmd
}

/**
 * 判断是否为绝对路径（跨平台）
 */
function isAbsolutePath(p: string): boolean {
  // Unix: /开头  Windows: C:\ 开头
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)
}

/**
 * 检测本地 cua-driver 安装状态
 */
export async function detectCuaDriver(): Promise<CuaDriverDetectResult> {
  const { path, version } = await findBinary()
  return {
    found: path !== '',
    binaryPath: path,
    version,
  }
}

/**
 * 获取 cua-driver 的完整状态
 *
 * 包含安装状态、MCP 注册状态、启用状态等。
 */
export async function getCuaDriverStatus(): Promise<CuaDriverStatus> {
  const detection = await detectCuaDriver()

  // 读取当前全局 MCP 配置，检查 cua-driver 是否已注册
  let registered = false
  let enabled = false

  try {
    const config = getGlobalMcpConfig()
    const entry = config.servers?.[CUA_DRIVER_MCP_KEY]
    if (entry) {
      registered = true
      enabled = entry.enabled
    }
  } catch {
    // MCP 配置读取失败，保持默认
  }

  return {
    registered,
    enabled,
    installStatus: detection.found ? 'installed' : 'not-installed',
    binaryPath: detection.binaryPath,
    version: detection.version,
    lastCheckedAt: Date.now(),
    platform: getPlatform(),
  }
}

/**
 * 安装 cua-driver
 *
 * macOS/Linux 使用官方 install.sh，Windows 使用官方 install.ps1。
 * 安装完成后自动注册到全局 MCP 配置。
 */
export async function installCuaDriver(): Promise<CuaDriverInstallResult> {
  const platform = getPlatform()

  if (platform === 'windows') {
    return installCuaDriverWindows()
  }

  log.info('[CuaDriver] 开始安装...')

  try {
    // 下载 + SHA256 校验：校验不通过会抛错，绝不执行
    const scriptContent = await fetchVerifiedInstallScript(INSTALL_SCRIPT_MACOS)

    // 校验通过的脚本落盘后执行，不再把内容拼进 `bash -c`
    await withTempScript('install.sh', scriptContent, (scriptPath) =>
      execFileAsync('bash', [scriptPath], {
        timeout: SCRIPT_EXEC_TIMEOUT_MS,
        env: minimalChildEnv(),
      }),
    )

    // 安装后重新检测
    const detection = await detectCuaDriver()
    if (!detection.found) {
      return {
        success: false,
        message: '安装脚本执行完成，但未检测到 cua-driver 二进制。可能需要重启终端。',
      }
    }

    // 自动注册到 MCP 配置
    await registerCuaDriver()

    log.info(`[CuaDriver] 安装成功: ${detection.binaryPath} (${detection.version})`)
    return {
      success: true,
      message: `安装成功: ${detection.version}`,
      binaryPath: detection.binaryPath,
      version: detection.version,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error('[CuaDriver] 安装失败:', message)
    return {
      success: false,
      message: `安装失败: ${message}`,
    }
  }
}

/**
 * Windows 专用安装：通过 PowerShell 执行官方 install.ps1
 */
async function installCuaDriverWindows(): Promise<CuaDriverInstallResult> {
  log.info('[CuaDriver] Windows 开始安装...')

  try {
    // 下载 + SHA256 校验：替代原先的 `irm <URL> | iex`
    const scriptContent = await fetchVerifiedInstallScript(INSTALL_SCRIPT_WINDOWS)

    // 校验通过的脚本落盘后用 -File 执行，参数以数组传递，无字符串拼接
    await withTempScript('install.ps1', scriptContent, (scriptPath) =>
      execFileAsync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
      ], {
        timeout: SCRIPT_EXEC_TIMEOUT_MS,
        env: minimalChildEnv(),
        windowsHide: true,
      }),
    )

    // 安装后重新检测（安装脚本可能需要一点时间完成 junction 创建）
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const detection = await detectCuaDriver()
    if (!detection.found) {
      return {
        success: false,
        message: '安装脚本执行完成，但未检测到 cua-driver 二进制。可能需要重新打开终端或刷新 PATH。',
      }
    }

    // 自动注册到 MCP 配置
    await registerCuaDriver()

    log.info(`[CuaDriver] Windows 安装成功: ${detection.binaryPath} (${detection.version})`)
    return {
      success: true,
      message: `安装成功: ${detection.version}`,
      binaryPath: detection.binaryPath,
      version: detection.version,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error('[CuaDriver] Windows 安装失败:', message)
    return {
      success: false,
      message: `安装失败: ${message}`,
    }
  }
}

/**
 * 启用/禁用 cua-driver
 *
 * 在全局 MCP 配置中注册或禁用 cua-driver。
 */
export async function toggleCuaDriver(enabled: boolean): Promise<CuaDriverStatus> {
  if (enabled) {
    await registerCuaDriver()
  } else {
    await unregisterCuaDriver()
  }

  return getCuaDriverStatus()
}

/**
 * 测试 cua-driver 连接
 *
 * 启动 cua-driver MCP 服务器，尝试列出工具验证 MCP 协议通信正常。
 */
export async function testCuaDriverConnection(): Promise<{ success: boolean; message: string }> {
  const detection = await detectCuaDriver()
  if (!detection.found) {
    return { success: false, message: '未找到 cua-driver 二进制' }
  }

  try {
    // 使用与实际 MCP 连接相同的方式测试：spawn + MCP initialize + list tools
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')

    const client = new Client({ name: 'Kila-test', version: '0.1.0' })
    const transport = new StdioClientTransport({
      command: detection.binaryPath,
      args: ['mcp'],
      // MCP 子进程同样只给最小必要环境，不透传代理凭证与 API Key
      env: minimalChildEnv({ CUA_DRIVER_MCP_MODE: '1' }),
      stderr: 'inherit',
    })

    // 15 秒超时
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('连接超时')), 15000)
    )

    await Promise.race([client.connect(transport), timeoutPromise])

    const tools = await client.listTools()

    await client.close()

    const toolCount = tools?.tools?.length ?? 0
    return { success: true, message: `MCP 连接正常，${toolCount} 个工具可用 (${detection.version})` }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, message: `MCP 连接测试失败: ${message}` }
  }
}

// ===== MCP 配置操作 =====

/**
 * 读取全局 MCP 配置
 */
function getGlobalMcpConfig(): WorkspaceMcpConfig {
  try {
    return getGlobalAgentMcpConfig()
  } catch {
    return { servers: {} }
  }
}

/**
 * 写入全局 MCP 配置
 */
function saveGlobalMcpConfig(config: WorkspaceMcpConfig): void {
  saveGlobalAgentMcpConfig(config)
}

/**
 * 注册 cua-driver 到全局 MCP 配置
 */
async function registerCuaDriver(): Promise<void> {
  const detection = await detectCuaDriver()
  if (!detection.found) {
    log.warn('[CuaDriver] 注册失败：未检测到 cua-driver')
    return
  }

  const config = getGlobalMcpConfig()

  const entry: McpServerEntry = {
    type: 'stdio',
    command: detection.binaryPath,
    args: ['mcp'],
    enabled: true,
    isBuiltin: true,
    env: {
      // cua-driver MCP stdio 模式标识（与 deepchat 保持一致）
      CUA_DRIVER_MCP_MODE: '1',
    },
  }

  config.servers[CUA_DRIVER_MCP_KEY] = entry
  saveGlobalMcpConfig(config)
  await mcpServerManager.reload(config)
  log.info('[CuaDriver] 已注册到全局 MCP 配置')

  // Windows 自动注册 autostart（daemon 计划任务）
  if (process.platform === 'win32') {
    await ensureWindowsAutostart(detection.binaryPath)
  }
}

/**
 * Windows 自动注册 cua-driver daemon 计划任务
 *
 * cua-driver 在 Windows 上需要后台 daemon（cua-driver serve）才能访问桌面。
 * 如果 install.ps1 的 UAC 被取消，autostart 可能没注册。
 * 这里自动触发 UAC 提升 + autostart enable，无需用户手动操作。
 */
async function ensureWindowsAutostart(binaryPath: string): Promise<void> {
  try {
    // 先检查 autostart 是否已注册
    const { stdout: statusOutput } = await execFileAsync(
      binaryPath,
      ['autostart', 'status'],
      { timeout: 5000, env: minimalChildEnv(), windowsHide: true },
    )
    if (statusOutput.toLowerCase().includes('registered')) {
      log.info('[CuaDriver] Windows autostart 已注册')
      return
    }
  } catch {
    // status 命令失败，继续尝试 enable
  }

  try {
    log.info('[CuaDriver] 正在注册 Windows autostart（可能弹出 UAC）...')
    // 二进制路径经环境变量传入，不拼进命令字符串；参数以 PowerShell 数组传递。
    // 原实现把路径拼进单引号字符串再 -Verb RunAs 提权，路径含引号即可注入管理员命令。
    const psCommand = [
      '$exe = $env:KILA_CUA_DRIVER_BIN;',
      'if (-not (Test-Path -LiteralPath $exe)) { exit 2 };',
      "$p = Start-Process -FilePath $exe -ArgumentList 'autostart','enable' -Verb RunAs -Wait -PassThru;",
      'exit $p.ExitCode',
    ].join(' ')

    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        psCommand,
      ],
      {
        timeout: 30000,
        env: minimalChildEnv({ KILA_CUA_DRIVER_BIN: binaryPath }),
        windowsHide: true,
      },
    )
    log.info(`[CuaDriver] Windows autostart 注册完成 stdout=${stdout.trim()} stderr=${stderr.trim()}`)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    // UAC 被取消是常见情况，降级为警告而非错误
    if (msg.includes('cancelled') || msg.includes('was canceled') || msg.includes('0x800704C7')) {
      log.warn('[CuaDriver] Windows autostart UAC 被取消，请在 PowerShell 手动执行: cua-driver autostart enable')
    } else {
      log.warn(`[CuaDriver] Windows autostart 注册失败: ${msg}`)
    }
  }
}

/**
 * 从全局 MCP 配置中移除/禁用 cua-driver
 */
async function unregisterCuaDriver(): Promise<void> {
  const config = getGlobalMcpConfig()

  if (config.servers[CUA_DRIVER_MCP_KEY]) {
    config.servers[CUA_DRIVER_MCP_KEY].enabled = false
    saveGlobalMcpConfig(config)
    await mcpServerManager.reload(config)
    log.info('[CuaDriver] 已在全局 MCP 配置中禁用')
  }
}

/**
 * 快速判断 cua-driver 是否已启用（同步，仅读 MCP 配置）
 *
 * 用于 prompt builder 中决定是否注入 computer-use 上下文。
 * 不做二进制检测，只看 MCP 配置中 cua-driver 是否 enabled。
 */
export function isCuaDriverEnabled(): boolean {
  try {
    const config = getGlobalMcpConfig()
    const entry = config.servers?.[CUA_DRIVER_MCP_KEY]
    return entry?.enabled === true
  } catch {
    return false
  }
}
