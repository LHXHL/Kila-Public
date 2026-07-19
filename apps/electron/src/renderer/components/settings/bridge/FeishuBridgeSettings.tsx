import * as React from 'react'
import { toast } from 'sonner'
import type {
  BridgeBinding,
  BridgeConfig,
  FeishuBotBridgeStatus,
  FeishuBotConfig,
  FeishuMultiBridgeStatus,
  FeishuRegisterAppQRCode,
  FeishuRegisterAppStatus,
} from '@kila/shared'
import { Check, Copy, ExternalLink, Loader2, Plus, Power, PowerOff, QrCode, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { SettingsCard } from '../primitives/SettingsCard'
import { SettingsInput } from '../primitives/SettingsInput'
import { SettingsRow } from '../primitives/SettingsRow'
import { SettingsSecretInput } from '../primitives/SettingsSecretInput'
import { SettingsSection } from '../primitives/SettingsSection'
import { SettingsSegmentedControl } from '../primitives/SettingsSegmentedControl'
import { BridgeBindingsPanel } from './BridgeBindingsPanel'
import { BridgeDefaultModelField } from './BridgeDefaultModelField'
import { getStatusToneClasses } from '@/lib/theme/status-tone'

type FeishuSettingsTab = 'bots' | 'bindings' | 'guide'

const PERMISSION_JSON = JSON.stringify({
  scopes: {
    tenant: [
      'contact:contact.base:readonly',
      'drive:drive',
      'im:chat',
      'im:chat.announcement:write_only',
      'im:chat.managers:write_only',
      'im:chat.members:read',
      'im:chat.members:write_only',
      'im:chat.tabs:write_only',
      'im:chat.top_notice:write_only',
      'im:message',
      'im:message:send_as_bot',
      'im:message:send_multi_media',
      'im:message.p2p_msg:readonly',
      'im:message.group_at_msg:readonly',
      'im:message.group_msg',
      'im:message.reactions:write_only',
      'im:resource',
      'wiki:wiki',
    ],
    user: [],
  },
}, null, 2)

const FEISHU_CLI_PROMPT = `请帮我配置飞书 CLI 开发环境，按以下步骤执行：

1. 安装飞书 CLI 到全局
npm install -g @larksuite/cli

2. 将 Skill 配置到当前 Kila 工作区
npx skills add https://github.com/larksuite/cli -y -g

3. 初始化 CLI 配置（创建一个全新的飞书 CLI 应用，与 Kila 飞书机器人互不影响）
lark-cli config init --new

4. 一键申请全部领域权限（文档/表格/日历/任务/邮件/通讯录/会议/审批/OKR/Wiki/多维表格/幻灯片/考勤/项目板等）
lark-cli auth login --domain all

执行第 3 步时浏览器会弹出授权页面，请按提示完成应用创建并扫码授权。
执行第 4 步时浏览器会再次弹出，请一次性确认所有领域权限；跳过会导致后续智能体调用飞书文档、日历、邮件等能力时报权限不足。`

function statusLabel(status?: FeishuBotBridgeStatus): string {
  if (!status) return '未启动'
  const label = (() => {
    switch (status.status) {
      case 'connected':
        return '已连接'
      case 'connecting':
        return '连接中'
      case 'error':
        return '连接错误'
      default:
        return '未连接'
    }
  })()
  if (status.errorMessage) return `${label} · ${status.errorMessage}`
  switch (status.status) {
    case 'connected':
      return '已连接'
    case 'connecting':
      return '连接中'
    case 'error':
      return '连接错误'
    default:
      return '未连接'
  }
}

function statusTone(status?: FeishuBotBridgeStatus): string {
  if (!status) return getStatusToneClasses('neutral').subtleSurface
  if (status.status === 'connected') return getStatusToneClasses('success').subtleSurface
  if (status.status === 'connecting') return getStatusToneClasses('warning').subtleSurface
  if (status.status === 'error') return getStatusToneClasses('danger').subtleSurface
  return getStatusToneClasses('neutral').subtleSurface
}

function defaultBotName(index: number): string {
  return `飞书助手 ${index + 1}`
}

function LinkButton({ href, children }: { href: string; children: React.ReactNode }): React.ReactElement {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
      onClick={() => { void window.electronAPI.openExternal(href) }}
    >
      {children}
      <ExternalLink className="size-3" />
    </button>
  )
}

function RegisterFeishuDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: (result: { appId: string; appSecret: string }) => Promise<void>
}): React.ReactElement {
  const [qrcode, setQrcode] = React.useState<FeishuRegisterAppQRCode | null>(null)
  const [status, setStatus] = React.useState<FeishuRegisterAppStatus | null>(null)
  const [phase, setPhase] = React.useState<'idle' | 'qrcode' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = React.useState('')
  const onSuccessRef = React.useRef(onSuccess)

  React.useLayoutEffect(() => {
    onSuccessRef.current = onSuccess
  })

  React.useEffect(() => {
    if (!open) return

    let disposed = false
    setQrcode(null)
    setStatus(null)
    setErrorMessage('')
    setPhase('idle')

    const offQr = window.electronAPI.onFeishuBridgeRegisterQrcode((payload) => {
      setQrcode(payload)
      setPhase('qrcode')
    })
    const offStatus = window.electronAPI.onFeishuBridgeRegisterStatus((payload) => {
      setStatus(payload)
    })

    window.electronAPI.registerFeishuBridgeApp()
      .then(async (result) => {
        if (disposed) return
        setPhase('success')
        await onSuccessRef.current({ appId: result.appId, appSecret: result.appSecret })
      })
      .catch((error: unknown) => {
        if (disposed) return
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('abort') || message.includes('Abort')) return
        setErrorMessage(message)
        setPhase('error')
      })

    return () => {
      disposed = true
      offQr()
      offStatus()
      void window.electronAPI.cancelFeishuBridgeRegistration()
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="size-4" />
            扫码创建飞书机器人
          </DialogTitle>
          <DialogDescription>
            Kila 会调用飞书开放平台注册流程，扫码后自动写入应用 ID 和应用密钥。
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-72 flex-col items-center justify-center gap-3 py-3">
          {phase === 'idle' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              正在申请二维码
            </div>
          )}
          {phase === 'qrcode' && qrcode && (
            <>
              <div className="rounded-xl bg-white p-3 shadow-sm">
                {qrcode.dataUrl ? (
                  <img src={qrcode.dataUrl} alt="飞书注册二维码" className="size-60" />
                ) : (
                  <div className="flex size-60 items-center justify-center text-xs text-muted-foreground">
                    二维码生成失败
                  </div>
                )}
              </div>
              <div className="text-sm font-medium">用飞书 App 扫码确认创建应用</div>
              <div className="text-xs text-muted-foreground">
                {status?.status === 'slow_down' ? '轮询频率已自动放慢' : '等待扫码确认'}
              </div>
              <Button variant="link" size="sm" onClick={() => { void window.electronAPI.openExternal(qrcode.url) }}>
                在浏览器打开
              </Button>
            </>
          )}
          {phase === 'success' && (
            <div className="text-center text-sm">
              <div className="font-medium text-foreground">应用创建成功</div>
              <div className="mt-1 text-muted-foreground">已保存为新的飞书机器人，可在列表中启动。</div>
            </div>
          )}
          {phase === 'error' && (
            <div className="flex max-w-sm flex-col items-center gap-3 text-center text-sm">
              <div className="text-destructive">
                {errorMessage || '创建失败，请稍后重试'}
              </div>
              <Button size="sm" variant="outline" onClick={() => { void window.electronAPI.openExternal('https://open.feishu.cn/app') }}>
                打开飞书开放平台
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {phase === 'success' || phase === 'error' ? '关闭' : '取消'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BotCard({
  bot,
  status,
  onReload,
}: {
  bot: FeishuBotConfig
  status?: FeishuBotBridgeStatus
  onReload: () => Promise<void>
}): React.ReactElement {
  const [expanded, setExpanded] = React.useState(!bot.appId)
  const [name, setName] = React.useState(bot.name)
  const [enabled, setEnabled] = React.useState(bot.enabled)
  const [appId, setAppId] = React.useState(bot.appId)
  const [appSecret, setAppSecret] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const isRunning = status?.status === 'connected' || status?.status === 'connecting'

  const save = React.useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      await window.electronAPI.saveFeishuBridgeBot({
        id: bot.id,
        name,
        enabled,
        appId,
        appSecret,
        defaultSession: bot.defaultSession,
      })
      setAppSecret('')
      toast.success('飞书机器人已保存')
      await onReload()
    } catch (error) {
      toast.error('保存飞书机器人失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }, [appId, appSecret, bot.defaultSession, bot.id, enabled, name, onReload])

  const toggleRuntime = React.useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      if (isRunning) {
        await window.electronAPI.stopFeishuBridgeBot(bot.id)
      } else {
        await window.electronAPI.startFeishuBridgeBot(bot.id)
      }
      await onReload()
    } catch (error) {
      toast.error('飞书机器人状态切换失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }, [bot.id, isRunning, onReload])

  const test = React.useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.electronAPI.testFeishuBridgeBot(bot.id)
      if (result.success) {
        toast.success('飞书机器人连接成功', { description: result.message })
      } else {
        toast.error('飞书机器人连接失败', { description: result.message })
      }
    } catch (error) {
      toast.error('测试飞书机器人失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }, [bot.id])

  const remove = React.useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      await window.electronAPI.removeFeishuBridgeBot(bot.id)
      toast.success('飞书机器人已删除')
      await onReload()
    } catch (error) {
      toast.error('删除飞书机器人失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }, [bot.id, onReload])

  return (
    <SettingsCard divided={false}>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <button type="button" className="min-w-0 text-left" onClick={() => setExpanded((value) => !value)}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{bot.name || '未命名机器人'}</span>
            <Badge variant="outline" className={statusTone(status)}>{statusLabel(status)}</Badge>
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">{bot.appId || '未配置应用 ID'}</div>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {bot.appId && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void toggleRuntime()}>
              {isRunning ? <PowerOff className="mr-1 size-3.5" /> : <Power className="mr-1 size-3.5" />}
              {isRunning ? '停止' : '启动'}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setExpanded((value) => !value)}>
            {expanded ? '收起' : '配置'}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border/60 py-2">
          <SettingsRow label="启用机器人">
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </SettingsRow>
          <SettingsInput label="机器人名称" value={name} onChange={setName} placeholder="研发助手" />
          <SettingsInput label="应用 ID" value={appId} onChange={setAppId} placeholder="cli_xxxxx" />
          <SettingsSecretInput
            label="应用密钥"
            description="留空保存时会保留当前已加密密钥。"
            value={appSecret}
            onChange={setAppSecret}
            hasSavedValue={!!bot.appSecret}
            onReveal={() => window.electronAPI.getFeishuBridgeBotSecret(bot.id)}
            placeholder="飞书应用密钥"
          />
          <BridgeDefaultModelField
            description="该机器人新建远程会话时默认使用的模型。"
            value={bot.defaultSession}
            onChange={(value) => {
              void window.electronAPI.saveFeishuBridgeBot({
                id: bot.id,
                name,
                enabled,
                appId,
                appSecret,
                defaultSession: value,
              }).then(onReload)
            }}
          />
          {status?.errorMessage && (
            <div className="px-4 py-2 text-sm text-destructive">{status.errorMessage}</div>
          )}
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <Button variant="outline" size="sm" disabled={busy || !name.trim()} onClick={() => void save()}>
              {busy && <Loader2 className="mr-1 size-3.5 animate-spin" />}
              保存配置
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={busy || !bot.appId} onClick={() => void test()}>
                测试连接
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove()}>
                <Trash2 className="mr-1 size-3.5" />
                删除
              </Button>
            </div>
          </div>
        </div>
      )}
    </SettingsCard>
  )
}

function FeishuGuide(): React.ReactElement {
  const [copied, setCopied] = React.useState(false)
  const copy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(PERMISSION_JSON)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('复制失败，请检查剪贴板权限')
    }
  }, [])
  const copyCliPrompt = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(FEISHU_CLI_PROMPT)
      toast.success('飞书 CLI 配置提示词已复制')
    } catch {
      toast.error('复制失败，请检查剪贴板权限')
    }
  }, [])

  return (
    <SettingsSection title="配置教程" description="飞书长连接接入流程、权限配置和 CLI 能力扩展说明。">
      <SettingsCard divided={false}>
        <div className="space-y-5 px-4 py-4 text-sm">
          {[
            ['创建自建应用', <>进入 <LinkButton href="https://open.feishu.cn/app">飞书开放平台</LinkButton>，创建企业自建应用。</>],
            ['获取应用凭证', <>在「凭证与基础信息」复制应用 ID 和应用密钥，填入机器人配置。</>],
            ['启用机器人能力', <>在「添加应用能力」启用机器人，发布后把机器人添加到私聊或群聊。</>],
            ['配置长连接事件', <>在「事件与回调」选择「使用长连接接收事件」，订阅 <code className="rounded bg-muted px-1 py-0.5">im.message.receive_v1</code>。</>],
            ['配置卡片回调', <>回调方式同样选择长连接，添加 <code className="rounded bg-muted px-1 py-0.5">card.action.trigger</code>，用于后续卡片回调能力；当前远程控制以文本命令为主。</>],
            ['发布应用', <>创建版本并提交审核，管理员通过后即可在飞书中使用 Kila 智能体。</>],
          ].map(([title, body], index) => (
            <div key={String(title)} className="grid gap-2 sm:grid-cols-[28px_minmax(0,1fr)]">
              <div className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{index + 1}</div>
              <div>
                <div className="font-medium text-foreground">{title}</div>
                <div className="mt-1 leading-6 text-muted-foreground">{body}</div>
              </div>
            </div>
          ))}
          <div className="rounded-lg bg-muted/35 px-3 py-3 text-xs leading-5 text-foreground/80">
            如果你使用「扫码创建」，Kila 会自动完成应用注册和凭证保存；权限、长连接事件和发布审核仍需在飞书开放平台确认。
          </div>
        </div>
      </SettingsCard>

      <SettingsCard divided={false}>
        <div className="space-y-3 px-4 py-4 text-sm">
          <div>
            <div className="font-medium text-foreground">飞书 CLI 生态配置</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              补全飞书 CLI 后，Kila 智能体可以继续接入飞书文档、日历、邮件、Wiki、多维表格等能力。复制提示词到 Kila 新会话中发送即可让智能体引导配置。
            </div>
          </div>
          <div className="rounded-xl bg-muted/45 p-3 font-mono text-xs leading-5 text-muted-foreground">
            <div>npm install -g @larksuite/cli</div>
            <div>npx skills add https://github.com/larksuite/cli -y -g</div>
            <div>lark-cli config init --new</div>
            <div>lark-cli auth login --domain all</div>
          </div>
          <Button size="sm" variant="outline" onClick={() => void copyCliPrompt()}>
            <Copy className="mr-1 size-3.5" />
            复制飞书 CLI 配置提示词
          </Button>
        </div>
      </SettingsCard>

      <SettingsCard divided={false}>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <div className="text-sm font-medium">推荐权限 JSON</div>
            <div className="mt-1 text-xs text-muted-foreground">可复制后对照飞书开放平台权限配置。</div>
          </div>
          <Button size="sm" variant="outline" onClick={() => void copy()}>
            {copied ? <Check className="mr-1 size-3.5" /> : <Copy className="mr-1 size-3.5" />}
            {copied ? '已复制' : '复制'}
          </Button>
        </div>
        <Textarea className="min-h-48 rounded-none border-0 bg-muted/40 font-mono text-xs" readOnly value={PERMISSION_JSON} />
      </SettingsCard>
    </SettingsSection>
  )
}

