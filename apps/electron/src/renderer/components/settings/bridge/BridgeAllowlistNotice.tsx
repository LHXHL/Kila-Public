/**
 * BridgeAllowlistNotice - 远程渠道白名单状态提示
 *
 * 行为变更提示：白名单为空不再等于「放行全部」，而是「拒绝全部」。
 * 老用户升级后如果只填了 botToken，会看到这条提示，知道该补白名单。
 */

import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

export function BridgeAllowlistNotice({
  allowedCount,
  subject,
}: {
  allowedCount: number
  /** 白名单主体名称（已本地化），默认「用户 ID」 */
  subject?: string
}): React.ReactElement {
  const { t } = useTranslation()
  const configured = allowedCount > 0
  const subjectLabel = subject ?? t('settingsBridge.common.allowlist.subjectUserId')

  return (
    <div
      className={cn(
        'mx-4 mb-3 flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs shadow-sm',
        configured
          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
      )}
    >
      {configured
        ? <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        : <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />}
      <div className="space-y-1">
        {configured ? (
          <p>
            {t('settingsBridge.common.allowlist.configured', {
              count: allowedCount,
              subject: subjectLabel,
            })}
          </p>
        ) : (
          <>
            <p className="font-medium">
              {t('settingsBridge.common.allowlist.emptyTitle', { subject: subjectLabel })}
            </p>
            <p>{t('settingsBridge.common.allowlist.emptyBody', { subject: subjectLabel })}</p>
          </>
        )}
      </div>
    </div>
  )
}
