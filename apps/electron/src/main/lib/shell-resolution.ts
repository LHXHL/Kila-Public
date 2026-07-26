/**
 * Shell 解析纯逻辑（无 Electron 依赖，可单测）
 *
 * Kila Agent 的 bash 工具在不同平台/模式下解析实际使用的 shell：
 * - Windows 打包模式：只信任内置 busybox（ash），缺失即视为安装损坏，不降级
 * - Windows 开发模式：优先 PATH 中的真 bash（Git Bash），并排除 System32 下的
 *   WSL 启动器（那是 Linux 用户态入口，文件系统与工具链语义完全不同）；
 *   找不到时回退到已下载的开发版内置 busybox（vendor/bash/win32-x64/）
 * - macOS/Linux：/bin/bash → PATH bash → sh
 *
 * 设计约束：不降级到 PowerShell / cmd.exe —— 模型生成的是 POSIX 命令，
 * 静默换解释器只会让 Agent 反复重试烧轮次；宁可显式报错引导用户修复。
 */

export type ResolvedShellKind = 'busybox' | 'bash' | 'none'

export interface ResolvedShell {
  /** busybox = 内置 busybox ash；bash = 真 bash（Git Bash / 系统 bash）；none = 无可用 shell */
  kind: ResolvedShellKind
  /** shell 可执行路径；kind === 'none' 时为 null */
  path: string | null
  /** spawn 参数前缀（如 ['-c']） */
  args: string[]
  /** kind === 'none' 时的原因，用于工具报错与 UI 状态展示 */
  error: string | null
}

export interface ShellResolutionInput {
  platform: NodeJS.Platform
  isPackaged: boolean
  /** 打包模式内置 bash 路径（resources/vendor/bash/bash.exe） */
  bundledBashPath: string | null
  /** 开发模式内置 busybox 路径（vendor/bash/win32-x64/bash.exe） */
  devVendorBashPath: string | null
  pathEnv: string
  /** Windows 系统目录（用于排除 System32/Sysnative 下的 WSL bash 启动器） */
  systemRoot: string
  fileExists: (path: string) => boolean
}

/** 去掉两端引号与尾部分隔符，统一比较口径 */
function normalizeWindowsDir(dir: string): string {
  return dir.trim().replace(/^"|"$/g, '').replace(/[\\/]+$/, '')
}

/**
 * 判断目录是否是 System32/Sysnative —— 其中的 bash.exe 是 WSL 启动器，
 * 执行语义是 Linux 发行版用户态，必须从候选中排除
 */