export function FeishuBridgeSettings({
  config,
  bindings,
  sessions,
  onChange,
  onSave,
  onUpdateBinding,
  onUpdateBindingProjectPath,
  onRemoveBinding,
  saving,
}: {
  config: BridgeConfig
  bindings: BridgeBinding[]
  sessions: Array<{ id: string; title: string }>
  onChange: (config: BridgeConfig) => void
  onSave: (config: BridgeConfig) => Promise<void>
  onUpdateBinding: (binding: BridgeBinding) => Promise<void>
  onUpdateBindingProjectPath: (endpointKey: string, projectPath: string) => Promise<void>
  onRemoveBinding: (endpointKey: string) => Promise<void>
  saving: boolean
}): React.ReactElement {
  const [tab, setTab] = React.useState<FeishuSettingsTab>('bots')
  const [bots, setBots] = React.useState<FeishuBotConfig[]>([])
  const [multiStatus, setMultiStatus] = React.useState<FeishuMultiBridgeStatus>({ bots: {} })
  const [registerOpen, setRegisterOpen] = React.useState(false)

  const updateFeishu = React.useCallback(
    (patch: Partial<BridgeConfig['feishu']>) => {
      onChange({ ...config, feishu: { ...config.feishu, ...patch } })
    },
    [config, onChange],
  )

  const reload = React.useCallback(async (): Promise<void> => {
    const [nextBots, nextStatus] = await Promise.all([
      window.electronAPI.listFeishuBridgeBots(),
      window.electronAPI.getFeishuBridgeMultiStatus(),
    ])
    setBots(nextBots)
    setMultiStatus(nextStatus)
  }, [])

  React.useEffect(() => {
    void reload()
    return window.electronAPI.onFeishuBridgeMultiStatusChanged(setMultiStatus)
  }, [reload])

  const createManualBot = React.useCallback(async (): Promise<void> => {
    await window.electronAPI.saveFeishuBridgeBot({
      name: defaultBotName(bots.length),
      enabled: false,
      appId: '',
      appSecret: '',
      defaultSession: config.feishu.defaultSession,
    })
    await reload()
  }, [bots.length, config.feishu.defaultSession, reload])

  const createFromRegister = React.useCallback(async (result: { appId: string; appSecret: string }): Promise<void> => {
    const saved = await window.electronAPI.saveFeishuBridgeBot({
      name: defaultBotName(bots.length),
      enabled: true,
      appId: result.appId,
      appSecret: result.appSecret,
      defaultSession: config.feishu.defaultSession,
    })
    await reload()
    void window.electronAPI.startFeishuBridgeBot(saved.id).then(reload).catch(() => {})
  }, [bots.length, config.feishu.defaultSession, reload])

  const feishuBindings = React.useMemo(
    () => bindings.filter((binding) => binding.channelType === 'feishu'),
    [bindings],
  )
  const enabledBots = bots.filter((bot) => bot.enabled && bot.appId)

  return (
    <div className="space-y-6">
      <SettingsSection
        title="飞书"
        description="飞书远程渠道：多机器人、扫码创建、绑定管理、会话镜像、长连接卡片。"
        action={(
          <Button onClick={() => void onSave(config)} disabled={saving}>
            {saving ? '保存中...' : '保存全局配置'}
          </Button>
        )}
      >
        <SettingsSegmentedControl
          label="飞书设置"
          value={tab}
          options={[
            { value: 'bots', label: '机器人配置' },
            { value: 'bindings', label: '绑定管理' },
            { value: 'guide', label: '配置教程' },
          ]}
          onValueChange={(value) => setTab(value as FeishuSettingsTab)}
        />
      </SettingsSection>

      {tab === 'bots' && (
        <>
          <SettingsCard>
            <SettingsRow label="启用飞书远程渠道">
              <Switch checked={config.feishu.enabled} onCheckedChange={(checked) => updateFeishu({ enabled: checked })} />
            </SettingsRow>
            <SettingsRow label="允许私聊 P2P">
              <Switch checked={config.feishu.allowP2P} onCheckedChange={(checked) => updateFeishu({ allowP2P: checked })} />
            </SettingsRow>
            <SettingsRow label="允许群聊">
              <Switch checked={config.feishu.allowGroup} onCheckedChange={(checked) => updateFeishu({ allowGroup: checked })} />
            </SettingsRow>
            <SettingsRow label="群聊必须 @ 机器人">
              <Switch checked={config.feishu.requireMention} onCheckedChange={(checked) => updateFeishu({ requireMention: checked })} />
            </SettingsRow>
          </SettingsCard>

          <SettingsSection
            title="飞书机器人列表"
            description="可同时配置多个飞书自建应用；入站入口会携带机器人 ID，绑定不会互相串线。"
            action={(
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setRegisterOpen(true)}>
                  <QrCode className="mr-1 size-3.5" />
                  扫码创建
                </Button>
                <Button size="sm" variant="outline" onClick={() => void createManualBot()}>
                  <Plus className="mr-1 size-3.5" />
                  手动添加
                </Button>
              </div>
            )}
          >
            <RegisterFeishuDialog open={registerOpen} onOpenChange={setRegisterOpen} onSuccess={createFromRegister} />
            {bots.length === 0 ? (
              <SettingsCard>
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  还没有飞书机器人。推荐先使用「扫码创建」。
                </div>
              </SettingsCard>
            ) : (
              <div className="space-y-3">
                {bots.map((bot) => (
                  <BotCard key={bot.id} bot={bot} status={multiStatus.bots[bot.id]} onReload={reload} />
                ))}
              </div>
            )}
          </SettingsSection>

          <SettingsSection
            title="同步到飞书"
            description="开启后，桌面端新运行的 Kila 会话会创建一个飞书群并同步智能体输出；需先让目标机器人收到你的一条消息以记录 open_id（用户标识）。"
          >
            <SettingsCard>
              <SettingsRow label="会话镜像">
                <Switch
                  checked={config.feishu.sessionMirror?.mode === 'stream'}
                  onCheckedChange={(checked) => updateFeishu({
                    sessionMirror: {
                      mode: checked ? 'stream' : 'off',
                      botId: config.feishu.sessionMirror?.botId ?? enabledBots[0]?.id,
                    },
                  })}
                />
              </SettingsRow>
              <div className="px-4 py-3 space-y-2">
                <div className="text-sm font-medium">同步机器人</div>
                <Select
                  value={config.feishu.sessionMirror?.botId ?? ''}
                  disabled={enabledBots.length === 0}
                  onValueChange={(botId) => updateFeishu({
                    sessionMirror: {
                      mode: config.feishu.sessionMirror?.mode ?? 'stream',
                      botId,
                    },
                  })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={enabledBots.length === 0 ? '先启用一个机器人' : '选择机器人'} />
                  </SelectTrigger>
                  <SelectContent>
                    {enabledBots.map((bot) => (
                      <SelectItem key={bot.id} value={bot.id}>{bot.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </SettingsCard>
          </SettingsSection>

          <SettingsCard>
            <SettingsRow label="流式卡片" description="启用飞书卡片 2.0，实时展示智能体运行状态。">
              <Switch checked={config.feishu.streamingCards ?? true} onCheckedChange={(checked) => updateFeishu({ streamingCards: checked })} />
            </SettingsRow>
            <SettingsInput label="消息聚合窗口 (ms)" value={String(config.feishu.quietWindowMs ?? 600)} onChange={(value) => updateFeishu({ quietWindowMs: Number.parseInt(value, 10) || 0 })} />
            <SettingsInput label="最大并发运行数" value={String(config.feishu.maxConcurrent ?? 5)} onChange={(value) => updateFeishu({ maxConcurrent: Number.parseInt(value, 10) || 1 })} />
          </SettingsCard>
        </>
      )}

      {tab === 'bindings' && (
        <BridgeBindingsPanel
          bindings={feishuBindings}
          sessions={sessions}
          onUpdate={onUpdateBinding}
          onUpdateProjectPath={onUpdateBindingProjectPath}
          onRemove={onRemoveBinding}
        />
      )}

      {tab === 'guide' && <FeishuGuide />}
    </div>
  )
}
