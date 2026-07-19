import * as React from 'react'
import type {
  BridgeConfig,
  WeChatBridgeAccountEntry,
  WeChatBridgeAccountStatus,
  WeChatBridgeLoginState,
} from '@kila/shared'
import { ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { SettingsCard } from '../primitives/SettingsCard'
import { SettingsInput } from '../primitives/SettingsInput'
import { SettingsRow } from '../primitives/SettingsRow'
import { SettingsSection } from '../primitives/SettingsSection'
import { BridgeDefaultModelField } from './BridgeDefaultModelField'

interface WeChatBridgeSettingsProps {
  config: BridgeConfig
  accounts: WeChatBridgeAccountEntry[]
  loginStates: Record<string, WeChatBridgeLoginState>
  accountStatuses: Record<string, WeChatBridgeAccountStatus>
  onChange: (config: BridgeConfig) => void
  onSave: (config: BridgeConfig) => Promise<void>
  onRefresh: () => Promise<void>
  saving: boolean
}

function statusLabel(status?: WeChatBridgeAccountStatus): string {
  if (!status) return '未启动'
  const label = status.status === 'connected'
    ? '已连接'
    : status.status === 'connecting'
      ? '连接中'
      : status.status === 'waiting_scan'
        ? '等待扫码'
        : status.status === 'scanned'
          ? '已扫码'
          : status.status === 'error'
            ? '连接错误'
            : status.status === 'token_expired'
              ? '凭证过期'
              : '未连接'
  if (status.errorMessage) return `${label} · ${status.errorMessage}`
  return label
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function renderQr(state: WeChatBridgeLoginState | null): React.ReactNode {
  if (!state) return null
  if (!state.qrCodeDataUrl) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
        {state.message || state.errorMessage || `登录状态：${state.status}`}
      </div>
    )
  }

  if (state.qrCodeDataUrl.startsWith('data:image') || state.qrCodeDataUrl.startsWith('http')) {
    return (
      <img
        className="size-44 rounded-2xl border border-border bg-background object-contain p-3"
        src={state.qrCodeDataUrl}
        alt="微信登录二维码"
      />
    )
  }

  return (
    <div className="rounded-2xl border border-dashed border-border px-4 py-6 font-mono text-xs text-muted-foreground">
      {state.qrCodeDataUrl}
    </div>
  )
}

function GuideStep({ index, title, children }: { index: number; title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="grid gap-2 sm:grid-cols-[28px_minmax(0,1fr)]">
      <div className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{index}</div>
      <div>
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="mt-1 text-sm leading-6 text-muted-foreground">{children}</div>
      </div>
    </div>
  )
}

