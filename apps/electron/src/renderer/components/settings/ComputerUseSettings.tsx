/**
 * ComputerUseSettings - 桌面操控 (Cua Driver) 设置页
 *
 * 管理 cua-driver 的安装检测、一键启用/禁用和连接测试。
 * cua-driver 是一个 Rust 编写的 MCP 服务器，提供 40+ 桌面操控工具
 * （截图、鼠标、键盘、窗口管理、辅助功能树等）。
 * 启用后自动注册为全局 MCP 服务器，Agent 可直接调用。
 */

import * as React from 'react'
import {
  CheckCircle2,
  CircleX,
  Download,
  ExternalLink,
  Loader2,
  Monitor,
  RefreshCw,
  Terminal,
  ToggleLeft,
  ToggleRight,
  Wrench,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  SettingsSection,
  SettingsCard,
  SettingsToggle,
} from './primitives'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { CuaDriverStatus } from '@kila/shared'
import { getStatusToneClasses } from '@/lib/theme/status-tone'

/** 安装脚本文档链接 */
const CUA_DRIVER_DOCS_URL = 'https://cua.ai/docs/cua-driver'

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}

export function ComputerUseSettings(): React.ReactElement {
  const [status, setStatus] = React.useState<CuaDriverStatus | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [detecting, setDetecting] = React.useState(false)
  const [installing, setInstalling] = React.useState(false)
  const [toggling, setToggling] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<{ success: boolean; message: string } | null>(null)

  /** 加载当前状态 */
  const loadStatus = React.useCallback(async (): Promise<void> => {
    try {
      const result = await window.electronAPI.getCuaDriverStatus()
      setStatus(result)
    } catch (error) {
      console.error('[ComputerUse] 获取状态失败:', error)
      toast.error('获取 Cua Driver 状态失败')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    loadStatus()
  }, [loadStatus])

  /** 刷新检测 */
  const handleDetect = async (): Promise<void> => {
    setDetecting(true)
    setTestResult(null)
    try {
      await window.electronAPI.detectCuaDriver()
      await loadStatus()
      toast.success('检测完成')
    } catch (error) {
      console.error('[ComputerUse] 检测失败:', error)
      toast.error('检测失败')
    } finally {
      setDetecting(false)
    }
  }

  /** 一键安装 */
  const handleInstall = async (): Promise<void> => {
    setInstalling(true)
    try {
      const result = await window.electronAPI.installCuaDriver()
      if (result.success) {
        toast.success(result.message)
      } else {
        toast.error(result.message)
      }
      await loadStatus()
    } catch (error) {
      console.error('[ComputerUse] 安装失败:', error)
      toast.error('安装失败')
    } finally {
      setInstalling(false)
    }
  }

  /** 启用/禁用 */
  const handleToggle = async (enabled: boolean): Promise<void> => {
    setToggling(true)
    try {
      const newStatus = await window.electronAPI.toggleCuaDriver(enabled)
      setStatus(newStatus)
      toast.success(enabled ? 'Cua Driver 已启用' : 'Cua Driver 已禁用')
    } catch (error) {
      console.error('[ComputerUse] 切换失败:', error)
      toast.error('操作失败')
    } finally {
      setToggling(false)
    }
  }

  /** 测试连接 */
  const handleTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.electronAPI.testCuaDriver()
      setTestResult(result)
    } catch (error) {
      setTestResult({ success: false, message: '测试异常' })
    } finally {
      setTesting(false)
    }
  }

  // 加载中骨架
  if (loading || !status) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 size={24} className="animate-spin" />
        <span className="ml-2">加载中...</span>
      </div>
    )
  }

  const isInstalled = status.installStatus === 'installed'
  const platformLabel = status.platform === 'macos' ? 'macOS' : status.platform === 'windows' ? 'Windows' : 'Linux'

  return (
    <div className="space-y-6">
      {/* 概览 */}
      <SettingsSection
        title="桌面操控"
        description="让 Agent 能看到屏幕、点击按钮、输入文字，像人一样操控桌面应用"
      >
        <SettingsCard>
          {/* 状态栏 */}
          <div className="flex items-start gap-4 px-5 py-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border/50 bg-muted/30">
              <Monitor size={24} className="text-foreground/70" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <div className="text-base font-medium text-foreground">Cua Driver</div>
                <Badge
                  variant="outline"
                  className={cn(
                    'border-border/50 px-2 py-0.5 text-[11px]',
                    isInstalled
                      ? getStatusToneClasses('success').subtleSurface
                      : getStatusToneClasses('warning').subtleSurface,
                  )}
                >
                  {isInstalled ? `已安装 ${status.version ? `v${status.version}` : ''}` : '未安装'}
                </Badge>
                {status.platform && (
                  <Badge variant="outline" className="border-border/50 bg-muted/15 text-[11px] text-muted-foreground">
                    {platformLabel}
                  </Badge>
                )}
              </div>

              {/* 详细信息 */}
              <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                {status.binaryPath && (
                  <div className="flex items-center gap-2">
                    <Terminal size={14} className="shrink-0" />
                    <span className="truncate font-mono text-xs">{status.binaryPath}</span>
                  </div>
                )}
                {status.registered && (
                  <div className="flex items-center gap-2">
                    <Wrench size={14} className="shrink-0" />
                    <span>已注册为全局 MCP 服务器</span>
                  </div>
                )}
                <div className="text-xs text-muted-foreground/60">
                  上次检测: {formatTime(status.lastCheckedAt)}
                </div>
              </div>

              {/* 操作按钮 */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDetect}
                  disabled={detecting}
                >
                  {detecting ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <RefreshCw size={14} className="mr-1.5" />}
                  重新检测
                </Button>

                {!isInstalled && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleInstall}
                    disabled={installing}
                  >
                    {installing ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Download size={14} className="mr-1.5" />}
                    一键安装
                  </Button>
                )}

                {isInstalled && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTest}
                    disabled={testing}
                  >
                    {testing ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Wrench size={14} className="mr-1.5" />}
                    测试连接
                  </Button>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(CUA_DRIVER_DOCS_URL, '_blank')}
                >
                  <ExternalLink size={14} className="mr-1.5" />
                  文档
                </Button>
              </div>

              {/* 测试结果 */}
              {testResult && (
                <div
                  className={cn(
                    'mt-3 flex items-center gap-2 rounded-xl border border-border/50 px-3 py-2 text-sm',
                    testResult.success
                      ? getStatusToneClasses('success').subtleSurface
                      : getStatusToneClasses('warning').subtleSurface,
                  )}
                >
                  {testResult.success ? <CheckCircle2 size={16} /> : <CircleX size={16} />}
                  <span>{testResult.message}</span>
                </div>
              )}
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>

      {/* 启用/禁用 */}
      {isInstalled && (
        <SettingsSection
          title="Agent 能力"
          description="启用后 Agent 将获得桌面操控能力（截图、鼠标、键盘、窗口管理等 40+ 工具）"
        >
          <SettingsCard>
            <SettingsToggle
              label="启用桌面操控"
              description={status.enabled
                ? 'Agent 可通过 MCP 调用 cua-driver 提供的所有桌面操控工具'
                : '启用后 cua-driver 将自动注册为全局 MCP 服务器'}
              checked={status.enabled}
              onCheckedChange={(checked) => handleToggle(checked)}
              disabled={toggling}
            />
          </SettingsCard>
        </SettingsSection>
      )}

      {/* 未安装提示 */}
      {!isInstalled && (
        <SettingsSection
          title="安装方式"
          description="选择适合你平台的安装命令"
        >
          <SettingsCard>
            <div className="space-y-4 px-5 py-4">
              {status.platform === 'macos' && (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-foreground">macOS / Linux</div>
                  <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                    <code className="text-xs text-foreground break-all">
                      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh)"
                    </code>
                  </div>
                </div>
              )}

              {status.platform === 'windows' && (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-foreground">Windows (PowerShell)</div>
                  <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                    <code className="text-xs text-foreground break-all">
                      irm https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.ps1 | iex
                    </code>
                  </div>
                </div>
              )}

              {status.platform === 'linux' && (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-foreground">Linux</div>
                  <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                    <code className="text-xs text-foreground break-all">
                      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh)"
                    </code>
                  </div>
                </div>
              )}

              <div className="text-xs text-muted-foreground">
                安装完成后点击「重新检测」，或直接点击「一键安装」自动完成。
              </div>
            </div>
          </SettingsCard>
        </SettingsSection>
      )}

      {/* 安全提示 */}
      <SettingsSection
        title="安全提示"
        description="桌面操控能力的权限边界"
      >
        <SettingsCard>
          <div className="space-y-3 px-5 py-4 text-sm text-muted-foreground">
            <div className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--status-warning))]" />
              <span>cua-driver 能操控整个桌面（鼠标、键盘、文件系统），建议在 <strong className="text-foreground">Ask</strong> 权限模式下使用，所有工具调用需确认后执行</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--status-warning))]" />
              <span>macOS 需要在「系统设置 → 隐私与安全性 → 辅助功能」中授权应用</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--status-success))]" />
              <span>cua-driver 以 MCP 服务器方式运行，所有工具调用都经过 Kila 的权限系统管控</span>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}
