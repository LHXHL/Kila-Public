/**
 * AboutSettings - 关于页面
 *
 * 展示应用版本号，通过 GitHub Releases API 检查更新。
 */

import * as React from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { AlertCircle, CheckCircle2, Download, ExternalLink, Info, Loader2, RefreshCw } from 'lucide-react'
import { SettingsCard } from './primitives'
import { Button } from '@/components/ui/button'
import type { GitHubRelease } from '@kila/shared'
import { getStatusToneClasses } from '@/lib/theme/status-tone'

declare const __APP_VERSION__: string
const APP_VERSION = __APP_VERSION__

const GITHUB_RELEASES_URL = 'https://github.com/LHXHL/Kila-Public/releases'
const GITHUB_PROFILE_URL = 'https://github.com/LHXHL'

/** 语义化版本比较：>0 表示 a 更新，<0 表示 b 更新，0 表示相同 */
function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

type CheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'up-to-date' }
  | { status: 'available'; release: GitHubRelease }
  | { status: 'error'; message: string }

export function AboutSettings(): React.ReactElement {
  const { t } = useTranslation()
  const [checkState, setCheckState] = React.useState<CheckState>({ status: 'idle' })

  const handleCheck = async (): Promise<void> => {
    setCheckState({ status: 'checking' })
    try {
      const release = await window.electronAPI.getLatestRelease()
      if (!release) {
        setCheckState({ status: 'error', message: t('settings.about.fetchFailed') })
        return
      }
      if (compareSemver(release.tag_name, APP_VERSION) > 0) {
        setCheckState({ status: 'available', release })
      } else {
        setCheckState({ status: 'up-to-date' })
      }
    } catch (err) {
      setCheckState({ status: 'error', message: err instanceof Error ? err.message : t('settings.about.networkError') })
    }
  }

  const handleGoToRelease = (release: GitHubRelease): void => {
    window.electronAPI.openExternal(release.html_url || GITHUB_RELEASES_URL)
  }


  return (
    <div className="w-full">
      <div className="flex items-center gap-2 mb-6">
        <Info className="h-4 w-4" />
        <h2 className="text-[15px] font-bold">{t('settings.about.title')}</h2>
      </div>

      <SettingsCard divided={false} className="p-6">
        <div className="space-y-6">
          <div>
            <h3 className="text-[14px] font-bold text-foreground">{t('settings.about.title')}</h3>
            <p className="text-[13px] text-muted-foreground mt-2 tracking-wide font-medium">
              <Trans
                i18nKey="settings.about.tagline"
                components={{
                  author: (
                    <button
                      type="button"
                      className="font-semibold text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-primary hover:decoration-primary/50"
                      onClick={() => void window.electronAPI.openExternal(GITHUB_PROFILE_URL)}
                    />
                  ),
                }}
              />
            </p>
          </div>

          {/* 版本 + 更新检查 */}
          <div className="space-y-3">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h3 className="text-[13px] font-bold text-muted-foreground">{t('settings.about.currentVersion')}</h3>
                <p className="font-mono text-[15px] font-bold text-foreground tracking-wider mt-1">{APP_VERSION}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={checkState.status === 'checking'}
                onClick={() => void handleCheck()}
              >
                {checkState.status === 'checking'
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <RefreshCw className="h-4 w-4" />}
                {t('settings.about.checkUpdate')}
              </Button>
            </div>

            {checkState.status === 'up-to-date' && (
              <div className="flex items-center gap-2 rounded-md bg-muted/35 px-3 py-2 text-[13px]">
                <CheckCircle2 className={`h-4 w-4 shrink-0 ${getStatusToneClasses('success').icon}`} />
                <span className="font-medium text-foreground">{t('settings.about.upToDate')}</span>
              </div>
            )}

            {checkState.status === 'available' && (
              <div className="flex items-center justify-between gap-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
                <div className="flex items-center gap-2 text-[13px]">
                  <Download className="h-4 w-4 shrink-0 text-primary" />
                  <span className="font-semibold text-primary">
                    {t('settings.about.newVersion', { version: checkState.release.tag_name })}
                  </span>
                </div>
                <Button
                  size="sm"
                  className="gap-1.5 text-[13px]"
                  onClick={() => handleGoToRelease(checkState.release)}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t('settings.about.download')}
                </Button>
              </div>
            )}

            {checkState.status === 'error' && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-[13px]">
                <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
                <span className="text-destructive">{checkState.message}</span>
              </div>
            )}
          </div>
        </div>
      </SettingsCard>

    </div>
  )
}
