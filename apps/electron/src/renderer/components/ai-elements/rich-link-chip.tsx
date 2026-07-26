import * as React from 'react'
import type { ExtraProps } from 'react-markdown'
import {
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Github,
  Globe2,
  Presentation,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSessionWebPreview } from '@/hooks/useSessionWebPreview'
import { isHtmlFilePath } from '@/components/session/session-web-preview-state'
import {
  createRichLinkPresentation,
  type RichLinkKind,
} from './rich-link-presentation'

interface RichLinkChipProps extends React.AnchorHTMLAttributes<HTMLAnchorElement>, ExtraProps {
  basePath?: string
}

interface RichLinkVisual {
  icon: LucideIcon
  iconClassName?: string
}

const LINK_VISUALS: Record<RichLinkKind, RichLinkVisual> = {
  github: {
    icon: Github,
    iconClassName: 'fill-current',
  },
  document: {
    icon: FileText,
  },
  spreadsheet: {
    icon: FileSpreadsheet,
  },
  presentation: {
    icon: Presentation,
  },
  image: {
    icon: FileImage,
  },
  video: {
    icon: FileVideo,
  },
  code: {
    icon: FileCode2,
  },
  'local-file': {
    icon: FileText,
  },
  web: {
    icon: Globe2,
  },
}

function extractLinkText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractLinkText).join('')
  if (React.isValidElement(node)) {
    return extractLinkText((node.props as { children?: React.ReactNode }).children)
  }
  return ''
}

const CHIP_CLASS_NAME = cn(
  'not-prose relative mx-[1px] inline-flex max-w-[min(100%,34rem)] items-center gap-1.5 align-[-0.2em]',
  'rounded-md px-2.5 py-1 text-[0.92em] font-medium leading-[1.35] no-underline',
  'shadow-[0_1px_2px_hsl(var(--kila-shadow-low)/0.08)] transition-[background-color,color,box-shadow,transform] duration-150',
  'hover:no-underline hover:shadow-[0_2px_6px_hsl(var(--kila-shadow-low)/0.12)] active:translate-y-px',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background',
)

/** Codex 风格富链接：按 GitHub、在线文档和本地输出文件展示图标与紧凑标签高亮。 */
export const RichLinkChip = React.memo(function RichLinkChip({
  href = '',
  children,
  className,
  basePath,
  node: _node,
  ...linkProps
}: RichLinkChipProps): React.ReactElement {
  const {
    openExternal,
    openHtmlFileInSessionBrowser,
    openUrlInSessionBrowser,
  } = useSessionWebPreview()
  const text = extractLinkText(children).trim()
  const presentation = React.useMemo(
    () => createRichLinkPresentation(href, text, basePath),
    [basePath, href, text],
  )
  const visual = LINK_VISUALS[presentation.kind]
  const Icon = visual.icon
  const content = (
    <>
      <Icon className={cn("size-[1.05em] shrink-0", visual.iconClassName)} aria-hidden />
      <span className="min-w-0 truncate">{presentation.label}</span>
      {presentation.meta && presentation.kind !== 'github' && (
        <span className="hidden shrink-0 text-[0.78em] font-normal opacity-60 sm:inline">
          {presentation.meta}
        </span>
      )}
    </>
  )
  const mergedClassName = cn(
    CHIP_CLASS_NAME,
    'bg-kila-link-chip-background text-kila-link-chip-foreground',
    'hover:bg-kila-link-chip-hover',
    className,
  )

  if (presentation.isLocalFile && presentation.filePath) {
    const filePath = presentation.filePath
    const handleLocalFileClick = (): void => {
      const action = isHtmlFilePath(filePath)
        ? openHtmlFileInSessionBrowser(filePath)
        : window.electronAPI.previewFile(filePath)

      void Promise.resolve(action).catch((error: unknown) => {
        console.error('[RichLinkChip] 预览输出文件失败:', error)
      })
    }

    return (
      <button
        type="button"
        className={mergedClassName}
        onClick={handleLocalFileClick}
        title={filePath}
      >
        {content}
      </button>
    )
  }

  if (presentation.isExternal && /^https?:\/\//i.test(href)) {
    return (
      <a
        {...linkProps}
        href={href}
        className={mergedClassName}
        title={href}
        onClick={(event) => {
          event.preventDefault()
          void openUrlInSessionBrowser(href).catch(() => {
            void openExternal(href)
          })
        }}
      >
        {content}
      </a>
    )
  }

  return (
    <span className={mergedClassName} title={href || undefined}>
      {content}
    </span>
  )
})