export function WeChatBridgeSettings({
  config,
  accounts,
  loginStates,
  accountStatuses,
  onChange,
  onSave,
  onRefresh,
  saving,
}: WeChatBridgeSettingsProps): React.ReactElement {
  const [selectedAccountId, setSelectedAccountId] = React.useState<string | null>(accounts[0]?.accountId ?? null)
  const [loginLabel, setLoginLabel] = React.useState('')
  const [activeLoginId, setActiveLoginId] = React.useState<string | null>(null)
  const selectedAccount = accounts.find((account) => account.accountId === selectedAccountId) ?? accounts[0] ?? null
  const activeLoginState = activeLoginId ? loginStates[activeLoginId] ?? null : null

  React.useEffect(() => {
    if (!selectedAccountId && accounts[0]?.accountId) {
      setSelectedAccountId(accounts[0].accountId)
    }
  }, [accounts, selectedAccountId])

  const startLogin = React.useCallback(async () => {
    try {
      const state = await window.electronAPI.startWeChatBridgeLogin({
        label: loginLabel.trim() || undefined,
      })
      setActiveLoginId(state.accountId)
      toast.success('微信登录二维码已创建', {
        description: '请使用微信扫描二维码完成登录。',
      })
    } catch (error) {
      toast.error('创建微信登录二维码失败', {
        description: getErrorMessage(error),
      })
    }
  }, [loginLabel])

  const refreshLogin = React.useCallback(async () => {
    if (!activeLoginId) return
    try {
      const state = await window.electronAPI.refreshWeChatBridgeLogin(activeLoginId)
      if (state.status === 'confirmed') {
        setActiveLoginId(null)
        setLoginLabel('')
        await onRefresh()
        toast.success('微信账号已登录')
      } else if (state.status === 'expired') {
        setActiveLoginId(null)
        toast.error('微信登录二维码已过期')
      } else if (state.status === 'error') {
        setActiveLoginId(null)
        toast.error('微信登录失败', {
          description: state.errorMessage || state.message,
        })
      }
    } catch (error) {
      toast.error('刷新微信登录状态失败', {
        description: getErrorMessage(error),
      })
    }
  }, [activeLoginId, onRefresh])

  const cancelLogin = React.useCallback(async () => {
    if (!activeLoginId) return
    try {
      await window.electronAPI.cancelWeChatBridgeLogin(activeLoginId)
      setActiveLoginId(null)
      toast.success('已取消微信登录')
    } catch (error) {
      toast.error('取消微信登录失败', {
        description: getErrorMessage(error),
      })
    }
  }, [activeLoginId])

  const startSelectedAccount = React.useCallback(async (): Promise<void> => {
    if (!selectedAccount) return
    try {
      await window.electronAPI.startWeChatBridgeAccount(selectedAccount.accountId)
      await onRefresh()
      toast.success('微信账号已启动', {
        description: selectedAccount.label,
      })
    } catch (error) {
      toast.error('启动微信账号失败', {
        description: getErrorMessage(error),
      })
    }
  }, [onRefresh, selectedAccount])

  const stopSelectedAccount = React.useCallback(async (): Promise<void> => {
    if (!selectedAccount) return
    try {
      await window.electronAPI.stopWeChatBridgeAccount(selectedAccount.accountId)
      await onRefresh()
      toast.success('微信账号已停止', {
        description: selectedAccount.label,
      })
    } catch (error) {
      toast.error('停止微信账号失败', {
        description: getErrorMessage(error),
      })
    }
  }, [onRefresh, selectedAccount])

  const reloginSelectedAccount = React.useCallback(async (): Promise<void> => {
    if (!selectedAccount) return
    try {
      const state = await window.electronAPI.reloginWeChatBridgeAccount(selectedAccount.accountId)
      setActiveLoginId(state.accountId)
      toast.success('已创建微信重登二维码', {
        description: '请使用微信扫描二维码重新登录。',
      })
    } catch (error) {
      toast.error('微信账号重登失败', {
        description: getErrorMessage(error),
      })
    }
  }, [selectedAccount])

  const removeSelectedAccount = React.useCallback(async (): Promise<void> => {
    if (!selectedAccount) return
    const confirmed = window.confirm(`确定删除微信账号「${selectedAccount.label}」吗？删除后需要重新扫码登录。`)
    if (!confirmed) return
    try {
      await window.electronAPI.removeWeChatBridgeAccount(selectedAccount.accountId)
      setSelectedAccountId(null)
      await onRefresh()
      toast.success('微信账号已删除', {
        description: selectedAccount.label,
      })
    } catch (error) {
      toast.error('删除微信账号失败', {
        description: getErrorMessage(error),
      })
    }
  }, [onRefresh, selectedAccount])

  React.useEffect(() => {
    if (!activeLoginId) return

    let disposed = false
    const poll = async (): Promise<void> => {
      try {
        const state = await window.electronAPI.refreshWeChatBridgeLogin(activeLoginId)
        if (disposed) return
        if (state.status === 'confirmed') {
          setActiveLoginId(null)
          setLoginLabel('')
          await onRefresh()
          toast.success('微信账号已登录')
        }
        if (state.status === 'expired' || state.status === 'error') {
          setActiveLoginId(null)
          toast.error(state.status === 'expired' ? '微信登录二维码已过期' : '微信登录失败', {
            description: state.errorMessage || state.message,
          })
        }
      } catch (error) {
        if (!disposed) {
          setActiveLoginId(null)
          toast.error('刷新微信登录状态失败', {
            description: getErrorMessage(error),
          })
        }
      }
    }

    const timer = window.setInterval(() => {
      void poll()
    }, 2500)
    void poll()

    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [activeLoginId, onRefresh])

  return (
    <SettingsSection
      title="微信"
      description="多账号微信 iLink 远程渠道：扫码登录、账号启停、上下文回投和远程审批。"
      action={(
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void onRefresh()}>
            刷新
          </Button>
          <Button onClick={() => void onSave(config)} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </div>
      )}
    >
      <SettingsCard>
        <SettingsRow label="启用微信远程渠道" description="关闭后不会启动任何微信账号运行时。">
          <Switch
            checked={config.wechat.enabled}
            onCheckedChange={(checked) => onChange({
              ...config,
              wechat: {
                ...config.wechat,
                enabled: checked,
              },
            })}
          />
        </SettingsRow>
        <SettingsInput
          label="iLink 服务地址"
          description="扫码登录和未登录请求使用的 iLink API 地址；如果 TLS 被重置，可改成本地代理或自建 iLink 服务地址。"
          value={config.wechat.baseUrl}
          onChange={(value) => onChange({
            ...config,
            wechat: {
              ...config.wechat,
              baseUrl: value.trim(),
            },
          })}
          placeholder="https://ilinkai.weixin.qq.com"
        />
        <BridgeDefaultModelField
          description="微信新会话默认使用的模型；未设置时回退到总览配置。"
          value={config.wechat.defaultSession}
          onChange={(value) => onChange({
            ...config,
            wechat: {
              ...config.wechat,
              defaultSession: value,
            },
          })}
        />
      </SettingsCard>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <SettingsCard divided={false}>
          <div className="space-y-3 p-4">
            <div>
              <div className="text-sm font-semibold">账号</div>
              <div className="mt-1 text-xs text-muted-foreground">每个账号独立登录、轮询和存储上下文凭证。</div>
            </div>
            {accounts.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                尚未添加微信账号。
              </div>
            )}
            {accounts.map((account) => (
              <button
                key={account.accountId}
                type="button"
                className={`w-full rounded-2xl border px-3 py-3 text-left transition-colors ${
                  selectedAccount?.accountId === account.accountId
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/60'
                }`}
                onClick={() => setSelectedAccountId(account.accountId)}
              >
                <div className="text-sm font-medium">{account.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">{statusLabel(accountStatuses[account.accountId])}</div>
                <div className="mt-1 truncate text-[11px] text-muted-foreground">{account.accountId}</div>
              </button>
            ))}
          </div>
        </SettingsCard>

        <div className="space-y-4">
          <SettingsCard divided={false}>
            <div className="grid gap-4 p-4 md:grid-cols-[220px_minmax(0,1fr)]">
              <div className="space-y-3">
                {renderQr(activeLoginState)}
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void startLogin()} disabled={Boolean(activeLoginId)}>
                    扫码登录
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void refreshLogin()} disabled={!activeLoginId}>
                    刷新状态
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void cancelLogin()} disabled={!activeLoginId}>
                    取消
                  </Button>
                </div>
              </div>
              <div className="space-y-3">
                <SettingsInput
                  label="新账号标签"
                  description="用于账号列表展示；留空会使用 iLink 返回的账号 ID。"
                  value={loginLabel}
                  onChange={setLoginLabel}
                  placeholder="工作微信 / 私人微信"
                />
                <div className="rounded-2xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                  登录成功后，账号元数据写入本地账号配置，机器人凭证会加密写入本地凭据文件。
                </div>
              </div>
            </div>
          </SettingsCard>

          {selectedAccount && (
            <SettingsCard>
              <SettingsRow
                label={selectedAccount.label}
                description={`${selectedAccount.ilinkUserId || '未知 uin'} · ${selectedAccount.baseUrl || '默认服务地址'}`}
              >
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => void startSelectedAccount()}>
                    启动
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void stopSelectedAccount()}>
                    停止
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void reloginSelectedAccount()}>
                    重登
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void removeSelectedAccount()}>
                    删除
                  </Button>
                </div>
              </SettingsRow>
            </SettingsCard>
          )}
        </div>
      </div>

      <SettingsCard divided={false}>
        <SettingsInput
          label="允许的用户 ID"
          description="逗号分隔的微信聊天对象白名单；留空表示不限制。"
          value={config.wechat.allowedUserIds.join(', ')}
          onChange={(value) => onChange({
            ...config,
            wechat: {
              ...config.wechat,
              allowedUserIds: value.split(',').map((item) => item.trim()).filter(Boolean),
            },
          })}
          placeholder="wxid_xxx, wxid_yyy"
        />
        <SettingsInput
          label="消息聚合窗口（毫秒）"
          description="聚合相邻微信消息，避免图片和文本被拆成多轮智能体输入。"
          value={String(config.wechat.aggregateWindowMs)}
          onChange={(value) => onChange({
            ...config,
            wechat: {
              ...config.wechat,
              aggregateWindowMs: Number.parseInt(value, 10) || 0,
            },
          })}
        />
        <SettingsInput
          label="延迟出站保留时间（毫秒）"
          description="上下文凭证缺失时，系统消息和最终回复可等待下次入站刷新后补发。"
          value={String(config.wechat.deferredOutboundTtlMs)}
          onChange={(value) => onChange({
            ...config,
            wechat: {
              ...config.wechat,
              deferredOutboundTtlMs: Number.parseInt(value, 10) || 0,
            },
          })}
        />
      </SettingsCard>

      <SettingsSection
        title="使用说明"
        description="微信远程连接流程，Kila 使用本地加密凭证和 iLink 长轮询实现。"
      >
        <SettingsCard divided={false}>
          <div className="space-y-5 px-4 py-4">
            <GuideStep index={1} title="扫码登录">
              点击「扫码登录」，使用微信扫描二维码。登录成功后，账号令牌会加密保存到本地配置目录。
            </GuideStep>
            <GuideStep index={2} title="自动连接">
              远程渠道启动时会按账号列表恢复轮询；单个账号可独立启动、停止、重登或删除。
            </GuideStep>
            <GuideStep index={3} title="收发消息">
              通过微信发送文本、图片或文件后，Kila 会把该聊天对象绑定到一个会话；后续回复会回到同一个会话。
            </GuideStep>
            <GuideStep index={4} title="远程审批">
              微信不支持交互式卡片审批时，Kila 会发送文本审批码；按提示回复即可完成允许或拒绝。
            </GuideStep>
            <div className="rounded-lg bg-muted/35 px-3 py-3 text-xs leading-5 text-foreground/80">
              iLink 服务地址默认使用{' '}
              <button
                type="button"
                className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                onClick={() => { void window.electronAPI.openExternal('https://ilinkai.weixin.qq.com') }}
              >
                iLink 机器人 API
                <ExternalLink className="size-3" />
              </button>
              。如果网络环境需要代理或自建服务，可在上方替换服务地址。
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>
    </SettingsSection>
  )
}
