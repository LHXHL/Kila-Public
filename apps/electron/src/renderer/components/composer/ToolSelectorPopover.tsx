/**
 * ToolSelectorPopover - 工具选择器弹出层
 *
 * 在统一 Agent 输入区 footer 中显示工具开关列表。
 * 用户可以快速启用/禁用工具（记忆、联网搜索等）。
 * 类似 ContextSettingsPopover 的交互方式。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { Wrench, Brain, Globe, Settings, ImagePlus } from 'lucide-react'
import { agentToolsAtom, hasActiveToolsAtom } from '@/atoms/agent-tool-atoms'
import { ToolbarHoverPopover } from './ToolbarHoverPopover'
import type { AgentToolInfo, WorkspaceCapabilities } from '@kila/shared'
import { toast } from 'sonner'

interface ToolSelectorPopoverProps {
  buttonClassName?: string
  iconClassName?: string
  disabled?: boolean
  readOnlyBuiltinTools?: boolean
}

/** 工具 ID 到图标的映射 */
function getToolIcon(iconName?: string): React.ReactElement {
  switch (iconName) {
    case 'Brain':
      return <Brain className="size-4" />
    case 'Globe':
      return <Globe className="size-4" />
    case 'ImagePlus':
      return <ImagePlus className="size-4" />
    default:
      return <Wrench className="size-4" />
  }
}

export function ToolSelectorPopover({
  buttonClassName,
  iconClassName,
  disabled = false,
  readOnlyBuiltinTools = false,
}: ToolSelectorPopoverProps = {}): React.ReactElement {
  const tools = useAtomValue(agentToolsAtom)
  const setAgentTools = useSetAtom(agentToolsAtom)
  const hasActiveTools = useAtomValue(hasActiveToolsAtom)

  /** 切换工具开关（通过 IPC 更新后端配置，再刷新 atom） */
  const toggleTool = async (toolId: string, currentEnabled: boolean): Promise<void> => {
    try {
      await window.electronAPI.updateAgentToolState(toolId, { enabled: !currentEnabled })
      const updated = await window.electronAPI.getAgentTools()
      setAgentTools(updated)
    } catch (err) {
      console.error('[ToolSelectorPopover] 切换工具失败:', err)
      toast.error('工具状态更新失败', {
        description: err instanceof Error ? err.message : '请重试',
      })
    }
  }

  /** 跳转到设置页工具 tab */
  const goToToolSettings = (): void => {
    void window.electronAPI.openSettingsWindow('mcp')
  }

  return (
    <ToolbarHoverPopover
      disabled={disabled}
      contentClassName="w-64 p-0"
      trigger={({ open, triggerProps }) => (
        <Button
          {...triggerProps}
          type="button"
          variant="ghost"
          size="icon"
          aria-label="工具"
          disabled={disabled}
          className={cn(
            buttonClassName ?? 'size-[30px] rounded-full',
            disabled && 'cursor-not-allowed opacity-45',
            hasActiveTools
              ? 'bg-[hsl(var(--brand-soft))] text-[hsl(var(--brand-soft-foreground))]'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            open && !hasActiveTools && 'bg-muted/50',
          )}
        >
          <Wrench className={cn(iconClassName ?? 'size-5')} />
        </Button>
      )}
    >
      {({ close }) => (
        <ToolSelectorContent
          close={close}
          tools={tools}
          readOnlyBuiltinTools={readOnlyBuiltinTools}
          toggleTool={toggleTool}
          goToToolSettings={goToToolSettings}
        />
      )}
    </ToolbarHoverPopover>
  )
}

interface ToolSelectorContentProps {
  close: () => void
  tools: AgentToolInfo[]
  readOnlyBuiltinTools: boolean
  toggleTool: (toolId: string, currentEnabled: boolean) => Promise<void>
  goToToolSettings: () => void
}

function ToolSelectorContent({
  close,
  tools,
  readOnlyBuiltinTools,
  toggleTool,
  goToToolSettings,
}: ToolSelectorContentProps): React.ReactElement {
  const [capabilities, setCapabilities] = React.useState<WorkspaceCapabilities | null>(null)
  const [capabilitiesLoading, setCapabilitiesLoading] = React.useState(true)
  const [capabilitiesError, setCapabilitiesError] = React.useState<string | null>(null)
  const [retryVersion, setRetryVersion] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    setCapabilitiesLoading(true)
    setCapabilitiesError(null)
    window.electronAPI.getGlobalAgentCapabilities()
      .then((value) => {
        if (!cancelled) {
          setCapabilities(value)
          setCapabilitiesLoading(false)
        }
      })
      .catch((error) => {
        if (cancelled) return
        console.error('[ToolSelectorPopover] 加载会话能力失败:', error)
        setCapabilitiesError(error instanceof Error ? error.message : '能力列表加载失败')
        setCapabilitiesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [retryVersion])

  const enabledMcp = React.useMemo(
    () => capabilities?.mcpServers.filter((server) => server.enabled) ?? [],
    [capabilities],
  )

  return (
    <div className="space-y-3 p-4">
      <section className="space-y-1">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Built-in Tools
        </div>
        {tools.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">加载中...</p>
        ) : (
          <div className="space-y-1">
            {tools.map((tool) => {
              const isEnabled = tool.enabled
              const canToggle = tool.available && !readOnlyBuiltinTools

              return (
                <div
                  key={tool.meta.id}
                  className="flex items-center justify-between rounded-md px-1 py-1.5 hover:bg-muted/50"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={cn('shrink-0', (!tool.available || readOnlyBuiltinTools) && 'opacity-40')}>
                      {getToolIcon(tool.meta.icon)}
                    </span>
                    <span className={cn('truncate text-sm', (!tool.available || readOnlyBuiltinTools) && 'text-muted-foreground')}>
                      {tool.meta.name}
                    </span>
                    {!tool.available && (
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        需配置
                      </span>
                    )}
                  </div>
                  <Switch
                    checked={isEnabled && tool.available}
                    onCheckedChange={() => toggleTool(tool.meta.id, isEnabled)}
                    disabled={!canToggle}
                    className="scale-75"
                  />
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="space-y-2 border-t border-border/50 pt-3">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Enabled MCP
        </div>
        {capabilitiesLoading ? (
          <p role="status" className="text-xs text-muted-foreground">正在加载 MCP…</p>
        ) : capabilitiesError ? (
          <div role="alert" className="space-y-1 text-xs text-destructive">
            <p>{capabilitiesError}</p>
            <button type="button" className="text-primary hover:underline" onClick={() => setRetryVersion((value) => value + 1)}>重试</button>
          </div>
        ) : (
          <CapabilityBadgeList
            items={enabledMcp.map((server) => server.name)}
            emptyText="当前没有启用的 MCP"
          />
        )}
      </section>

      <button
        type="button"
        onClick={() => {
          close()
          goToToolSettings()
        }}
        className="flex w-full items-center gap-1.5 border-t border-border/50 pt-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Settings className="size-3" />
        <span>管理工具</span>
      </button>
    </div>
  )
}

function CapabilityBadgeList({
  items,
  emptyText,
}: {
  items: string[]
  emptyText: string
}): React.ReactElement {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyText}</p>
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-full bg-muted px-2 py-1 text-[11px] text-foreground/80"
        >
          {item}
        </span>
      ))}
    </div>
  )
}
