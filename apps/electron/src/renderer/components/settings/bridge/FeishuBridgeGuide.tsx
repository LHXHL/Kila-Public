/**
 * FeishuBridgeGuide - 飞书接入配置教程
 *
 * 包含长连接接入步骤、CLI 生态提示词和推荐权限 JSON。
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { SettingsCard } from '../primitives/SettingsCard'
import { SettingsSection } from '../primitives/SettingsSection'

/** 推荐权限清单，属于飞书开放平台配置，不做本地化 */
export const FEISHU_PERMISSION_JSON = JSON.stringify({
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

const FEISHU_CLI_COMMANDS = [
  'npm install -g @larksuite/cli',
  'npx skills add https://github.com/larksuite/cli -y -g',
  'lark-cli config init --new',
  'lark-cli auth login --domain all',
]

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

function InlineCode({ children }: { children: React.ReactNode }): React.ReactElement {
  return <code className="rounded bg-muted px-1 py-0.5">{children}</code>
}

export function FeishuBridgeGuide(): React.ReactElement {
  const { t } = useTranslation()
  const [copied, setCopied] = React.useState(false)

  const copyPermissionJson = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(FEISHU_PERMISSION_JSON)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error(t('settingsBridge.feishu.guide.copyFailed'))
    }
  }, [t])

  const copyCliPrompt = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(t('settingsBridge.feishu.guide.cli.prompt'))
      toast.success(t('settingsBridge.feishu.guide.cli.copied'))
    } catch {
      toast.error(t('settingsBridge.feishu.guide.copyFailed'))
    }
  }, [t])

  const steps: Array<{ key: string; title: string; body: React.ReactNode }> = [
    {
      key: 'createApp',
      title: t('settingsBridge.feishu.guide.steps.createAppTitle'),
      body: (
        <>
          {t('settingsBridge.feishu.guide.steps.createAppBefore')}
          <LinkButton href="https://open.feishu.cn/app">
            {t('settingsBridge.feishu.guide.steps.createAppLink')}
          </LinkButton>
          {t('settingsBridge.feishu.guide.steps.createAppAfter')}
        </>
      ),
    },
    {
      key: 'credentials',
      title: t('settingsBridge.feishu.guide.steps.credentialsTitle'),
      body: t('settingsBridge.feishu.guide.steps.credentialsBody'),
    },
    {
      key: 'enableBot',
      title: t('settingsBridge.feishu.guide.steps.enableBotTitle'),
      body: t('settingsBridge.feishu.guide.steps.enableBotBody'),
    },
    {
      key: 'longConnection',
      title: t('settingsBridge.feishu.guide.steps.longConnectionTitle'),
      body: (
        <>
          {t('settingsBridge.feishu.guide.steps.longConnectionBefore')}
          <InlineCode>im.message.receive_v1</InlineCode>
          {t('settingsBridge.feishu.guide.steps.longConnectionAfter')}
        </>
      ),
    },
    {
      key: 'cardCallback',
      title: t('settingsBridge.feishu.guide.steps.cardCallbackTitle'),
      body: (
        <>
          {t('settingsBridge.feishu.guide.steps.cardCallbackBefore')}
          <InlineCode>card.action.trigger</InlineCode>
          {t('settingsBridge.feishu.guide.steps.cardCallbackAfter')}
        </>
      ),
    },
    {
      key: 'publish',
      title: t('settingsBridge.feishu.guide.steps.publishTitle'),
      body: t('settingsBridge.feishu.guide.steps.publishBody'),
    },
  ]

  return (
    <SettingsSection
      title={t('settingsBridge.feishu.guide.title')}
      description={t('settingsBridge.feishu.guide.description')}
    >
      <SettingsCard divided={false}>
        <div className="space-y-5 px-4 py-4 text-sm">
          {steps.map((step, index) => (
            <div key={step.key} className="grid gap-2 sm:grid-cols-[28px_minmax(0,1fr)]">
              <div className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{index + 1}</div>
              <div>
                <div className="font-medium text-foreground">{step.title}</div>
                <div className="mt-1 leading-6 text-muted-foreground">{step.body}</div>
              </div>
            </div>
          ))}
          <div className="rounded-lg bg-muted/35 px-3 py-3 text-xs leading-5 text-foreground/80">
            {t('settingsBridge.feishu.guide.scanNotice')}
          </div>
        </div>
      </SettingsCard>

      <SettingsCard divided={false}>
        <div className="space-y-3 px-4 py-4 text-sm">
          <div>
            <div className="font-medium text-foreground">{t('settingsBridge.feishu.guide.cli.title')}</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              {t('settingsBridge.feishu.guide.cli.description')}
            </div>
          </div>
          <div className="rounded-xl bg-muted/45 p-3 font-mono text-xs leading-5 text-muted-foreground">
            {FEISHU_CLI_COMMANDS.map((command) => (
              <div key={command}>{command}</div>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={() => void copyCliPrompt()}>
            <Copy className="mr-1 size-3.5" />
            {t('settingsBridge.feishu.guide.cli.copyPrompt')}
          </Button>
        </div>
      </SettingsCard>

      <SettingsCard divided={false}>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <div className="text-sm font-medium">{t('settingsBridge.feishu.guide.permissionJson.title')}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {t('settingsBridge.feishu.guide.permissionJson.description')}
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => void copyPermissionJson()}>
            {copied ? <Check className="mr-1 size-3.5" /> : <Copy className="mr-1 size-3.5" />}
            {copied
              ? t('settingsBridge.feishu.guide.permissionJson.copied')
              : t('settingsBridge.feishu.guide.permissionJson.copy')}
          </Button>
        </div>
        <Textarea className="min-h-48 rounded-none border-0 bg-muted/40 font-mono text-xs" readOnly value={FEISHU_PERMISSION_JSON} />
      </SettingsCard>
    </SettingsSection>
  )
}
