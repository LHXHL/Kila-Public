/**
 * ScheduledTaskResultFields - 定时任务的结果处理配置
 *
 * 结果投递目标、结果校验规则、missed run 提醒和 AI 主动结束开关。
 */

import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import type {
  BridgeBinding,
  ScheduledTaskDelivery,
  ScheduledTaskResultVerifier,
} from '@kila/shared'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { FieldGroup } from './editor-primitives'
import { getDeliveryTargets, hasVerifier, setDeliveryTarget } from './editor-delivery'

interface ScheduledTaskResultFieldsProps {
  bindings: BridgeBinding[]
  delivery: ScheduledTaskDelivery
  onDeliveryChange: (updater: (prev: ScheduledTaskDelivery) => ScheduledTaskDelivery) => void
  resultVerifiers: ScheduledTaskResultVerifier[]
  onToggleVerifier: (kind: ScheduledTaskResultVerifier['kind'], enabled: boolean) => void
  verificationFilePath: string
  onVerificationFilePathChange: (value: string) => void
  notifyOnMissedRun: boolean
  onNotifyOnMissedRunChange: (value: boolean) => void
  aiCanExit: boolean
  onAiCanExitChange: (value: boolean) => void
}

export function ScheduledTaskResultFields({
  bindings,
  delivery,
  onDeliveryChange,
  resultVerifiers,
  onToggleVerifier,
  verificationFilePath,
  onVerificationFilePathChange,
  notifyOnMissedRun,
  onNotifyOnMissedRunChange,
  aiCanExit,
  onAiCanExitChange,
}: ScheduledTaskResultFieldsProps): React.ReactElement {
  const { t } = useTranslation()
  const selectedEndpointKeys = new Set(getDeliveryTargets(delivery).map((target) => target.endpointKey))

  return (
    <div className="rounded-lg bg-muted/25 px-4 py-4">
      <div className="text-xs font-medium text-muted-foreground">
        {t('settingsTasks.editor.result.title')}
      </div>

      <div className="mt-4 space-y-4">
        <FieldGroup
          label={t('settingsTasks.editor.result.deliveryLabel')}
          description={t('settingsTasks.editor.result.deliveryDescription')}
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between border-b border-border/45 px-1 py-3 last:border-b-0">
              <div>
                <div className="text-sm font-medium text-foreground">{t('settingsTasks.editor.result.deliveryNone')}</div>
                <div className="mt-1 text-xs text-muted-foreground">{t('settingsTasks.editor.result.deliveryNoneDescription')}</div>
              </div>
              <Switch
                checked={delivery.kind === 'none'}
                onCheckedChange={(checked) => {
                  if (checked) onDeliveryChange(() => ({ kind: 'none' }))
                }}
              />
            </div>
            {bindings.length === 0 && (
              <div className="rounded-lg border border-dashed border-border/60 px-4 py-3 text-sm text-muted-foreground">
                {t('settingsTasks.editor.result.noBindings')}
              </div>
            )}
            {bindings.map((binding) => (
              <div key={binding.endpointKey} className="flex items-center justify-between border-b border-border/45 px-1 py-3 last:border-b-0">
                <div>
                  <div className="text-sm font-medium text-foreground">{binding.displayName || binding.endpointKey}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{binding.channelType} · {binding.endpointKey}</div>
                </div>
                <Switch
                  checked={selectedEndpointKeys.has(binding.endpointKey)}
                  onCheckedChange={(checked) => {
                    onDeliveryChange((prev) => setDeliveryTarget(prev, binding, checked))
                  }}
                />
              </div>
            ))}
          </div>
        </FieldGroup>

        <FieldGroup
          label={t('settingsTasks.editor.result.verificationLabel')}
          description={t('settingsTasks.editor.result.verificationDescription')}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-border/45 px-1 py-3 last:border-b-0">
              <div>
                <div className="text-sm font-medium text-foreground">{t('settingsTasks.editor.result.replyNonEmptyLabel')}</div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">
                  {t('settingsTasks.editor.result.replyNonEmptyDescription')}
                </div>
              </div>
              <Switch
                checked={hasVerifier(resultVerifiers, 'reply_non_empty')}
                onCheckedChange={(checked) => onToggleVerifier('reply_non_empty', checked)}
              />
            </div>

            <div className="flex items-center justify-between border-b border-border/45 px-1 py-3 last:border-b-0">
              <div>
                <div className="text-sm font-medium text-foreground">{t('settingsTasks.editor.result.bridgeDeliveryLabel')}</div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">
                  {t('settingsTasks.editor.result.bridgeDeliveryDescription')}
                </div>
              </div>
              <Switch
                checked={hasVerifier(resultVerifiers, 'bridge_delivery_success')}
                onCheckedChange={(checked) => onToggleVerifier('bridge_delivery_success', checked)}
              />
            </div>

            <div className="border-b border-border/45 px-1 py-3 last:border-b-0">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-foreground">{t('settingsTasks.editor.result.fileExistsLabel')}</div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">
                    {t('settingsTasks.editor.result.fileExistsDescription')}
                  </div>
                </div>
                <Switch
                  checked={hasVerifier(resultVerifiers, 'file_exists')}
                  onCheckedChange={(checked) => onToggleVerifier('file_exists', checked)}
                />
              </div>

              {hasVerifier(resultVerifiers, 'file_exists') && (
                <div className="mt-3">
                  <Input
                    value={verificationFilePath}
                    onChange={(event) => onVerificationFilePathChange(event.target.value)}
                    placeholder={t('settingsTasks.editor.result.fileExistsPlaceholder')}
                  />
                </div>
              )}
            </div>
          </div>
        </FieldGroup>

        <div className="flex items-center justify-between border-b border-border/45 px-1 py-3 last:border-b-0">
          <div>
            <div className="text-sm font-medium text-foreground">{t('settingsTasks.editor.result.notifyMissedRunLabel')}</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              {t('settingsTasks.editor.result.notifyMissedRunDescription')}
            </div>
          </div>
          <Switch checked={notifyOnMissedRun} onCheckedChange={onNotifyOnMissedRunChange} />
        </div>

        <div className="flex items-center justify-between border-b border-border/45 px-1 py-3 last:border-b-0">
          <div>
            <div className="text-sm font-medium text-foreground">{t('settingsTasks.editor.result.aiCanExitLabel')}</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              {t('settingsTasks.editor.result.aiCanExitDescription')}
            </div>
          </div>
          <Switch checked={aiCanExit} onCheckedChange={onAiCanExitChange} />
        </div>
      </div>
    </div>
  )
}
