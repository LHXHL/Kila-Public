/**
 * BuiltinToolSettings - 内置工具配置区域
 *
 * 全局内置工具现在收口到 MCP 设置页：
 * - 联网搜索
 * - 自定义 HTTP 工具
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { ExternalLink, Eye, EyeOff, Loader2, CheckCircle2, XCircle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { SettingsCard, SettingsSection } from './primitives'
import { agentToolsAtom } from '@/atoms/agent-tool-atoms'

async function refreshAgentTools(
  setter: (tools: Awaited<ReturnType<typeof window.electronAPI.getAgentTools>>) => void,
): Promise<void> {
  try {
    const tools = await window.electronAPI.getAgentTools()
    setter(tools)
  } catch (error) {
    console.error('[BuiltinToolSettings] 刷新工具列表失败:', error)
  }
}

function WebSearchSettings(): React.ReactElement {
  const [apiKey, setApiKey] = React.useState('')
  const [showApiKey, setShowApiKey] = React.useState(false)
  const [enabled, setEnabled] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<{ success: boolean; message: string } | null>(null)
  const setAgentTools = useSetAtom(agentToolsAtom)
  const savedApiKeyRef = React.useRef('')

  React.useEffect(() => {
    Promise.all([
      window.electronAPI.getAgentTools(),
      window.electronAPI.getAgentToolCredentials('web-search'),
    ]).then(([tools, credentials]) => {
      const searchTool = tools.find((tool) => tool.meta.id === 'web-search')
      if (searchTool) {
        setEnabled(searchTool.enabled)
      }
      if (credentials.apiKey) {
        setApiKey(credentials.apiKey)
        savedApiKeyRef.current = credentials.apiKey
      }
    }).catch((error: unknown) => {
      console.error('[联网搜索设置] 加载失败:', error)
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const handleBlurSave = React.useCallback(async (): Promise<void> => {
    const trimmed = apiKey.trim()
    if (trimmed === savedApiKeyRef.current) return

    try {
      await window.electronAPI.updateAgentToolCredentials('web-search', { apiKey: trimmed })
      savedApiKeyRef.current = trimmed
      await refreshAgentTools(setAgentTools)
      toast.success('联网搜索设置已保存')
    } catch (error) {
      console.error('[联网搜索设置] 保存失败:', error)
    }
  }, [apiKey, setAgentTools])

  const handleToggle = async (checked: boolean): Promise<void> => {
    try {
      await window.electronAPI.updateAgentToolState('web-search', { enabled: checked })
      setEnabled(checked)
      await refreshAgentTools(setAgentTools)
    } catch (error) {
      console.error('[联网搜索设置] 切换失败:', error)
    }
  }

  const handleTest = async (): Promise<void> => {
    const trimmed = apiKey.trim()
    if (trimmed !== savedApiKeyRef.current) {
      try {
        await window.electronAPI.updateAgentToolCredentials('web-search', { apiKey: trimmed })
        savedApiKeyRef.current = trimmed
        await refreshAgentTools(setAgentTools)
      } catch (error) {
        console.error('[联网搜索设置] 保存失败:', error)
      }
    }

    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.electronAPI.testAgentTool('web-search')
      setTestResult(result)
    } catch (error) {
      setTestResult({ success: false, message: error instanceof Error ? error.message : String(error) })
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>
  }

  return (
    <SettingsSection
      title="联网搜索"
      description="启用后 AI 可以实时搜索互联网获取最新信息"
      action={<Switch checked={enabled} onCheckedChange={handleToggle} />}
    >
      <SettingsCard divided={false}>
        <div className="space-y-4 p-4">
          <div className="space-y-2 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
            <p>联网搜索由 <span className="font-medium text-foreground">Tavily</span> 提供，启用后 AI 可以搜索互联网获取实时信息。</p>
            <p className="text-xs">配置步骤：</p>
            <ol className="list-inside list-decimal space-y-1 text-xs">
              <li>
                访问{' '}
                <a
                  href="https://tavily.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                  Tavily 官网
                  <ExternalLink size={10} />
                </a>
                {' '}注册账号
              </li>
              <li>在控制台获取 API Key（免费额度每月 1000 次搜索）</li>
              <li>将 API Key 填入下方，然后开启开关</li>
            </ol>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">API Key</label>
              <Button size="sm" variant="outline" disabled={testing || !apiKey.trim()} onClick={handleTest}>
                {testing ? <><Loader2 size={14} className="mr-1.5 animate-spin" />测试中...</> : '测试连接'}
              </Button>
            </div>
            <div className="relative">
              <Input
                type={showApiKey ? 'text' : 'password'}
                placeholder="tvly-..."
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                onBlur={handleBlurSave}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-colors hover:text-foreground"
                tabIndex={-1}
              >
                {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {testResult && (
            <div className={`flex items-start gap-2 rounded-lg p-3 text-sm ${testResult.success ? 'bg-status-success-soft text-status-success-foreground' : 'bg-destructive/10 text-destructive'}`}>
              {testResult.success ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />}
              <span>{testResult.message}</span>
            </div>
          )}
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}

function CustomToolsSection(): React.ReactElement | null {
  const tools = useAtomValue(agentToolsAtom)
  const setAgentTools = useSetAtom(agentToolsAtom)

  const customTools = tools.filter((tool) => tool.meta.category === 'custom')
  if (customTools.length === 0) return null

  const handleToggle = async (toolId: string, checked: boolean): Promise<void> => {
    try {
      await window.electronAPI.updateAgentToolState(toolId, { enabled: checked })
      await refreshAgentTools(setAgentTools)
    } catch (error) {
      console.error('[自定义工具] 切换失败:', error)
    }
  }

  const handleDelete = async (toolId: string, toolName: string): Promise<void> => {
    try {
      await window.electronAPI.deleteCustomAgentTool(toolId)
      await refreshAgentTools(setAgentTools)
      toast.success(`已删除工具: ${toolName}`)
    } catch (error) {
      console.error('[自定义工具] 删除失败:', error)
      toast.error('删除工具失败')
    }
  }

  return (
    <SettingsSection
      title="自定义工具"
      description="通过 Agent 模式创建的 HTTP API 工具"
    >
      <SettingsCard divided>
        {customTools.map((tool) => (
          <div key={tool.meta.id} className="flex items-center justify-between p-4">
            <div className="mr-4 min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{tool.meta.name}</span>
                {tool.meta.httpConfig && (
                  <span className="font-mono text-xs text-muted-foreground">
                    {tool.meta.httpConfig.method}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {tool.meta.description}
              </p>
              {tool.meta.httpConfig && (
                <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground/60">
                  {tool.meta.httpConfig.urlTemplate}
                </p>
              )}
            </div>
            <div className="shrink-0 flex items-center gap-2">
              <Switch
                checked={tool.enabled}
                onCheckedChange={(checked) => handleToggle(tool.meta.id, checked)}
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={() => handleDelete(tool.meta.id, tool.meta.name)}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
        ))}
      </SettingsCard>
    </SettingsSection>
  )
}

export function BuiltinToolSettings(): React.ReactElement {
  return (
    <div className="space-y-8">
      <SettingsSection
        title="内置工具"
        description="Kila 的全局工具能力也收口到这里统一配置，不再保留单独的 tools 菜单。"
      >
        <SettingsCard divided={false} className="p-4 text-sm text-muted-foreground">
          <div className="space-y-2">
            <p>- Built-in tools 与 MCP 一样都是全局能力，不再挂在单独设置页</p>
            <p>- 工具开关影响输入区的可用工具与 Agent runtime 注入</p>
            <p>- 自定义 HTTP 工具也在这里统一管理</p>
          </div>
        </SettingsCard>
      </SettingsSection>

      <WebSearchSettings />
      <CustomToolsSection />
    </div>
  )
}
