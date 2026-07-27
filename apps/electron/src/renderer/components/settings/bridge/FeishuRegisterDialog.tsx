/**
 * FeishuRegisterDialog - 扫码创建飞书自建应用
 *
 * 走飞书开放平台注册流程，成功后把 appId / appSecret 交给上层保存为新机器人。
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { FeishuRegisterAppQRCode, FeishuRegisterAppStatus } from '@kila/shared'
import { Loader2, QrCode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function FeishuRegisterDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: (result: { appId: string; appSecret: string }) => Promise<void>
}): React.ReactElement {
  const { t } = useTranslation()
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
            {t('settingsBridge.feishu.register.title')}
          </DialogTitle>
          <DialogDescription>
            {t('settingsBridge.feishu.register.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-72 flex-col items-center justify-center gap-3 py-3">
          {phase === 'idle' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('settingsBridge.feishu.register.requesting')}
            </div>
          )}
          {phase === 'qrcode' && qrcode && (
            <>
              <div className="rounded-xl bg-white p-3 shadow-sm">
                {qrcode.dataUrl ? (
                  <img src={qrcode.dataUrl} alt={t('settingsBridge.feishu.register.qrAlt')} className="size-60" />
                ) : (
                  <div className="flex size-60 items-center justify-center text-xs text-muted-foreground">
                    {t('settingsBridge.feishu.register.qrFailed')}
                  </div>
                )}
              </div>
              <div className="text-sm font-medium">{t('settingsBridge.feishu.register.scanHint')}</div>
              <div className="text-xs text-muted-foreground">
                {status?.status === 'slow_down'
                  ? t('settingsBridge.feishu.register.slowDown')
                  : t('settingsBridge.feishu.register.waitingScan')}
              </div>
              <Button variant="link" size="sm" onClick={() => { void window.electronAPI.openExternal(qrcode.url) }}>
                {t('settingsBridge.feishu.register.openInBrowser')}
              </Button>
            </>
          )}
          {phase === 'success' && (
            <div className="text-center text-sm">
              <div className="font-medium text-foreground">{t('settingsBridge.feishu.register.successTitle')}</div>
              <div className="mt-1 text-muted-foreground">{t('settingsBridge.feishu.register.successDescription')}</div>
            </div>
          )}
          {phase === 'error' && (
            <div className="flex max-w-sm flex-col items-center gap-3 text-center text-sm">
              <div className="text-destructive">
                {errorMessage || t('settingsBridge.feishu.register.errorFallback')}
              </div>
              <Button size="sm" variant="outline" onClick={() => { void window.electronAPI.openExternal('https://open.feishu.cn/app') }}>
                {t('settingsBridge.feishu.register.openPlatform')}
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {phase === 'success' || phase === 'error'
              ? t('settingsBridge.common.close')
              : t('settingsBridge.common.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
