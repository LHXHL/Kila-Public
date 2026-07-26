import { describe, expect, test } from 'bun:test'
import {
  buildShellPromptSection,
  findWindowsBashOnPath,
  isWslLauncherDir,
  resolveShellFrom,
  type ShellResolutionInput,
} from './shell-resolution'

const BUNDLED = 'C:\\Kila\\resources\\vendor\\bash\\bash.exe'
const DEV_VENDOR = 'C:\\repo\\apps\\electron\\vendor\\bash\\win32-x64\\bash.exe'
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe'
const WSL_BASH = 'C:\\Windows\\System32\\bash.exe'

function winInput(overrides: Partial<ShellResolutionInput> & { existingFiles?: string[] }): ShellResolutionInput {
  const { existingFiles = [], ...rest } = overrides
  const files = new Set(existingFiles.map((p) => p.toLowerCase()))
  return {
    platform: 'win32',
    isPackaged: false,
    bundledBashPath: BUNDLED,
    devVendorBashPath: DEV_VENDOR,
    pathEnv: '',
    systemRoot: 'C:\\Windows',
    fileExists: (p) => files.has(p.toLowerCase()),
    ...rest,
  }
}

function unixInput(overrides: Partial<ShellResolutionInput> & { existingFiles?: string[] }): ShellResolutionInput {
  const { existingFiles = [], ...rest } = overrides
  const files = new Set(existingFiles)
  return {
    platform: 'darwin',
    isPackaged: false,
    bundledBashPath: null,
    devVendorBashPath: null,
    pathEnv: '',
    systemRoot: '',
    fileExists: (p) => files.has(p),
    ...rest,
  }
}

describe('Windows 打包模式', () => {
  test('内置 busybox 存在时使用内置 bash', () => {
    const shell = resolveShellFrom(winInput({ isPackaged: true, existingFiles: [BUNDLED] }))
    expect(shell.kind).toBe('busybox')
    expect(shell.path).toBe(BUNDLED)
    expect(shell.args).toEqual(['-c'])
    expect(shell.error).toBeNull()
  })

  test('内置 busybox 缺失时显式报错，不降级到 cmd/PowerShell', () => {
    const shell = resolveShellFrom(winInput({
      isPackaged: true,
      // PATH 上即使有 Git Bash，打包模式也不使用，保证行为确定性
      pathEnv: 'C:\\Program Files\\Git\\bin',
      existingFiles: [GIT_BASH],
    }))
    expect(shell.kind).toBe('none')
    expect(shell.path).toBeNull()
    expect(shell.error).toContain('重新安装')
  })
})

describe('Windows 开发模式', () => {
  test('优先使用 PATH 中的真 bash（Git Bash）', () => {
    const shell = resolveShellFrom(winInput({
      pathEnv: 'C:\\Windows\\System32;C:\\Program Files\\Git\\bin',
      existingFiles: [GIT_BASH, WSL_BASH, DEV_VENDOR],
    }))
    expect(shell.kind).toBe('bash')
    expect(shell.path).toBe(GIT_BASH)
  })

  test('排除 System32 的 WSL 启动器，回退到开发版内置 busybox', () => {
    const shell = resolveShellFrom(winInput({
      pathEnv: 'C:\\Windows\\System32',
      existingFiles: [WSL_BASH, DEV_VENDOR],
    }))
    expect(shell.kind).toBe('busybox')
    expect(shell.path).toBe(DEV_VENDOR)
  })

  test('无 bash 且无内置 busybox 时报错并给出修复指引', () => {
    const shell = resolveShellFrom(winInput({
      pathEnv: 'C:\\Windows\\System32',
      existingFiles: [WSL_BASH],
    }))
    expect(shell.kind).toBe('none')
    expect(shell.error).toContain('Git for Windows')
    expect(shell.error).toContain('download-bash')
  })

  test('PATH 目录带引号或尾部斜杠仍能命中', () => {
    const found = findWindowsBashOnPath({
      pathEnv: '"C:\\Program Files\\Git\\bin\\";C:\\Windows',
      systemRoot: 'C:\\Windows',
      fileExists: (p) => p.toLowerCase() === GIT_BASH.toLowerCase(),
    })
    expect(found).toBe(GIT_BASH)
  })
})

describe('WSL 启动器目录判定', () => {
  test('System32 与 Sysnative 目录被识别（大小写与斜杠形式不敏感）', () => {
    expect(isWslLauncherDir('C:\\Windows\\System32', 'C:\\Windows')).toBe(true)
    expect(isWslLauncherDir('c:/windows/system32/', 'C:\\Windows')).toBe(true)
    expect(isWslLauncherDir('C:\\Windows\\Sysnative', 'C:\\Windows')).toBe(true)
    expect(isWslLauncherDir('C:\\Program Files\\Git\\bin', 'C:\\Windows')).toBe(false)
    expect(isWslLauncherDir('C:\\Windows\\System32Extra', 'C:\\Windows')).toBe(false)
  })
})

describe('macOS / Linux', () => {
  test('优先 /bin/bash', () => {
    const shell = resolveShellFrom(unixInput({ existingFiles: ['/bin/bash'] }))
    expect(shell.kind).toBe('bash')
    expect(shell.path).toBe('/bin/bash')
  })

  test('无 /bin/bash 时查找 PATH，最终回退 sh', () => {
    const fromPath = resolveShellFrom(unixInput({
      pathEnv: '/opt/homebrew/bin:/usr/local/bin',
      existingFiles: ['/usr/local/bin/bash'],
    }))
    expect(fromPath.path).toBe('/usr/local/bin/bash')

    const fallback = resolveShellFrom(unixInput({ pathEnv: '/usr/bin' }))
    expect(fallback.kind).toBe('bash')
    expect(fallback.path).toBe('sh')
  })
})

describe('Shell 环境 prompt 段落', () => {
  test('busybox 时声明 POSIX ash 限制与路径写法', () => {
    const section = buildShellPromptSection({ kind: 'busybox', path: BUNDLED, args: ['-c'], error: null })
    expect(section).toContain('busybox')
    expect(section).toContain('POSIX')
    expect(section).toContain('[[ ]]')
    expect(section).toContain('-P')
    expect(section).toContain('C:/Users')
  })

  test('无可用 shell 时声明工具不可用并携带修复指引', () => {
    const section = buildShellPromptSection({ kind: 'none', path: null, args: [], error: '内置 bash 缺失（安装文件可能已损坏），请重新安装 Kila' })
    expect(section).toContain('不可用')
    expect(section).toContain('重新安装')
  })

  test('真 bash（macOS/Linux/Git Bash）不注入任何限制', () => {
    expect(buildShellPromptSection({ kind: 'bash', path: '/bin/bash', args: ['-c'], error: null })).toBeNull()
    expect(buildShellPromptSection({ kind: 'bash', path: GIT_BASH, args: ['-c'], error: null })).toBeNull()
  })
})