export function isWslLauncherDir(dir: string, systemRoot: string): boolean {
  const normalized = normalizeWindowsDir(dir).toLowerCase().replace(/\//g, '\\')
  const root = normalizeWindowsDir(systemRoot).toLowerCase().replace(/\//g, '\\')
  if (!root) return false
  return (
    normalized === `${root}\\system32` ||
    normalized === `${root}\\sysnative` ||
    normalized.startsWith(`${root}\\system32\\`) ||
    normalized.startsWith(`${root}\\sysnative\\`)
  )
}

/** 在 Windows PATH 中查找真 bash（排除 WSL 启动器目录） */
export function findWindowsBashOnPath(
  input: Pick<ShellResolutionInput, 'pathEnv' | 'systemRoot' | 'fileExists'>,
): string | null {
  for (const rawDir of input.pathEnv.split(';')) {
    const dir = normalizeWindowsDir(rawDir)
    if (!dir) continue
    if (isWslLauncherDir(dir, input.systemRoot)) continue
    const candidate = `${dir}\\bash.exe`
    if (input.fileExists(candidate)) return candidate
  }
  return null
}

function findUnixBashOnPath(
  input: Pick<ShellResolutionInput, 'pathEnv' | 'fileExists'>,
): string | null {
  for (const rawDir of input.pathEnv.split(':')) {
    const dir = rawDir.replace(/\/+$/, '')
    if (!dir) continue
    const candidate = `${dir}/bash`
    if (input.fileExists(candidate)) return candidate
  }
  return null
}

/**
 * 解析当前环境实际可用的 shell
 *
 * 这是执行层（process-registry）、状态检测（git-bash-detector）与
 * system prompt 注入（agent-prompt-builder）共享的唯一真相源。
 */
export function resolveShellFrom(input: ShellResolutionInput): ResolvedShell {
  if (input.platform !== 'win32') {
    if (input.fileExists('/bin/bash')) {
      return { kind: 'bash', path: '/bin/bash', args: ['-c'], error: null }
    }
    const bashOnPath = findUnixBashOnPath(input)
    if (bashOnPath) {
      return { kind: 'bash', path: bashOnPath, args: ['-c'], error: null }
    }
    return { kind: 'bash', path: 'sh', args: ['-c'], error: null }
  }

  // 打包模式：只信任内置 busybox，缺失 = 安装损坏，显式报错不降级
  if (input.isPackaged) {
    if (input.bundledBashPath && input.fileExists(input.bundledBashPath)) {
      return { kind: 'busybox', path: input.bundledBashPath, args: ['-c'], error: null }
    }
    return {
      kind: 'none',
      path: null,
      args: [],
      error: '内置 bash 缺失（安装文件可能已损坏），请重新安装 Kila',
    }
  }

  // 开发模式：PATH 真 bash（排除 WSL 启动器）→ 开发版内置 busybox → 显式报错
  const bashOnPath = findWindowsBashOnPath(input)
  if (bashOnPath) {
    return { kind: 'bash', path: bashOnPath, args: ['-c'], error: null }
  }

  if (input.devVendorBashPath && input.fileExists(input.devVendorBashPath)) {
    return { kind: 'busybox', path: input.devVendorBashPath, args: ['-c'], error: null }
  }

  return {
    kind: 'none',
    path: null,
    args: [],
    error: '未找到可用的 bash：请安装 Git for Windows，或在 apps/electron 下运行 bun run scripts/download-bash.ts 下载内置 bash',
  }
}

/**
 * 根据解析结果生成 system prompt 的 Shell 环境段落
 *
 * - busybox：声明 ash/busybox 限制，引导模型只写 POSIX sh 兼容命令
 * - none：声明 shell 与文件工具不可用，引导模型转告用户修复
 * - bash（真 bash，含 macOS/Linux 与 Git Bash）：返回 null，不注入任何限制
 */
export function buildShellPromptSection(shell: ResolvedShell): string | null {
  if (shell.kind === 'busybox') {
    return `## Shell 环境（Windows）

当前 bash 工具由内置 busybox-w32 提供（POSIX ash + 精简 Unix 工具集，不是完整的 GNU bash）。编写命令时必须遵循：

- 只写 POSIX sh 兼容语法：不要使用 bash 数组、declare、进程替换 \`<(...)\`、here-string \`<<<\`；条件判断用 \`[ ]\`（POSIX test），不要依赖 \`[[ ]]\`
- 不要依赖 \`set -o pipefail\` 等 bash 专属选项
- 工具是 busybox 精简实现：grep 不支持 \`-P\`（改用 \`-E\`）；sed/awk/find 只支持常用选项；没有 perl；git、node、python 等是否可用取决于用户系统，使用前先用 \`command -v xxx\` 探测
- 路径写成正斜杠的 Windows 形式（如 \`C:/Users/name/project\`）；不要假设存在 /usr、/etc 等 Unix 目录布局
- 中文路径、中文文件名可以正常处理（UTF-8）
- 多条命令用 \`&&\` 或 \`;\` 串联；复杂逻辑优先拆成多次简单调用，不要写长脚本`
  }

  if (shell.kind === 'none') {
    return `## Shell 环境（Windows）

当前环境缺少可用的 bash 运行时：${shell.error ?? '未知原因'}。bash 与文件编辑类工具本轮不可用。涉及执行命令或修改文件的请求，请直接告知用户按上述提示修复后重试，不要尝试调用不存在的工具。`
  }

  return null
}
