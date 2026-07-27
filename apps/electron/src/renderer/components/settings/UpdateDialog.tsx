/**
 * UpdateDialog - 新版本通知弹窗
 *
 * 当检测到新版本时自动弹出，引导用户前往 GitHub Releases 下载。
 * 同一版本只弹一次，用户关闭后不再重复弹出。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'
import type { GitHubRelease } from '@kila/shared'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
import { updateStatusAtom } from '@/atoms/updater'
import { ReleaseNotesViewer } from './ReleaseNotesViewer'

const GITHUB_RELEASES_URL = 'https://github.com/LHXHL/Kila-Public/releases'

export function UpdateDialog(): React.ReactElement | null {
  const { t } = useTranslation()
  const updateStatus = useAtomValue(updateStatusAtom)
  const [open, setOpen] = React.useState(false)
  const [release, setRelease] = React.useState<GitHubRelease | null>(null)
  // 弹窗打开时锁定的版本号，不随 atom 变化而丢失
  const [dialogVersion, setDialogVersion] = React.useState<string | null>(null)
  // 记录已弹出过的版本号，同一版本不重复弹出
  const shownVersionRef = React.useRef<string | null>(null)

  // 当状态变为 available 且是新版本时，自动弹出
  React.useEffect(() => {
    if (
      updateStatus.status === 'available' &&
      updateStatus.version &&
      shownVersionRef.current !== updateStatus.version
    ) {
      const version = updateStatus.version
      shownVersionRef.current = version
      setDialogVersion(version)

      // 获取 Release 信息
      window.electronAPI
        .getReleaseByTag(`v${version}`)
        .then((r) => {
          if (r) setRelease(r)
        })
        .catch((err) => {
          console.error('[更新弹窗] 获取 Release 信息失败:', err)
        })

      setOpen(true)
    }
  }, [updateStatus.status, updateStatus.version])

  const handleGoToDownload = (e: React.MouseEvent): void => {
    e.preventDefault()
    const url = release?.html_url || GITHUB_RELEASES_URL
    window.electronAPI.openExternal(url)
  }

  if (!dialogVersion) return null

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('settings.update.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('settings.update.description', { version: dialogVersion })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Release Notes */}
        {release && (
          <div className="max-h-64 overflow-y-auto rounded-md border p-3">
            <ReleaseNotesViewer release={release} showHeader={false} compact />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>
            {t('settings.update.later')}
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleGoToDownload}>
            <ExternalLink className="h-4 w-4 mr-1.5" />
            {t('settings.about.download')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
