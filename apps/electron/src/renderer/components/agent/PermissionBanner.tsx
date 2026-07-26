/**
 * PermissionBanner — Agent 权限请求横幅
 *
 * 内联在 Agent session流底部，当有待处理的权限请求时显示。
 * 显示工具名、命令内容、危险等级，提供允许/拒绝/总是允许操作。
 * 支持队列模式：多个并发请求按 FIFO 逐个展示。
 *
 * 设计参考 Craft Agents OSS 的内联权限 UI。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Shield, ShieldAlert, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { allPendingPermissionRequestsAtom } from '@/atoms/agent-permission-atoms'
import type { DangerLevel } from '@kila/shared'
import { getStatusToneClasses } from '@/lib/theme/status-tone'
import { formatPayloadPreview } from './agent-messages-utils'

/** 危险等级对应的图标颜色 */
const DANGER_ICON_STYLES: Record<DangerLevel, string> = {
  safe: getStatusToneClasses('success').icon,
  normal: 'text-primary',
  dangerous: getStatusToneClasses('warning').icon,
}

/** 解析工具显示名称（MCP 工具显示 server / tool） */
function formatToolName(toolName: string): string {
  const parts = toolName.split('__')
  if (parts[0] === 'mcp' && parts.length >= 3) {
    return `${parts[1]} / ${parts.slice(2).join('__')}`
  }
  return toolName
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/** PermissionBanner 属性接口 */
interface PermissionBannerProps {
  sessionId: string
}

export function PermissionBanner({ sessionId }: PermissionBannerProps): React.ReactElement | null {
  const allRequests = useAtomValue(allPendingPermissionRequestsAtom)
  const requests = allRequests.get(sessionId) ?? []
  const [responding, setResponding] = React.useState(false)
  const [responseError, setResponseError] = React.useState<string | null>(null)
  const [now, setNow] = React.useState(() => Date.now())

  const request = requests[0] ?? null

  React.useEffect(() => {
    setResponding(false)
    setResponseError(null)
  }, [request?.requestId])

  React.useEffect(() => {
    if (!request?.expiresAt) return
    setNow(Date.now())
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [request?.requestId, request?.expiresAt])

  if (!request) return null

  /** 响应权限请求 */
  const respond = async (behavior: 'allow' | 'deny', alwaysAllow = false): Promise<void> => {
    const expired = typeof request.expiresAt === 'number' && request.expiresAt <= Date.now()
    if (responding || expired) return
    setResponding(true)
    setResponseError(null)

    try {
      await window.electronAPI.respondPermission({
        requestId: request.requestId,
        behavior,
        alwaysAllow,
      })
    } catch (error) {
      console.error('[PermissionBanner] 响应失败:', error)
      setResponseError(error instanceof Error ? error.message : '操作未提交，请重试')
    } finally {
      setResponding(false)
    }
  }

  const iconColor = DANGER_ICON_STYLES[request.dangerLevel]
  const isDangerous = request.dangerLevel === 'dangerous'
  const IconComponent = isDangerous ? ShieldAlert : Shield
  const remainingMs = typeof request.expiresAt === 'number' ? request.expiresAt - now : null
  const isExpired = remainingMs !== null && remainingMs <= 0
  const expiryHint = remainingMs !== null
    ? (remainingMs > 0 ? `将在 ${formatRemaining(remainingMs)} 后自动拒绝` : '请求已过期，正在移除')
    : null

  return (
    <div
      role="region"
      aria-label="权限确认"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || event.defaultPrevented) return
        if (event.key === 'Enter' && !isDangerous && !isExpired) {
          event.preventDefault()
          void respond('allow')
        }
      }}
      className="mx-3 mb-2 overflow-hidden rounded-[var(--kila-panel-radius)] border border-border/35 bg-workspace shadow-none outline-none animate-in slide-in-from-bottom-2 duration-200 focus-visible:ring-2 focus-visible:ring-primary/40 md:mx-[24px]"
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <IconComponent className={`size-4 ${iconColor}`} />
          <div className="flex flex-col">
            <span className="text-sm font-medium">
              {isDangerous ? '危险操作需要确认' : '需要确认'}
            </span>
            {expiryHint && (
              <span className="text-[11px] text-muted-foreground" aria-live="polite">
                {expiryHint}
              </span>
            )}
          </div>
          {requests.length > 1 && (
            <span className="text-xs text-muted-foreground">
              (+{requests.length - 1})
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground font-mono">
          {formatToolName(request.toolName)}
        </span>
      </div>

      {/* 命令/操作内容 */}
      <div className="px-3 pb-2">
        {request.command ? (
          <pre className="max-h-[120px] overflow-x-auto overflow-y-auto whitespace-pre-wrap break-all rounded-lg border border-border/35 bg-background/55 px-2 py-1.5 font-mono text-xs">
            {request.command}
          </pre>
        ) : Object.keys(request.toolInput).length > 0 ? (
          <pre className="max-h-[120px] overflow-x-auto overflow-y-auto whitespace-pre-wrap break-all rounded-lg border border-border/35 bg-background/55 px-2 py-1.5 font-mono text-xs">
            {formatPayloadPreview(request.toolInput)}
          </pre>
        ) : (
          <p className="text-xs text-muted-foreground">
            {request.description}
          </p>
        )}
      </div>

      {responseError && (
        <p role="alert" className="px-3 pb-2 text-xs text-destructive">
          {responseError}
        </p>
      )}

      {/* 操作按钮 */}
      <div className="flex items-center justify-end gap-1.5 px-3 pb-2.5">
        {!isExpired && (
          <span className="text-[10px] text-muted-foreground/40 mr-auto">
            {isDangerous ? '危险操作请点击按钮确认' : '聚焦卡片后按 Enter 允许'}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => respond('deny')}
          disabled={responding || isExpired}
          className="h-7 px-3 text-xs text-muted-foreground hover:text-destructive"
        >
          <X className="size-3 mr-1" />
          拒绝
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => respond('allow', true)}
          disabled={responding || isExpired}
          className="h-7 px-3 text-xs"
        >
          本次会话总是允许
        </Button>

        <Button
          variant="default"
          size="sm"
          onClick={() => respond('allow')}
          disabled={responding || isExpired}
          className="h-7 px-3 text-xs"
        >
          <Check className="size-3 mr-1" />
          允许
        </Button>
      </div>
    </div>
  )
}
