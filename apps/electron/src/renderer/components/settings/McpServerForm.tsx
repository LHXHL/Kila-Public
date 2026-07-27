/**
 * McpServerForm - MCP 服务器创建/编辑表单
 *
 * 支持 stdio / http / sse 三种传输类型，
 * 复用设置原语组件实现卡片化布局。
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Loader2, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { McpServerEntry, McpTransportType, WorkspaceMcpConfig } from '@kila/shared'
import {
  SettingsSection,
  SettingsCard,
  SettingsInput,
  SettingsSelect,
  SettingsToggle,
} from './primitives'

/** 编辑中的服务器 */
interface EditingServer {
  name: string
  entry: McpServerEntry
}

interface McpServerFormProps {
  /** 编辑模式传入已有服务器，创建模式传 null */
  server: EditingServer | null
  onSaved: () => void
  onCancel: () => void
}

/**
 * 解析多行文本为 key=value / key: value 的 Record
 *
 * 支持：
 * - KEY=VALUE（环境变量格式）
 * - Key: Value（HTTP 头格式）
 */
function parseKeyValueText(text: string, separator: '=' | ':'): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const idx = trimmed.indexOf(separator)
    if (idx <= 0) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim()
    if (key) result[key] = value
  }
  return result
}

/**
 * 将 Record 序列化为多行 key=value / key: value 文本
 */
function serializeKeyValueText(record: Record<string, string> | undefined, separator: '=' | ':'): string {
  if (!record) return ''
  return Object.entries(record)
    .map(([key, value]) => `${key}${separator}${separator === ':' ? ' ' : ''}${value}`)
    .join('\n')
}

