/**
 * ContextUsageIndicator — composer 工具栏上的实时 context 用量指示器
 *
 * 一个仪表盘图标按钮，颜色随用量变化，hover 展开紧凑卡片。
 * 自取数：通过 agentContextStatusAtomFamily 订阅，不经 props 传入，
 * 避免流式更新时穿透 React.memo。
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { Gauge } from 'lucide-react'
import { agentContextStatusAtomFamily } from '@/atoms/agent-context-atoms'
import { formatTokenCount } from '@/atoms/usage-atoms'
import { cn } from '@/lib/utils'
import { ToolbarHoverPopover } from './ToolbarHoverPopover'
import { getStatusToneClasses } from '@/lib/theme/status-tone'

/** 进度条（紧凑型） */
function MiniBar({ percent }: { percent: number }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-muted">
      <div
        className={cn(
          'h-full rounded-full transition-all duration-300',
          percent > 85
            ? getStatusToneClasses('danger').progress
            : percent > 65
              ? getStatusToneClasses('warning').progress
              : 'bg-primary/70',
        )}
        style={{ width: `${Math.min(100, percent)}%` }}
      />
    </div>
  )
}

interface ContextUsageIndicatorProps {
  sessionId: string
  buttonClassName?: string
  iconClassName?: string
}

export function ContextUsageIndicator({
  sessionId,
  buttonClassName = 'size-[30px] rounded-lg',
  iconClassName = 'size-5',
}: ContextUsageIndicatorProps) {
  const { t } = useTranslation()
  const contextStatus = useAtomValue(agentContextStatusAtomFamily(sessionId))

  const hasData = typeof contextStatus.inputTokens === 'number' && contextStatus.inputTokens > 0
  const percent = hasData && contextStatus.contextWindow && contextStatus.inputTokens
    ? Math.min(100, (contextStatus.inputTokens! / contextStatus.contextWindow) * 100)
    : 0

  const iconColor = !hasData
    ? 'text-foreground/30'
    : percent > 85
      ? getStatusToneClasses('danger').text
      : percent > 65
        ? getStatusToneClasses('warning').text
        : 'text-foreground/60'

  return (
    <ToolbarHoverPopover
      disabled={!hasData}
      side="top"
      align="center"
      sideOffset={6}
      contentClassName="w-[180px] rounded-lg border border-border/50 bg-popover p-2.5 shadow-lg"
      trigger={({ open, triggerProps }) => (
        <button
          {...triggerProps}
          className={cn(
            buttonClassName,
            'flex items-center justify-center transition-colors hover:bg-muted/60',
            iconColor,
            !hasData && 'opacity-40',
          )}
          aria-label={hasData ? t('composer.contextUsed', { percent: Math.round(percent) }) : t('composer.noContextData')}
        >
          <Gauge className={iconClassName} />
        </button>
      )}
    >
      {({ close }) => (
        <div className="space-y-2" onClick={() => close()}>
          {/* 百分比 + 进度条 */}
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] font-semibold tabular-nums text-foreground">
                {percent.toFixed(1)}%
              </span>
              {contextStatus.isCompacting && (
                <span className={`text-[10px] ${getStatusToneClasses('warning').text}`}>{t('composer.compacting')}</span>
              )}
            </div>
            <div className="mt-1">
              <MiniBar percent={percent} />
            </div>
          </div>

          {/* Token 数 */}
          {contextStatus.inputTokens !== undefined && (
            <div className="text-[11px] tabular-nums text-muted-foreground">
              {formatTokenCount(contextStatus.inputTokens)}
              {contextStatus.contextWindow ? (
                <> / {formatTokenCount(contextStatus.contextWindow)}</>
              ) : null}
            </div>
          )}

          {/* 来源 */}
          <div className="text-[10px] text-muted-foreground/50">
            {contextStatus.source === 'live' ? t('composer.usageLive') : t('composer.usageEstimated')}
          </div>
        </div>
      )}
    </ToolbarHoverPopover>
  )
}
