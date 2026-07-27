/**
 * ProxySettings - 代理配置页
 *
 * 全局代理配置，支持系统代理自动检测和手动配置。
 * 所有 AI API 请求都会通过代理发送。
 */

import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Globe, Loader2, CheckCircle2, XCircle, RefreshCw } from 'lucide-react'
import {
  SettingsSection,
  SettingsCard,
  SettingsToggle,
  SettingsInput,
} from './primitives'
import { proxyConfigAtom, loadProxyConfigAtom, updateProxyConfigAtom } from '@/atoms/proxy-atoms'
import { cn } from '@/lib/utils'
import { getStatusToneClasses } from '@/lib/theme/status-tone'
import type { ProxyMode } from '@kila/shared'

export function ProxySettings(): React.ReactElement {
  const { t } = useTranslation()
  const [config, setConfig] = useAtom(proxyConfigAtom)
  const loadProxyConfig = useSetAtom(loadProxyConfigAtom)
  const updateProxyConfig = useSetAtom(updateProxyConfigAtom)
  const successTone = getStatusToneClasses('success')

  const [detecting, setDetecting] = React.useState(false)
  const [detectResult, setDetectResult] = React.useState<{ success: boolean; message: string } | null>(null)

  // 初始化加载配置
  React.useEffect(() => {
    loadProxyConfig()
  }, [loadProxyConfig])

  if (!config) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 size={24} className="animate-spin" />
        <span className="ml-2">{t('common.loading')}</span>
      </div>
    )
  }

  /** 更新代理配置（本地状态 + 持久化） */
  const handleUpdate = async (updates: Partial<typeof config>): Promise<void> => {
    const updated = { ...config, ...updates }
    setConfig(updated)
    try {
      await updateProxyConfig(updated)
    } catch (error) {
      console.error('[代理设置] 更新失败:', error)
    }
  }

  /** 检测系统代理 */
  const handleDetectSystemProxy = async (): Promise<void> => {
    setDetecting(true)
    setDetectResult(null)

    try {
      const result = await window.electronAPI.detectSystemProxy()
      setDetectResult({
        success: result.success,
        message: result.success
          ? t('settings.proxy.detected', { url: result.proxyUrl })
          : result.message,
      })
    } catch {
      setDetectResult({
        success: false,
        message: t('settings.proxy.detectFailed'),
      })
    } finally {
      setDetecting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* 代理开关 */}
      <SettingsSection
        title={t('settings.proxy.title')}
        description={t('settings.proxy.description')}
      >
        <SettingsCard>
          <SettingsToggle
            label={t('settings.proxy.enable')}
            description={t('settings.proxy.enableDescription')}
            checked={config.enabled}
            onCheckedChange={(enabled) => handleUpdate({ enabled })}
          />
        </SettingsCard>
      </SettingsSection>

      {/* 代理模式选择（仅在启用时显示） */}
      {config.enabled && (
        <SettingsSection title={t('settings.proxy.mode')}>
          <SettingsCard divided={false}>
            {/* 系统代理选项 */}
            <div
              className={cn(
                'flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50',
                config.mode === 'system' && 'bg-accent/10'
              )}
              onClick={() => handleUpdate({ mode: 'system' })}
            >
              <input
                type="radio"
                checked={config.mode === 'system'}
                onChange={() => handleUpdate({ mode: 'system' })}
                className="mt-0.5 w-4 h-4 accent-foreground"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Globe size={16} />
                  <span>{t('settings.proxy.systemMode')}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('settings.proxy.systemModeDescription')}
                </p>
                {config.mode === 'system' && (
                  <div className="mt-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDetectSystemProxy()
                      }}
                      disabled={detecting}
                      className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
                    >
                      {detecting ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <RefreshCw size={12} />
                      )}
                      <span>{t('settings.proxy.detectSystemProxy')}</span>
                    </button>
                    {detectResult && (
                      <div
                        className={cn(
                          'flex items-center gap-1.5 text-xs mt-2',
                          detectResult.success ? successTone.softText : 'text-muted-foreground'
                        )}
                      >
                        {detectResult.success ? (
                          <CheckCircle2 size={12} />
                        ) : (
                          <XCircle size={12} />
                        )}
                        <span>{detectResult.message}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 分隔线 */}
            <div className="border-b border-border/50" />

            {/* 手动配置选项 */}
            <div
              className={cn(
                'px-4 py-3 transition-colors hover:bg-muted/50',
                config.mode === 'manual' && 'bg-accent/10'
              )}
              onClick={() => handleUpdate({ mode: 'manual' })}
            >
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  checked={config.mode === 'manual'}
                  onChange={() => handleUpdate({ mode: 'manual' })}
                  className="mt-0.5 w-4 h-4 accent-foreground"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-foreground">{t('settings.proxy.manualMode')}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('settings.proxy.manualModeDescription')}
                  </p>
                </div>
              </div>
              {config.mode === 'manual' && (
                <div className="mt-3 ml-7">
                  <SettingsInput
                    label=""
                    value={config.manualUrl}
                    onChange={(value) => handleUpdate({ manualUrl: value })}
                    placeholder="http://127.0.0.1:7890"
                    description={t('settings.proxy.manualUrlHint')}
                  />
                </div>
              )}
            </div>
          </SettingsCard>
        </SettingsSection>
      )}
    </div>
  )
}
