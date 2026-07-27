/**
 * ToolAccordionItem — 单个工具的折叠展示
 *
 * 对标 LobeHub Tool/index.tsx：
 * - 标题行：工具图标 + 名称 + 参数摘要 + 状态 + 执行计时
 * - 展开内容：输入参数 + 结果 + 图片附件
 * - 自控 grid 动画，不依赖 Radix Accordion（确保丝滑过渡）
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Download, ChevronDown, Loader2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { copyPlainText } from '@/lib/clipboard'
import { useAttachmentImage } from '@/hooks/use-attachment-image'
import {
  StatusIcon,
  formatElapsed,
  getToolActivityTarget,
  getToolDisplayName,
  getToolIcon,
} from '../ToolActivityItem'
import { useProcessDisclosure } from '../use-process-disclosure'
import {
  PROCESS_TONE_STYLE,
  PROCESS_TONE_SOFT_STYLE,
  PROCESS_TONE_FADE_STYLE,
  getRenderablePayloadText,
  TOOL_PAYLOAD_MAX_CHARS,
  getFoldedPayloadText,
  normalizePayloadText,
} from '../agent-messages-utils'
import { getActivityStatus, type BackgroundTask, type ToolProcessEntry } from '@/atoms/agent-atoms'

// ===== FoldablePayloadBlock =====

function FoldablePayloadBlock({
  label,
  content,
  className,
}: {
  label: string
  content: unknown
  className: string
}): React.ReactElement {
  const { t, i18n } = useTranslation()
  const [expanded, setExpanded] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const preview = React.useMemo(
    () => getRenderablePayloadText(content, TOOL_PAYLOAD_MAX_CHARS),
    [content],
  )
  const { visibleText, hiddenLineCount } = React.useMemo(
    () => getFoldedPayloadText(preview.text),
    [preview.text],
  )
  const canFold = hiddenLineCount > 0
  const displayText = canFold && !expanded ? visibleText : preview.text
  const hasMore = preview.truncatedCharCount > 0

  React.useEffect(() => {
    setExpanded(false)
    setCopied(false)
  }, [content])

  const handleCopy = (): void => {
    void copyPlainText(normalizePayloadText(content)).then(() => {
      setCopied(true)
      toast.success(t('agent.tool.fullOutputCopied'))
      window.setTimeout(() => setCopied(false), 1500)
    }).catch((error) => {
      console.error('[ToolAccordionItem] 复制完整输出失败:', error)
      toast.error(t('agent.tool.copyFullOutputFailed'))
    })
  }

  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <pre className={className}>{displayText}</pre>
      <div className="flex flex-wrap items-center gap-3 text-[10px]">
        {canFold && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="font-medium text-muted-foreground transition-colors hover:text-foreground"
            style={PROCESS_TONE_STYLE}
          >
            {expanded ? t('agent.tool.collapseLines') : t('agent.tool.expandLines', { count: hiddenLineCount })}
          </button>
        )}
        <button type="button" className="text-muted-foreground hover:text-foreground hover:underline" onClick={handleCopy}>
          {copied ? t('agent.tool.fullOutputCopiedLabel') : t('agent.tool.copyFullOutput')}
        </button>
        {hasMore && (
          <span className="text-muted-foreground/70">
            {t('agent.tool.previewOmittedChars', {
              count: preview.truncatedCharCount,
              chars: preview.truncatedCharCount.toLocaleString(i18n.language),
            })}
          </span>
        )}
      </div>
    </div>
  )
}

// ===== InlineImage =====

function InlineImage({ attachment }: { attachment: { localPath: string; filename: string; mediaType: string } }): React.ReactElement {
  const { t } = useTranslation()
  const { imageSrc, loadState, retry, markError } = useAttachmentImage(
    attachment.localPath,
    attachment.mediaType,
  )

  const handleSave = React.useCallback((): void => {
    void window.electronAPI.saveImageAs(attachment.localPath, attachment.filename).catch((error) => {
      console.error('[ToolAccordionImage] 保存附件失败:', error)
    })
  }, [attachment.localPath, attachment.filename])

  if (loadState === 'loading') {
    return (
      <div
        className="size-[200px] rounded-lg bg-muted/30 animate-pulse shrink-0"
        role="status"
        aria-label={t('agent.attachment.loading', { filename: attachment.filename })}
      />
    )
  }

  if (loadState === 'error' || !imageSrc) {
    return (
      <div className="flex size-[200px] shrink-0 flex-col items-center justify-center gap-2 rounded-lg bg-destructive/5 px-3 text-center text-destructive/75">
        <XCircle className="size-5" />
        <span className="line-clamp-2 text-[11px]">{t('agent.attachment.loadFailed', { filename: attachment.filename })}</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={retry} className="rounded-md bg-background/70 px-2 py-1 text-[10px] text-foreground/70 hover:text-foreground">
            {t('common.retry')}
          </button>
          <button type="button" onClick={handleSave} className="rounded-md bg-background/70 px-2 py-1 text-[10px] text-foreground/70 hover:text-foreground">
            {t('agent.attachment.saveAs')}
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="relative group inline-block">
      <img
        src={imageSrc}
        alt={attachment.filename}
        className="size-[200px] rounded-lg object-cover shrink-0"
        onError={markError}
      />
      <button
        type="button"
        onClick={handleSave}
        className="absolute bottom-1.5 right-1.5 p-1 rounded-md bg-black/50 text-white opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-black/70"
        aria-label={t('agent.attachment.saveImage')}
        title={t('agent.attachment.saveImage')}
      >
        <Download className="size-3" />
      </button>
    </div>
  )
}

// ===== Inspector 标题行 =====

function ToolInspector({
  activity,
  status,
  durationLabel,
  isToolCalling,
  expanded,
}: {
  activity: ToolProcessEntry['activity']
  status: ReturnType<typeof getActivityStatus>
  durationLabel: string | null
  isToolCalling: boolean
  expanded: boolean
}): React.ReactElement {
  const ToolIcon = getToolIcon(activity.toolName)
  const label = getToolDisplayName(activity.toolName)
  const target = getToolActivityTarget(activity)
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div
        className="flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/80"
        style={PROCESS_TONE_SOFT_STYLE}
      >
        <ToolIcon className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          <span
            className="shrink-0 truncate text-[13px] text-muted-foreground"
            style={PROCESS_TONE_STYLE}
          >
            {label}
          </span>
          {target && (
            <span className="truncate text-[12px] text-muted-foreground/60" style={PROCESS_TONE_FADE_STYLE}>
              {target}
            </span>
          )}
        </div>
      </div>
      <div className="ml-1 flex shrink-0 items-center gap-1.5 text-muted-foreground">
        <StatusIcon status={status} toolName={label} />
        {isToolCalling && !durationLabel && (
          <Loader2 className="size-3 animate-spin text-muted-foreground/50" />
        )}
        {durationLabel && (
          <span className="text-[11px] font-mono tabular-nums text-muted-foreground/60">
            {durationLabel}
          </span>
        )}
        <ChevronDown
          className={cn(
            'size-3.5 text-muted-foreground/40 transition-transform duration-300',
            expanded && 'rotate-180',
          )}
        />
      </div>
    </div>
  )
}

// ===== ToolAccordionItem 主组件 =====

interface ToolAccordionItemProps {
  entry: ToolProcessEntry
  backgroundTask?: BackgroundTask
  sessionPath?: string | null
}

export function ToolAccordionItem({
  entry,
  backgroundTask,
  sessionPath,
}: ToolAccordionItemProps): React.ReactElement {
  const { t } = useTranslation()
  const activity = React.useMemo(() => backgroundTask
    ? { ...entry.activity, intent: backgroundTask.intent ?? entry.activity.intent, isBackground: true }
    : entry.activity, [backgroundTask, entry.activity])
  const status = getActivityStatus(activity)
  const hasBody = activity.imageAttachments?.length
    || Object.keys(activity.input).length > 0
    || activity.partialResult
    || activity.result
  const renderedResult = activity.result ?? activity.partialResult

  const { open, setOpen, durationLabel } = useProcessDisclosure({
    hasBody: Boolean(hasBody),
    running: status === 'running',
    elapsedSeconds: activity.elapsedSeconds ?? backgroundTask?.elapsedSeconds,
  })


  if (!hasBody) {
    return (
      <div className="flex items-center gap-2 rounded-lg px-2 py-1 text-left">
        <ToolInspector
          activity={activity}
          status={status}
          durationLabel={durationLabel}
          isToolCalling={status === 'running'}
          expanded={false}
        />
      </div>
    )
  }
  return (
    <div className="rounded-lg">
      {/* 标题行 */}
      <button
        type="button"
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left cursor-pointer transition-colors duration-200',
          'hover:bg-muted/25',
        )}
        onClick={() => setOpen((value) => !value)}
      >
        <ToolInspector
          activity={activity}
          status={status}
          durationLabel={durationLabel}
          isToolCalling={status === 'running'}
          expanded={open}
        />
      </button>

      {/* 折叠时不挂载详情 DOM，避免隐藏的大文本继续参与布局和重渲染。 */}
      {open && (
        <div className="animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="px-8 pb-2 pt-0.5 space-y-2.5">
            {activity.imageAttachments && activity.imageAttachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {activity.imageAttachments.map((img, i) => (
                  <InlineImage key={`${img.localPath}-${i}`} attachment={img} />
                ))}
              </div>
            )}
            {Object.keys(activity.input).length > 0 && (
              <FoldablePayloadBlock
                label={t('agent.tool.input')}
                content={activity.input}
                className="overflow-x-auto rounded-md border border-border/20 bg-muted/10 p-2 text-[11px] text-foreground/68"
              />
            )}
            {renderedResult && (
              <FoldablePayloadBlock
                label={t('agent.tool.result')}
                content={renderedResult}
                className={cn(
                  'overflow-x-auto rounded-md border p-2 text-[11px]',
                  activity.isError
                    ? 'border-destructive/25 bg-destructive/5 text-destructive/78'
                    : 'border-border/20 bg-muted/10 text-foreground/68',
                )}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
