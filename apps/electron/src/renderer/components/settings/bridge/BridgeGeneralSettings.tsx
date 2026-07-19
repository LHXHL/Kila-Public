import * as React from 'react'
import type { BridgeChannelType, BridgeConfig, BridgeConnectionStatus, BridgeStatus } from '@kila/shared'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { SettingsCard } from '../primitives/SettingsCard'
import { SettingsRow } from '../primitives/SettingsRow'
import { SettingsSection } from '../primitives/SettingsSection'
import { BridgeDefaultModelField } from './BridgeDefaultModelField'

const CHANNEL_LABELS: Record<BridgeChannelType, string> = {
  telegram: 'Telegram',
  discord: 'Discord',
  feishu: '飞书',
  wechat: '微信',
}

const STATUS_LABELS: Record<BridgeConnectionStatus, string> = {
  disconnected: '未连接',
  connecting: '连接中',
  connected: '已连接',
  error: '连接错误',
  waiting_scan: '等待扫码',
  scanned: '已扫码',
  token_expired: '凭证过期',
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return '从未连接'
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatRetry(timestamp?: number, attempt?: number): string | null {
  if (!timestamp || !attempt) return null
  const seconds = Math.max(0, Math.ceil((timestamp - Date.now()) / 1000))
  return `第 ${attempt} 次重试将在 ${seconds} 秒后进行`
}

export function BridgeGeneralSettings({
  config,
  status,
  onChange,
  onSave,
  saving,
}: {
  config: BridgeConfig
  status: BridgeStatus
  onChange: (config: BridgeConfig) => void
  onSave: (config: BridgeConfig) => Promise<void>
  saving: boolean
}): React.ReactElement {
  const [restarting, setRestarting] = React.useState(false)

  const restartBridge = React.useCallback(async (): Promise<void> => {
    setRestarting(true)
    try {
      await window.electronAPI.restartBridge()
    } finally {
      setRestarting(false)
    }
  }, [])

  return (
    <SettingsSection
      title="总览"
      description="全局开关、默认会话参数和当前运行状态。"
      action={(
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => { void restartBridge() }} disabled={restarting || saving}>
            {restarting ? '重启中...' : '立即恢复'}
          </Button>
          <Button onClick={() => void onSave(config)} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </div>
      )}
    >
      <SettingsCard>
        <SettingsRow
          label="启用远程渠道"
          description="关闭后不会启动任何远程消息渠道。"
        >
          <Switch
            checked={config.enabled}
            onCheckedChange={(checked) => onChange({ ...config, enabled: checked })}
          />
        </SettingsRow>
        <SettingsRow
          label="自动启动"
          description="应用启动后按配置自动拉起 Telegram、Discord、飞书、微信连接。"
        >
          <Switch
            checked={config.autoStart}
            onCheckedChange={(checked) => onChange({ ...config, autoStart: checked })}
          />
        </SettingsRow>
        <SettingsRow
          label="运行状态"
          description={`${status.running ? '运行中' : '未运行'} · 绑定数 ${status.activeBindings}`}
        />
      </SettingsCard>

      {status.lifecycle && status.lifecycle.length > 0 && (
        <SettingsCard divided={false}>
          <div className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">连接生命周期</div>
                <div className="mt-0.5 text-xs text-muted-foreground">启动条件、凭据状态和最近连接状态。</div>
              </div>
              <span className="rounded-full border border-border/60 bg-muted/35 px-2.5 py-1 text-[11px] text-muted-foreground">
                {status.lifecycle.filter((item) => item.healthy).length}/{status.lifecycle.length} 正常
              </span>
            </div>
            <div className="overflow-hidden rounded-xl border border-border/55">
              {status.lifecycle.map((item) => (
                <div key={item.channel} className="grid grid-cols-[minmax(92px,1fr)_92px_92px_minmax(116px,1fr)] items-center gap-3 border-b border-border/45 px-3 py-2.5 text-xs last:border-b-0">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground">{CHANNEL_LABELS[item.channel]}</div>
                    {item.errorMessage && (
                      <div className="mt-0.5 truncate text-[11px] text-destructive">{item.errorMessage}</div>
                    )}
                    {formatRetry(item.nextRetryAt, item.retryAttempt) && (
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {formatRetry(item.nextRetryAt, item.retryAttempt)}
                      </div>
                    )}
                  </div>
                  <span className={cn(
                    'rounded-full px-2 py-1 text-center text-[11px]',
                    item.enabled ? 'bg-[hsl(var(--status-success-soft))] text-[hsl(var(--status-success-foreground))]' : 'bg-muted/55 text-muted-foreground',
                  )}>
                    {item.enabled ? '已启用' : '未启用'}
                  </span>
                  <span className={cn(
                    'rounded-full px-2 py-1 text-center text-[11px]',
                    item.configured ? 'bg-muted/45 text-foreground/75' : 'bg-destructive/10 text-destructive',
                  )}>
                    {item.configured ? '已配置' : '缺少配置'}
                  </span>
                  <div className="min-w-0 text-right text-muted-foreground">
                    <div className={cn('truncate', item.status === 'error' && 'text-destructive', item.status === 'connected' && 'text-[hsl(var(--status-success-foreground))]')}>
                      {STATUS_LABELS[item.status]}
                    </div>
                    <div className="mt-0.5 truncate text-[11px]">{formatTime(item.lastConnectedAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SettingsCard>
      )}

      <SettingsCard divided={false}>
        <BridgeDefaultModelField
          label="默认回退模型"
          description="远程渠道默认回退模型。各渠道未单独配置时使用这里；若这里也没配，则继续回退到全局智能体默认模型。"
          value={config.defaultSession}
          onChange={(value) => onChange({
            ...config,
            defaultSession: {
              ...config.defaultSession,
              ...value,
            },
          })}
        />
      </SettingsCard>
    </SettingsSection>
  )
}
