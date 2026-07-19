import * as React from 'react'
import { useSetAtom } from 'jotai'
import { FolderOpen, Pencil, Plug, ShieldCheck, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { workspaceCapabilitiesVersionAtom } from '@/atoms/agent-atoms'
import type { McpServerEntry, WorkspaceMcpConfig } from '@kila/shared'
import { SettingsCard, SettingsSection } from './primitives'
import { McpServerForm } from './McpServerForm'
import { BuiltinToolSettings } from './BuiltinToolSettings'
import { EntityMetadataChip } from '@/components/ui/entity-metadata-chip'
import { WorkspaceEntityRow } from '@/components/ui/workspace-entity-row'

type ViewMode = 'list' | 'create' | 'edit'

interface EditingServer {
  name: string
  entry: McpServerEntry
}

const TRANSPORT_LABELS: Record<string, string> = {
  stdio: 'stdio',
  http: 'HTTP',
  sse: 'SSE',
}

export function GlobalMcpSettings(): React.ReactElement {
  const bumpCapabilitiesVersion = useSetAtom(workspaceCapabilitiesVersionAtom)

  const [viewMode, setViewMode] = React.useState<ViewMode>('list')
  const [editingServer, setEditingServer] = React.useState<EditingServer | null>(null)
  const [mcpConfig, setMcpConfig] = React.useState<WorkspaceMcpConfig>({ servers: {} })
  const [mcpPath, setMcpPath] = React.useState('')
  const [loading, setLoading] = React.useState(true)

  const loadData = React.useCallback(async () => {
    setLoading(true)
    try {
      const [config, path] = await Promise.all([
        window.electronAPI.getGlobalAgentMcpConfig(),
        window.electronAPI.getGlobalAgentMcpPath(),
      ])
      setMcpConfig(config)
      setMcpPath(path)
    } catch (error) {
      console.error('[全局 MCP 设置] 加载失败:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadData()
  }, [loadData])

  const handleDelete = async (serverName: string): Promise<void> => {
    const entry = mcpConfig.servers[serverName]
    if (entry?.isBuiltin) return
    if (!confirm(`确定删除 MCP 服务器「${serverName}」？此操作不可恢复。`)) return

    try {
      const newServers = { ...mcpConfig.servers }
      delete newServers[serverName]
      const newConfig: WorkspaceMcpConfig = { servers: newServers }
      await window.electronAPI.saveGlobalAgentMcpConfig(newConfig)
      setMcpConfig(newConfig)
      bumpCapabilitiesVersion((v) => v + 1)
    } catch (error) {
      console.error('[全局 MCP 设置] 删除失败:', error)
    }
  }

  const handleToggle = async (serverName: string): Promise<void> => {
    try {
      const entry = mcpConfig.servers[serverName]
      if (!entry) return

      const newConfig: WorkspaceMcpConfig = {
        servers: {
          ...mcpConfig.servers,
          [serverName]: { ...entry, enabled: !entry.enabled },
        },
      }
      await window.electronAPI.saveGlobalAgentMcpConfig(newConfig)
      setMcpConfig(newConfig)
      bumpCapabilitiesVersion((v) => v + 1)
    } catch (error) {
      console.error('[全局 MCP 设置] 切换状态失败:', error)
    }
  }

  const handleFormSaved = (): void => {
    setViewMode('list')
    setEditingServer(null)
    void loadData()
    bumpCapabilitiesVersion((v) => v + 1)
  }

  const handleFormCancel = (): void => {
    setViewMode('list')
    setEditingServer(null)
  }

  if (viewMode === 'create' || viewMode === 'edit') {
    return (
      <McpServerForm
        server={editingServer}
        onSaved={handleFormSaved}
        onCancel={handleFormCancel}
      />
    )
  }

  const serverEntries = Object.entries(mcpConfig.servers ?? {})

  return (
    <div className="space-y-8">
      <SettingsSection
        title="MCP 服务器"
        description="全局 MCP 配置，所有会话共享同一套服务器能力"
        action={
          <div className="flex items-center gap-2">
            {mcpPath && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => window.electronAPI.openGlobalAgentPath(mcpPath)}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  >
                    <FolderOpen size={16} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>打开 mcp.json</TooltipContent>
              </Tooltip>
            )}
            <Button size="sm" onClick={() => setViewMode('create')}>
              <Plug size={16} />
              <span>添加服务器</span>
            </Button>
          </div>
        }
      >
        {loading ? (
          <div className="text-sm text-muted-foreground py-8 text-center">加载中...</div>
        ) : serverEntries.length === 0 ? (
          <SettingsCard divided={false}>
            <div className="text-sm text-muted-foreground py-12 text-center">
              还没有配置任何全局 MCP 服务器
            </div>
          </SettingsCard>
        ) : (
          <SettingsCard>
            {serverEntries.map(([name, entry]) => (
              <McpServerRow
                key={name}
                name={name}
                entry={entry}
                onEdit={() => {
                  setEditingServer({ name, entry })
                  setViewMode('edit')
                }}
                onDelete={() => { void handleDelete(name) }}
                onToggle={() => { void handleToggle(name) }}
              />
            ))}
          </SettingsCard>
        )}

      </SettingsSection>

      <BuiltinToolSettings />
    </div>
  )
}

interface McpServerRowProps {
  name: string
  entry: McpServerEntry
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
}

function McpServerRow({ name, entry, onEdit, onDelete, onToggle }: McpServerRowProps): React.ReactElement {
  const isBuiltin = entry.isBuiltin === true

  return (
    <WorkspaceEntityRow
      icon={<Plug size={16} />}
      title={name}
      description={entry.type === 'stdio' ? entry.command : entry.url}
      metadata={(
        <>
          {isBuiltin && (
            <EntityMetadataChip tone="accent">
              <ShieldCheck size={12} />
              内置
            </EntityMetadataChip>
          )}
          <EntityMetadataChip>{TRANSPORT_LABELS[entry.type] ?? entry.type}</EntityMetadataChip>
          <EntityMetadataChip tone={entry.enabled ? 'accent' : 'neutral'}>
            {entry.enabled ? 'Enabled' : 'Disabled'}
          </EntityMetadataChip>
        </>
      )}
      actions={(
        <>
        <button
          onClick={onEdit}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          title="编辑"
        >
          <Pencil size={14} />
        </button>
        {!isBuiltin && (
          <button
            onClick={onDelete}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            title="删除"
          >
            <Trash2 size={14} />
          </button>
        )}
        <Switch checked={entry.enabled} onCheckedChange={onToggle} />
        </>
      )}
    />
  )
}
