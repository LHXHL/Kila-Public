/**
 * SessionUsageBadge — 在 SessionHeader 显示当前会话的 Token 用量
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Zap } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { currentSessionUsageAtom, contextUsagePercentAtom, formatTokenCount, formatCostUsd } from '@/atoms/usage-atoms'
import { getStatusToneClasses } from '@/lib/theme/status-tone'

export function SessionUsageBadge(): React.ReactElement | null {
  const usage = useAtomValue(currentSessionUsageAtom)
  const contextPercent = useAtomValue(contextUsagePercentAtom)

  // 无用量数据且无上下文使用率时不渲染
  if (!usage) {
    if (contextPercent === undefined) return null
    // 有上下文百分比但没有 usage — 仍然显示百分比
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-foreground/46 transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <Zap className="size-3" />
            <span className="text-foreground/28">{contextPercent}%</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="center"
          className="w-64 rounded-xl border border-border/60 p-3 shadow-none"
        >
          <div className="mb-2 text-xs font-medium text-foreground">上下文窗口</div>
          <div className="space-y-1.5 text-xs text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>使用率</span>
              <span className="font-medium text-foreground">{contextPercent}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all ${
                  contextPercent > 80 ? getStatusToneClasses('warning').progress : 'bg-primary/60'
                }`}
                style={{ width: `${contextPercent}%` }}
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    )
  }

  const totalTokens = usage.inputTokens + (usage.outputTokens ?? 0)
    + (usage.cacheReadTokens ?? 0) + (usage.cacheCreationTokens ?? 0)
  if (totalTokens === 0 && contextPercent === undefined) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-foreground/46 transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          <Zap className="size-3" />
          {formatTokenCount(totalTokens)}
          {contextPercent !== undefined && (
            <span className="text-foreground/28">
              {contextPercent}%
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="center"
        className="w-64 rounded-xl border border-border/60 p-3 shadow-none"
      >
        <div className="mb-2 text-xs font-medium text-foreground">会话用量</div>
        <div className="space-y-1.5 text-xs text-muted-foreground">
          <Row label="输入" value={formatTokenCount(usage.inputTokens)} />
          {usage.outputTokens !== undefined && usage.outputTokens > 0 && (
            <Row label="输出" value={formatTokenCount(usage.outputTokens)} />
          )}
          {usage.cacheReadTokens !== undefined && usage.cacheReadTokens > 0 && (
            <Row label="缓存读取" value={formatTokenCount(usage.cacheReadTokens)} />
          )}
          {usage.cacheCreationTokens !== undefined && usage.cacheCreationTokens > 0 && (
            <Row label="缓存写入" value={formatTokenCount(usage.cacheCreationTokens)} />
          )}
          {(usage.costUsd ?? 0) > 0 && (
            <Row label="成本" value={formatCostUsd(usage.costUsd ?? 0)} />
          )}
          {contextPercent !== undefined && (
            <div className="mt-2 pt-2 border-t border-border/40">
              <div className="flex items-center justify-between mb-1">
                <span>上下文窗口</span>
                <span className="text-foreground">{contextPercent}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all ${
                    contextPercent > 80 ? getStatusToneClasses('warning').progress : 'bg-primary/60'
                  }`}
                  style={{ width: `${contextPercent}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  )
}
