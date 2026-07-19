/**
 * 环境检测状态管理
 *
 * 管理环境检测结果、检测状态和问题标记
 */

import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { EnvironmentCheckResult, InstallerManifest, RuntimeStatus } from '@kila/shared'

export interface InstallerDownloadState {
  status: 'idle' | 'downloading' | 'done' | 'failed' | 'cancelled'
  downloaded?: number
  total?: number
  speed?: number
  filePath?: string
  error?: string
}

/**
 * 环境检测结果 Atom
 * 存储最后一次环境检测的完整结果
 */
export const environmentCheckResultAtom = atom<EnvironmentCheckResult | null>(null)

/**
 * 运行时状态 Atom
 * 包含 Windows Shell（内置 BusyBox）/ WSL 检测结果。
 */
export const runtimeStatusAtom = atom<RuntimeStatus | null>(null)

/**
 * 是否正在检测环境 Atom
 * 用于显示加载状态
 */
export const isCheckingEnvironmentAtom = atom(false)

/**
 * 安装包清单 Atom
 */
export const installerManifestAtom = atom<InstallerManifest | null>(null)

/**
 * 安装器下载状态 Atom
 * key 形如 "git-for-windows:x64"。
 */
export const installerDownloadStatesAtom = atom<Record<string, InstallerDownloadState>>({})

/**
 * 是否存在环境问题 Atom（派生）
 * 根据检测结果判断是否显示红点标记
 */
export const hasEnvironmentIssuesAtom = atom((get) => {
  const result = get(environmentCheckResultAtom)
  const runtime = get(runtimeStatusAtom)
  const hasClassicIssues = result?.hasIssues ?? false
  const hasShellIssues = runtime?.shell
    ? !runtime.shell.gitBash.available && !runtime.shell.wsl.available
    : false
  return hasClassicIssues || hasShellIssues
})

export const isShellEnvironmentOkAtom = atom((get) => {
  const runtime = get(runtimeStatusAtom)
  if (!runtime?.shell) return true
  return runtime.shell.gitBash.available || runtime.shell.wsl.available
})

/**
 * 用户是否已完成环境引导
 * 持久化到 localStorage，首次启动默认 false
 */
export const environmentSetupCompletedAtom = atomWithStorage<boolean>(
  'kila-env-setup-completed',
  false,
)
