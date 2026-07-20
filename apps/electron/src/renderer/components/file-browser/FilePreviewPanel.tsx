import * as React from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AlertCircle, Code, ExternalLink, Eye, FileImage, FileText, Loader2 } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { CodeBlock } from '@kila/ui'
import { CodeViewer, getLanguageDisplayName, resolveCodeLanguage } from '@/components/code-workbench'
import type { InlineFilePreview } from '@kila/shared'
import type { SessionWorkbenchViewMode } from '@/components/session/session-file-workbench-state'
import { resolveWorkbenchViewModes } from '@/components/session/session-file-workbench-state'

interface FilePreviewPanelProps {
  filePath: string | null
  viewMode?: SessionWorkbenchViewMode
  onViewModeChange?: (mode: SessionWorkbenchViewMode) => void
}

export const FilePreviewPanel = React.memo(function FilePreviewPanel({
  filePath,
  viewMode = 'preview',
  onViewModeChange,
}: FilePreviewPanelProps): React.ReactElement {
  const [preview, setPreview] = React.useState<InlineFilePreview | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [reloadVersion, setReloadVersion] = React.useState(0)
  const requestGenerationRef = React.useRef(0)

  React.useEffect(() => {
    const requestGeneration = ++requestGenerationRef.current
    if (!filePath) {
      setPreview(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setPreview(null)
    window.electronAPI.readFilePreview(filePath)
      .then((result) => {
        if (requestGeneration !== requestGenerationRef.current) return
        setPreview(result)
      })
      .catch((error) => {
        if (requestGeneration !== requestGenerationRef.current) return
        console.error('[FilePreviewPanel] 加载预览失败:', error)
        setPreview({
          filePath,
          filename: filePath.split('/').pop() || filePath,
          extension: '',
          size: 0,
          kind: 'error',
          errorMessage: error instanceof Error ? error.message : '预览加载失败',
        })
      })
      .finally(() => {
        if (requestGeneration === requestGenerationRef.current) setLoading(false)
      })

    return () => {
      if (requestGeneration === requestGenerationRef.current) {
        requestGenerationRef.current += 1
      }
    }
  }, [filePath, reloadVersion])

  if (!filePath) {
    return (
      <EmptyState
        icon={<FileText className="size-8" />}
        title="选择一个文件"
        description="在文件标签中点击任意文件，这里会显示内联预览。"
      />
    )
  }

  if (loading && !preview) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          正在加载预览...
        </div>
      </div>
    )
  }

  if (!preview) {
    return (
      <EmptyState
        icon={<AlertCircle className="size-8" />}
        title="预览不可用"
        description="当前文件尚未加载到预览面板。"
        action={(
          <Button type="button" variant="outline" size="sm" onClick={() => setReloadVersion((value) => value + 1)}>
            重试
          </Button>
        )}
      />
    )
  }

  if (preview.kind === 'error') {
    return (
      <EmptyState
        icon={<AlertCircle className="size-8" />}
        title="预览失败"
        description={preview.errorMessage ?? '读取文件预览时发生错误。'}
        action={(
          <Button type="button" variant="outline" size="sm" onClick={() => setReloadVersion((value) => value + 1)}>
            重试
          </Button>
        )}
      />
    )
  }

  const language = resolveCodeLanguage(preview.filePath, preview.extension)

  return (
    <div className="flex h-full min-h-0 flex-col bg-background/45">
      <div className="relative z-10 mx-2 mt-2 flex items-center gap-2 rounded-xl bg-[hsl(var(--kila-panel-surface-raised)/0.88)] px-3 py-2 shadow-[0_1px_2px_hsl(var(--kila-shadow-low)/0.08),0_8px_24px_hsl(var(--kila-shadow-low)/0.06)] backdrop-blur-xl">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-xs font-medium text-foreground">{preview.filename}</div>
            {(preview.kind === 'code' || preview.kind === 'text' || preview.kind === 'markdown') && (
              <span className="shrink-0 rounded-md bg-muted/55 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground/75">
                {getLanguageDisplayName(language)}
              </span>
            )}
            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/55">{formatFileSize(preview.size)}</span>
          </div>
          <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/65">{preview.filePath}</div>
        </div>
        <PreviewModeSwitch
          preview={preview}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => window.electronAPI.previewFile(preview.filePath).catch(console.error)}
          aria-label={`在独立窗口打开 ${preview.filename}`}
          title="在独立窗口打开"
        >
          <ExternalLink className="size-3.5" />
        </Button>
      </div>

      <PreviewBody preview={preview} viewMode={viewMode} />
    </div>
  )
}) as (props: FilePreviewPanelProps) => React.ReactElement

