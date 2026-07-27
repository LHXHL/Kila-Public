/**
 * ReleaseNotesViewer - Release Notes 查看器
 *
 * 显示 GitHub Release 的发布说明（Markdown 格式）
 */

import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { GitHubRelease } from '@kila/shared'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Badge } from '@/components/ui/badge'
import { ExternalLink } from 'lucide-react'
import { CodeBlock } from '@kila/ui'
import { cn } from '@/lib/utils'

interface ReleaseNotesViewerProps {
  /** Release 数据 */
  release: GitHubRelease
  /** 是否显示标题（默认 true） */
  showHeader?: boolean
  /** 是否紧凑模式（默认 false） */
  compact?: boolean
}

/**
 * 格式化发布日期
 */
function formatReleaseDate(dateString: string, t: TFunction, language: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return t('settings.about.releasedToday')
  if (diffDays === 1) return t('settings.about.releasedYesterday')
  if (diffDays < 7) return t('settings.about.releasedDaysAgo', { count: diffDays })
  if (diffDays < 30) return t('settings.about.releasedWeeksAgo', { count: Math.floor(diffDays / 7) })

  // 超过 30 天，显示完整日期
  return date.toLocaleDateString(language, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/**
 * ReleaseNotesViewer 组件
 */
export function ReleaseNotesViewer({
  release,
  showHeader = true,
  compact = false,
}: ReleaseNotesViewerProps): React.ReactElement {
  const { t, i18n } = useTranslation()
  const releaseName = release.name || release.tag_name

  return (
    <div className="space-y-3">
      {/* 标题部分 */}
      {showHeader && (
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold truncate">
                {releaseName}
              </h3>
              {release.prerelease && (
                <Badge variant="secondary" className="text-xs">
                  {t('settings.about.prerelease')}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatReleaseDate(release.published_at, t, i18n.language)}
            </p>
          </div>

          {/* GitHub 链接 */}
          <a
            href={release.html_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors shrink-0"
            title={t('settings.about.viewOnGitHub')}
          >
            <ExternalLink className="h-3 w-3" />
            GitHub
          </a>
        </div>
      )}

      {/* Release Notes 内容 */}
      <div
        className={cn(
          'prose dark:prose-invert max-w-none',
          compact ? 'text-xs prose-sm' : 'text-sm',
          'prose-p:my-1.5 prose-p:leading-[1.6] prose-li:leading-[1.6]',
          '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0'
        )}
      >
        {release.body ? (
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              pre: ({ children: preChildren }) => <CodeBlock>{preChildren}</CodeBlock>,
              a: ({ href, children: linkChildren, ...linkProps }) => (
                <a
                  {...linkProps}
                  href={href ?? undefined}
                  onClick={(e) => {
                    e.preventDefault()
                    if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
                      window.electronAPI.openExternal(href)
                    }
                  }}
                  title={href ?? undefined}
                >
                  {linkChildren}
                </a>
              ),
            }}
          >
            {release.body}
          </Markdown>
        ) : (
          <p className="text-muted-foreground italic">{t('settings.about.noReleaseNotes')}</p>
        )}
      </div>
    </div>
  )
}