export function McpServerForm({ server, onSaved, onCancel }: McpServerFormProps): React.ReactElement {
  const { t } = useTranslation()
  const isEdit = server !== null
  const isBuiltin = server?.entry.isBuiltin === true

  // 表单状态
  const [name, setName] = React.useState(server?.name ?? '')
  const [transportType, setTransportType] = React.useState<McpTransportType>(server?.entry.type ?? 'stdio')
  const [enabled, setEnabled] = React.useState(server?.entry.enabled ?? false) // 默认关闭

  // stdio 字段
  const [command, setCommand] = React.useState(server?.entry.command ?? '')
  const [argsText, setArgsText] = React.useState(server?.entry.args?.join(', ') ?? '')
  const [envText, setEnvText] = React.useState(serializeKeyValueText(server?.entry.env, '='))
  const [timeoutStr, setTimeoutStr] = React.useState(
    server?.entry.timeout != null ? String(server.entry.timeout) : ''
  )

  // http/sse 字段
  const [url, setUrl] = React.useState(server?.entry.url ?? '')
  const [headersText, setHeadersText] = React.useState(serializeKeyValueText(server?.entry.headers, ':'))

  /** 传输类型选项（label 需随语言切换） */
  const transportOptions = React.useMemo(() => [
    { value: 'stdio', label: t('settings.mcpForm.transportStdio') },
    { value: 'http', label: t('settings.mcpForm.transportHttp') },
    { value: 'sse', label: t('settings.mcpForm.transportSse') },
  ], [t])

  // UI 状态
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<{ success: boolean; message: string } | null>(
    server?.entry.lastTestResult ?? null
  )

  // 监听配置改变，清空测试结果（避免使用过期的测试结果）
  React.useEffect(() => {
    if (!server) return // 新建时不需要清空

    // 检查关键配置是否改变（包括连接相关的所有字段）
    const configChanged =
      transportType !== server.entry.type ||
      (transportType === 'stdio' && command !== server.entry.command) ||
      (transportType !== 'stdio' && url !== server.entry.url) ||
      argsText !== (server.entry.args?.join(', ') ?? '') ||
      envText !== serializeKeyValueText(server.entry.env, '=') ||
      headersText !== serializeKeyValueText(server.entry.headers, ':')

    if (configChanged) {
      setTestResult(null)
      setEnabled(false) // 配置改变时自动关闭开关
    }
  }, [transportType, command, url, argsText, envText, headersText, server])

  /** 构建 McpServerEntry */
  const buildEntry = (includeTestResult = false): McpServerEntry => {
    const base: McpServerEntry = {
      type: transportType,
      // 关键保护：只有测试成功才能启用
      enabled: enabled && testResult?.success === true,
      // 保留内置标记
      ...(isBuiltin && { isBuiltin: true }),
      // 保存测试结果
      ...(includeTestResult && testResult && {
        lastTestResult: {
          ...testResult,
          timestamp: Date.now(),
        },
      }),
    }

    if (transportType === 'stdio') {
      base.command = command.trim()
      const args = argsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (args.length > 0) base.args = args
      const env = parseKeyValueText(envText, '=')
      if (Object.keys(env).length > 0) base.env = env
      const timeout = parseInt(timeoutStr, 10)
      if (!isNaN(timeout) && timeout > 0) base.timeout = timeout
    } else {
      base.url = url.trim()
      const headers = parseKeyValueText(headersText, ':')
      if (Object.keys(headers).length > 0) base.headers = headers
    }

    return base
  }

  /** 测试连接 */
  const handleTest = async (): Promise<void> => {
    const serverName = name.trim()
    if (!serverName) return

    // stdio 需要 command，http/sse 需要 url
    if (transportType === 'stdio' && !command.trim()) return
    if (transportType !== 'stdio' && !url.trim()) return

    setTesting(true)
    setTestResult(null)

    try {
      const entry = buildEntry(false) // 测试时不包含旧的测试结果
      const result = await window.electronAPI.testMcpServer(serverName, entry)
      setTestResult({
        success: result.success,
        message: result.message,
      })
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : t('settings.mcpForm.testFailed'),
      })
    } finally {
      setTesting(false)
    }
  }

  /** 提交表单 */
  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()

    const serverName = name.trim()
    if (!serverName) return

    // stdio 需要 command，http/sse 需要 url
    if (transportType === 'stdio' && !command.trim()) return
    if (transportType !== 'stdio' && !url.trim()) return

    // 警告：如果用户试图启用但测试未成功
    if (enabled && !testResult?.success) {
      console.warn('[MCP 表单] 用户试图启用未测试成功的 MCP，将强制禁用')
    }

    setSaving(true)
    try {
      const config = await window.electronAPI.getGlobalAgentMcpConfig()
      const entry = buildEntry(true) // 保存时包含测试结果

      // 日志记录实际保存的状态
      console.log(`[MCP 表单] 保存 MCP: ${serverName}, enabled: ${entry.enabled}, testResult: ${testResult?.success}`)

      const newConfig: WorkspaceMcpConfig = {
        servers: {
          ...config.servers,
          [serverName]: entry,
        },
      }
      await window.electronAPI.saveGlobalAgentMcpConfig(newConfig)
      onSaved()
    } catch (error) {
      console.error('[MCP 表单] 保存失败:', error)
    } finally {
      setSaving(false)
    }
  }

  /** 判断表单是否可提交 */
  const canSubmit = (): boolean => {
    if (!name.trim()) return false
    if (transportType === 'stdio' && !command.trim()) return false
    if (transportType !== 'stdio' && !url.trim()) return false
    return true
  }

  /** 判断是否可以测试 */
  const canTest = (): boolean => {
    return canSubmit()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 标题栏 + 操作按钮 */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" type="button" onClick={onCancel}>
          <ArrowLeft size={18} />
        </Button>
        <h3 className="text-lg font-medium text-foreground flex-1">
          {isEdit ? t('settings.mcpForm.editTitle') : t('settings.mcpForm.createTitle')}
        </h3>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" type="submit" disabled={saving || !canSubmit()}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            <span>{isEdit ? t('settings.mcpForm.saveChanges') : t('settings.mcpForm.createServer')}</span>
          </Button>
        </div>
      </div>

      {/* 基本信息 */}
      <SettingsSection title={t('settings.mcpForm.basicInfo')}>
        <SettingsCard>
          {/* 内置 MCP 引导提示 */}
          {isBuiltin && (
            <div className="mx-4 mt-3 rounded-md bg-accent px-4 py-3 text-sm text-foreground/80">
              <div className="font-medium">{t('settings.mcpForm.builtinTitle')}</div>
              <div className="text-xs mt-1 opacity-90">
                {t('settings.mcpForm.builtinHint')}
              </div>
            </div>
          )}
          <SettingsInput
            label={t('settings.mcpForm.serverName')}
            value={name}
            onChange={setName}
            placeholder={t('settings.mcpForm.serverNamePlaceholder')}
            required
            disabled={isEdit}
          />
          <SettingsSelect
            label={t('settings.mcpForm.transportType')}
            value={transportType}
            onValueChange={(v) => setTransportType(v as McpTransportType)}
            options={transportOptions}
            placeholder={t('settings.mcpForm.transportPlaceholder')}
            disabled={isBuiltin}
          />

          {/* stdio 专用字段 */}
          {transportType === 'stdio' && (
            <>
              <SettingsInput
                label={t('settings.mcpForm.command')}
                value={command}
                onChange={setCommand}
                placeholder={t('settings.mcpForm.commandPlaceholder')}
                required
                disabled={isBuiltin}
              />
              <SettingsInput
                label={t('settings.mcpForm.args')}
                value={argsText}
                onChange={setArgsText}
                placeholder={t('settings.mcpForm.argsPlaceholder')}
                description={t('settings.mcpForm.argsHint')}
                disabled={isBuiltin}
              />
              {/* 环境变量多行输入 */}
              <div className="px-4 py-3 space-y-2">
                <div>
                  <div className="text-sm font-medium text-foreground">{t('settings.mcpForm.env')}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{t('settings.mcpForm.envHint')}</div>
                </div>
                <textarea
                  value={envText}
                  onChange={(e) => setEnvText(e.target.value)}
                  placeholder="GITHUB_TOKEN=ghp_xxx&#10;DEBUG=true"
                  rows={3}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y font-mono"
                />
              </div>
              <SettingsInput
                label={t('settings.mcpForm.timeout')}
                description={t('settings.mcpForm.timeoutHint')}
                value={timeoutStr}
                onChange={setTimeoutStr}
                placeholder="30"
                type="number"
              />
            </>
          )}

          {/* http/sse 专用字段 */}
          {transportType !== 'stdio' && (
            <>
              <SettingsInput
                label="URL"
                value={url}
                onChange={setUrl}
                placeholder={t('settings.mcpForm.urlPlaceholder')}
                required
              />
              {/* 请求头多行输入 */}
              <div className="px-4 py-3 space-y-2">
                <div>
                  <div className="text-sm font-medium text-foreground">{t('settings.mcpForm.headers')}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{t('settings.mcpForm.headersHint')}</div>
                </div>
                <textarea
                  value={headersText}
                  onChange={(e) => setHeadersText(e.target.value)}
                  placeholder="Authorization: Bearer xxx&#10;X-Custom-Header: value"
                  rows={3}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y font-mono"
                />
              </div>
            </>
          )}

          {/* 测试连接区域 */}
          <div className="px-4 py-3 space-y-3 border-t border-border">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">{t('settings.mcpForm.connectionTest')}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {t('settings.mcpForm.connectionTestHint')}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={testing || !canTest()}
              >
                {testing && <Loader2 size={14} className="animate-spin" />}
                <span>{testing ? t('settings.builtinTools.webSearch.testing') : t('settings.builtinTools.webSearch.testConnection')}</span>
              </Button>
            </div>

            {/* 测试结果显示 */}
            {testResult && (
              <div
                className={cn(
                  'flex items-start gap-2 px-3 py-2 rounded-md text-sm',
                  testResult.success
                    ? 'bg-status-success-soft text-status-success-foreground'
                    : 'bg-status-danger-soft text-status-danger-foreground'
                )}
              >
                {testResult.success ? (
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                ) : (
                  <XCircle size={16} className="mt-0.5 shrink-0" />
                )}
                <div className="flex-1">
                  <div className="font-medium">
                    {testResult.success ? t('settings.mcpForm.testSucceeded') : t('settings.mcpForm.testFailed')}
                  </div>
                  <div className="text-xs mt-0.5 opacity-90">{testResult.message}</div>
                </div>
              </div>
            )}

            {/* 未测试警告 */}
            {!testResult && !testing && (
              <div className="flex items-start gap-2 rounded-md bg-status-warning-soft px-3 py-2 text-sm text-status-warning-foreground">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <div className="text-xs">
                  {t('settings.mcpForm.notTestedWarning')}
                </div>
              </div>
            )}
          </div>

          {/* 启用开关 */}
          <SettingsToggle
            label={t('settings.mcpForm.enableServer')}
            description={
              testResult?.success
                ? t('settings.mcpForm.enableServerHint')
                : t('settings.mcpForm.connectionTestHint')
            }
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!testResult?.success}
          />
        </SettingsCard>
      </SettingsSection>
    </form>
  )
}
