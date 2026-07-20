/**
 * AboutSettings - 关于页面
 *
 * 展示应用版本号，通过 GitHub Releases API 检查更新。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { AlertCircle, CheckCircle2, Download, ExternalLink, Info, Loader2, Play, RefreshCw, XCircle } from 'lucide-react'
import { SettingsCard } from './primitives'
import { Button } from '@/components/ui/button'
import {
  installerDownloadStatesAtom,
  installerManifestAtom,
  type InstallerDownloadState,
} from '@/atoms/environment'
import type { EnvironmentCheckResult, GitHubRelease, RuntimeStatus } from '@kila/shared'
import { getStatusToneClasses } from '@/lib/theme/status-tone'

declare const __APP_VERSION__: string
const APP_VERSION = __APP_VERSION__

const GITHUB_RELEASES_URL = 'https://github.com/LHXHL/Kila-Public/releases'
const GITHUB_PROFILE_URL = 'https://github.com/LHXHL'

/** 语义化版本比较：>0 表示 a 更新，<0 表示 b 更新，0 表示相同 */
function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

type CheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'up-to-date' }
  | { status: 'available'; release: GitHubRelease }
  | { status: 'error'; message: string }

type EnvironmentItemStatus = 'ok' | 'warning' | 'missing' | 'checking'

interface EnvironmentItem {
  id: 'shell' | 'git' | 'nodejs'
  name: string
  status: EnvironmentItemStatus
  detail: string
  requirement: string
  installerId?: 'git-for-windows' | 'nodejs'
}

export function AboutSettings(): React.ReactElement {
  const setManifest = useSetAtom(installerManifestAtom)
  const [checkState, setCheckState] = React.useState<CheckState>({ status: 'idle' })

  const handleCheck = async (): Promise<void> => {
    setCheckState({ status: 'checking' })
    try {
      const release = await window.electronAPI.getLatestRelease()
      if (!release) {
        setCheckState({ status: 'error', message: '未获取到发布信息' })
        return
      }
      if (compareSemver(release.tag_name, APP_VERSION) > 0) {
        setCheckState({ status: 'available', release })
      } else {
        setCheckState({ status: 'up-to-date' })
      }
    } catch (err) {
      setCheckState({ status: 'error', message: err instanceof Error ? err.message : '网络错误' })
    }
  }

  const handleGoToRelease = (release: GitHubRelease): void => {
    window.electronAPI.openExternal(release.html_url || GITHUB_RELEASES_URL)
  }


  return (
    <div className="w-full">
      <div className="flex items-center gap-2 mb-6">
        <Info className="h-4 w-4" />
        <h2 className="text-[15px] font-bold">关于</h2>
      </div>

      <SettingsCard divided={false} className="p-6">
        <div className="space-y-6">
          <div>
            <h3 className="text-[14px] font-bold text-foreground">关于</h3>
            <p className="text-[13px] text-muted-foreground mt-2 tracking-wide font-medium">
              Kila 是{' '}
              <button
                type="button"
                className="font-semibold text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-primary hover:decoration-primary/50"
                onClick={() => void window.electronAPI.openExternal(GITHUB_PROFILE_URL)}
              >
                Qiu
              </button>{' '}
              打造的优雅 AI 提供商编排桌面端。
            </p>
          </div>

          {/* 版本 + 更新检查 */}
          <div className="space-y-3">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h3 className="text-[13px] font-bold text-muted-foreground">当前版本</h3>
                <p className="font-mono text-[15px] font-bold text-foreground tracking-wider mt-1">{APP_VERSION}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={checkState.status === 'checking'}
                onClick={() => void handleCheck()}
              >
                {checkState.status === 'checking'
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <RefreshCw className="h-4 w-4" />}
                检查更新
              </Button>
            </div>

            {checkState.status === 'up-to-date' && (
              <div className="flex items-center gap-2 rounded-md bg-muted/35 px-3 py-2 text-[13px]">
                <CheckCircle2 className={`h-4 w-4 shrink-0 ${getStatusToneClasses('success').icon}`} />
                <span className="font-medium text-foreground">已是最新版本</span>
              </div>
            )}

            {checkState.status === 'available' && (
              <div className="flex items-center justify-between gap-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
                <div className="flex items-center gap-2 text-[13px]">
                  <Download className="h-4 w-4 shrink-0 text-primary" />
                  <span className="font-semibold text-primary">
                    发现新版本 {checkState.release.tag_name}
                  </span>
                </div>
                <Button
                  size="sm"
                  className="gap-1.5 text-[13px]"
                  onClick={() => handleGoToRelease(checkState.release)}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  前往下载
                </Button>
              </div>
            )}

            {checkState.status === 'error' && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-[13px]">
                <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
                <span className="text-destructive">{checkState.message}</span>
              </div>
            )}
          </div>
        </div>
      </SettingsCard>

    </div>
  )
}