function PreviewModeSwitch({
  preview,
  viewMode,
  onViewModeChange,
}: {
  preview: InlineFilePreview
  viewMode: SessionWorkbenchViewMode
  onViewModeChange?: (mode: SessionWorkbenchViewMode) => void
}): React.ReactElement | null {
  const supportedModes = resolveWorkbenchViewModes(preview.kind)
  if (!onViewModeChange || supportedModes.length <= 1) {
    return null
  }

  return (
    <div className="inline-flex items-center rounded-lg bg-muted/45 p-0.5 shadow-[inset_0_0_0_1px_hsl(var(--foreground)/0.035)]">
      {supportedModes.map((mode) => (
        <button
          key={mode}
          type="button"
          className={
            mode === viewMode
              ? 'rounded-md bg-background/90 px-3 py-1 text-xs font-medium text-foreground shadow-sm'
              : 'rounded-lg px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground'
          }
          onClick={() => onViewModeChange(mode)}
        >
          <span className="inline-flex items-center gap-1">
            {mode === 'preview' ? <Eye className="size-3.5" /> : <Code className="size-3.5" />}
            {mode === 'preview' ? 'Preview' : 'Code'}
          </span>
        </button>
      ))}
    </div>
  )
}

const PreviewBody = React.memo(function PreviewBody({
  preview,
  viewMode,
}: {
  preview: InlineFilePreview
  viewMode: SessionWorkbenchViewMode
}): React.ReactElement {
  if (viewMode === 'code' && (preview.kind === 'markdown' || preview.kind === 'code' || preview.kind === 'text')) {
    return renderCodePreview(preview.filePath, preview.extension, preview.textContent)
  }

  if (preview.kind === 'image' && preview.dataUrl) {
    return (
      <div className="mx-2 mb-2 mt-2 flex flex-1 items-center justify-center rounded-xl bg-muted/20 p-4 shadow-[0_8px_24px_hsl(var(--kila-shadow-low)/0.05)]">
        <img src={preview.dataUrl} alt={preview.filename} className="max-h-full max-w-full rounded-lg object-contain" />
      </div>
    )
  }

  if (preview.kind === 'pdf' && preview.dataUrl) {
    return (
      <iframe
        title={preview.filename}
        src={preview.dataUrl}
        className="h-full w-full flex-1 border-0 bg-muted/10"
      />
    )
  }

  if (preview.kind === 'markdown') {
    return (
      <div className="mx-2 mb-2 mt-2 min-h-0 flex-1 overflow-hidden rounded-xl bg-[hsl(var(--kila-panel-surface))] shadow-[0_1px_2px_hsl(var(--kila-shadow-low)/0.08),0_12px_32px_hsl(var(--kila-shadow-low)/0.05)]">
        <ScrollArea className="h-full">
          <div className="prose prose-sm max-w-none select-text px-5 py-4 dark:prose-invert">
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                pre: ({ children: preChildren }) => <CodeBlock>{preChildren}</CodeBlock>,
              }}
            >
              {preview.textContent ?? ''}
            </Markdown>
          </div>
        </ScrollArea>
      </div>
    )
  }

  if (preview.kind === 'code' || preview.kind === 'text') {
    return renderCodePreview(preview.filePath, preview.extension, preview.textContent)
  }

  if (preview.kind === 'too_large') {
    return (
      <EmptyState
        icon={<FileImage className="size-8" />}
        title="文件过大"
        description={preview.errorMessage ?? '当前文件超过了内联预览大小限制。'}
      />
    )
  }

  if (preview.kind === 'unsupported') {
    return (
      <EmptyState
        icon={<FileText className="size-8" />}
        title="暂不支持内联预览"
        description="可以点击右上角按钮，在独立窗口中继续查看。"
      />
    )
  }

  return (
    <EmptyState
      icon={<AlertCircle className="size-8" />}
      title="预览失败"
      description={preview.errorMessage ?? '读取文件预览时发生错误。'}
    />
  )
})

function renderCodePreview(filePath: string, extension: string, textContent: string | undefined): React.ReactElement {
  return (
    <div className="mx-2 mb-2 mt-2 min-h-0 flex-1 overflow-hidden rounded-xl shadow-[0_1px_2px_hsl(var(--kila-shadow-low)/0.08),0_12px_32px_hsl(var(--kila-shadow-low)/0.05)]">
      <CodeViewer
        code={textContent ?? ''}
        language={resolveCodeLanguage(filePath, extension)}
        ariaLabel={`${filePath} 代码内容`}
      />
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / (1024 ** unitIndex)
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactElement
  title: string
  description: string
  action?: React.ReactNode
}): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="flex max-w-[240px] flex-col items-center gap-2 text-center text-muted-foreground">
        {icon}
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-xs leading-5">{description}</div>
        {action}
      </div>
    </div>
  )
}