function getEnvironmentItems(
  environmentResult: EnvironmentCheckResult | null,
  runtimeStatus: RuntimeStatus | null,
): EnvironmentItem[] {
  const shell = runtimeStatus?.shell
  const gitBash = shell?.gitBash
  const wsl = shell?.wsl
  const shellOk = !shell || Boolean(gitBash?.available || wsl?.available)
  const shellDetail = !shell
    ? '非 Windows 平台无需额外 Shell 环境'
    : gitBash?.available
      ? `Shell (BusyBox) ${gitBash.version ?? ''} 已可用`
      : wsl?.available
        ? `WSL ${wsl.defaultDistro ?? ''} 已可用`
        : '未检测到可用 Shell 或 WSL'

  const git = environmentResult?.git
  const nodejs = environmentResult?.nodejs

  return [
    {
      id: 'shell',
      name: 'Windows Shell',
      status: !runtimeStatus ? 'checking' : shellOk ? 'ok' : 'missing',
      detail: !runtimeStatus ? '等待检测' : shellDetail,
      requirement: '必需：内置 Shell 或 WSL 任一可用即可运行 Agent',
      installerId: shell && !shellOk ? 'git-for-windows' : undefined,
    },
    {
      id: 'git',
      name: 'Git',
      status: !git ? 'checking' : git.installed && git.meetsRequirement ? 'ok' : 'missing',
      detail: !git ? '等待检测' : git.installed ? `v${git.version ?? 'unknown'}` : '未安装',
      requirement: '必需：用于仓库上下文、工作区检测',
      installerId: git && (!git.installed || !git.meetsRequirement) ? 'git-for-windows' : undefined,
    },
    {
      id: 'nodejs',
      name: 'Node.js',
      status: !nodejs
        ? 'checking'
        : nodejs.installed && nodejs.meetsMinimum
          ? nodejs.meetsRecommended ? 'ok' : 'warning'
          : 'missing',
      detail: !nodejs
        ? '等待检测'
        : nodejs.installed
          ? `v${nodejs.version ?? 'unknown'}${nodejs.meetsRecommended ? '' : '，建议升级到 22+ LTS'}`
          : '未安装',
      requirement: '推荐：运行 npx 类 MCP 服务器时需要',
      installerId: nodejs && (!nodejs.installed || !nodejs.meetsMinimum || !nodejs.meetsRecommended) ? 'nodejs' : undefined,
    },
  ]
}

function detectInstallerArch(): 'x64' | 'arm64' {
  return /arm64|aarch64/i.test(navigator.userAgent) ? 'arm64' : 'x64'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function InstallerAction({
  installerId,
  toolName,
  onRefresh,
}: {
  installerId: 'git-for-windows' | 'nodejs'
  toolName: string
  onRefresh: () => Promise<void>
}): React.ReactElement {
  const manifest = useAtomValue(installerManifestAtom)
  const [downloadStates, setDownloadStates] = useAtom(installerDownloadStatesAtom)
  const arch = detectInstallerArch()
  const key = `${installerId}:${arch}`
  const state: InstallerDownloadState = downloadStates[key] ?? { status: 'idle' }
  const hasSource = manifest?.installers.some((source) => source.id === installerId && source.arch === arch) ?? true

  React.useEffect(() => {
    const off = window.electronAPI.onInstallerProgress((payload) => {
      if (payload.key !== key) return
      setDownloadStates((prev) => ({
        ...prev,
        [key]: {
          ...(prev[key] ?? { status: 'downloading' }),
          status: 'downloading',
          downloaded: payload.downloaded,
          total: payload.total,
          speed: payload.speed,
        },
      }))
    })
    return off
  }, [key, setDownloadStates])

  const handleDownload = async (): Promise<void> => {
    setDownloadStates((prev) => ({
      ...prev,
      [key]: { status: 'downloading', downloaded: 0, total: 0, speed: 0 },
    }))

    try {
      const result = await window.electronAPI.downloadInstaller({ id: installerId, arch })
      setDownloadStates((prev) => ({
        ...prev,
        [key]: { status: 'done', filePath: result.filePath },
      }))
      await window.electronAPI.launchInstaller(result.filePath)
      toast.success(`${toolName} 安装器已打开`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setDownloadStates((prev) => ({
        ...prev,
        [key]: {
          status: message === 'cancelled' ? 'cancelled' : 'failed',
          error: message,
        },
      }))
      if (message !== 'cancelled') toast.error(`${toolName} 下载失败`)
    }
  }

  if (state.status === 'downloading') {
    const downloaded = state.downloaded ?? 0
    const total = state.total ?? 0
    const pct = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0
    return (
      <div className="w-full min-w-[180px] max-w-[240px] space-y-1.5">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{pct}% · {formatBytes(downloaded)} / {formatBytes(total)}</span>
          <button className="font-medium text-foreground hover:underline" onClick={() => void window.electronAPI.cancelInstallerDownload(key)}>
            取消
          </button>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-[hsl(var(--brand-soft))] transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
    )
  }

  if (state.status === 'done' && state.filePath) {
    return (
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => void window.electronAPI.launchInstaller(state.filePath!)}>
          <Play className="size-4" />
          打开安装器
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void onRefresh()}>
          重检
        </Button>
      </div>
    )
  }

  return (
    <Button variant="outline" size="sm" onClick={() => void handleDownload()} disabled={!hasSource}>
      <Download className="size-4" />
      下载{toolName}
    </Button>
  )
}
