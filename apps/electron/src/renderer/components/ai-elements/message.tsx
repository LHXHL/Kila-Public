/**
 * AI Elements - 消息组件原语
 *
 * 简化迁移自 kila-frontend 的 ai-elements/message.tsx，
 * 保留核心消息展示组件，适配 Electron + Jotai 架构。
 *
 * 包含：
 * - Message — 根容器，`from` 属性区分 user/assistant
 * - MessageHeader — 头像 + 模型名
 * - MessageContent — 内容区域
 * - MessageActions — 操作按钮容器
 * - MessageAction — 单个操作按钮（可选 Tooltip）
 * - MessageResponse — react-markdown 渲染
 * - UserMessageContent — 长文本自动折叠
 * - MessageLoading — 3 个弹跳点加载动画
 * - MessageStopped — "已停止生成" 状态标记
 * - StreamingIndicator — 流式呼吸脉冲点
 */

import * as React from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { ChevronDown, ChevronUp, Paperclip, FileText, Wand2, Server, Download, Brain, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatGlobalSkillMentionLabel } from '@kila/shared'
import { shouldInspectMermaidCodeBlock, shouldRenderMermaidCodeBlock } from '@/lib/mermaid-detection'
import { Button } from '@/components/ui/button'
import { useElementWidth } from '@/hooks/use-element-width'
import { useAttachmentImage } from '@/hooks/use-attachment-image'
import { useSessionWebPreview } from '@/hooks/useSessionWebPreview'
import { getElementFontSpec } from '@/lib/pretext/font-spec'
import { normalizeMeasurementText } from '@/lib/pretext/measurement-text'
import { measurePreWrapText } from '@/lib/pretext/text-layout'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { marked } from 'marked'
import remend from 'remend'
import {
  CodeBlock,
  useStreamQueue,
  resolveBlockAnimationMeta,
  rehypeStreamAnimated,
  useStablePlugins,
  isSamePlugins,
} from '@kila/ui'
import type { BlockInfo, StreamAnimatedOptions } from '@kila/ui'
import type { Pluggable, PluggableList } from 'unified'
import type { Options as MarkdownOptions } from 'react-markdown'
import { FilePathChip, isAbsoluteFilePath, isRelativeFilePath } from './file-path-chip'
import { LazyMermaidBlock } from './LazyMermaidBlock'
import type { HTMLAttributes, ComponentProps, ReactNode } from 'react'
import type { FileAttachment } from '@kila/shared'

// ===== Message 根容器 =====

type MessageRole = 'user' | 'assistant' | 'system'

const USER_MESSAGE_MAX_CLASS = 'group-[.is-user]:max-w-[min(100%,42rem)]'
const ASSISTANT_MESSAGE_MAX_CLASS = 'group-[.is-assistant]:max-w-[min(100%,58rem)]'
const SYSTEM_MESSAGE_MAX_CLASS = 'group-[.is-system]:max-w-[min(100%,58rem)]'

interface MessageProps extends HTMLAttributes<HTMLDivElement> {
  /** 消息发送者角色 */
  from: MessageRole
}

/** 消息根容器，assistant 左侧 / user 右侧 */
export function Message({ className, from, ...props }: MessageProps): React.ReactElement {
  return (
    <div
      className={cn(
        'group flex w-full flex-col gap-0.5 rounded-[10px] px-0 py-3',
        from === 'user' ? 'is-user items-end text-right' : from === 'assistant' ? 'is-assistant items-start text-left' : 'is-system items-start text-left',
        className
      )}
      {...props}
    />
  )
}

// ===== MessageHeader 头像 + 模型名 =====

interface MessageHeaderProps extends HTMLAttributes<HTMLDivElement> {
  /** 模型名称 */
  model?: string
  /** 头像元素 */
  logo?: ReactNode
  /** 消息时间戳 */
  time?: string
}

/** 消息头部（user 时自动隐藏） */
export function MessageHeader({
  model,
  logo,
  time,
  className,
  children,
  ...props
}: MessageHeaderProps): React.ReactElement {
  return (
    <div
      className={cn(
        'mb-2.5 flex items-start gap-2.5 self-start',
        'group-[.is-user]:hidden',
        className
      )}
      {...props}
    >
      {logo && (
        <div className="flex size-[35px] shrink-0 items-center justify-center overflow-hidden rounded-[25%]">
          {logo}
        </div>
      )}
      <div className="flex flex-col justify-between h-[35px]">
        {model && <span className="text-sm font-medium text-foreground/60 leading-none">{model}</span>}
        {time && <span className="text-[10px] text-foreground/[0.38] leading-none">{time}</span>}
      </div>
      {children}
    </div>
  )
}

// ===== MessageContent 内容区域 =====

type MessageContentProps = HTMLAttributes<HTMLDivElement>

/**
 * 消息内容区域
 * - user 消息：右侧堆叠
 * - assistant 消息：左侧堆叠
 */
export function MessageContent({
  children,
  className,
  ...props
}: MessageContentProps): React.ReactElement {
  return (
    <div
      className={cn(
        'flex w-full max-w-full min-w-0 flex-col gap-2 overflow-hidden',
        USER_MESSAGE_MAX_CLASS,
        ASSISTANT_MESSAGE_MAX_CLASS,
        SYSTEM_MESSAGE_MAX_CLASS,
        'group-[.is-user]:items-end group-[.is-user]:self-end group-[.is-user]:text-foreground',
        'group-[.is-assistant]:items-start group-[.is-assistant]:self-start group-[.is-assistant]:text-foreground',
        'group-[.is-system]:items-start group-[.is-system]:self-start',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

// ===== MessageActions 操作按钮容器 =====

type MessageActionsProps = ComponentProps<'div'>

/** 操作按钮容器（复制、删除等），默认显示淡色，hover 时加深 */
export function MessageActions({
  className,
  children,
  ...props
}: MessageActionsProps): React.ReactElement {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 text-muted-foreground/60 transition-colors duration-200 hover:text-muted-foreground/90',
        'group-[.is-user]:justify-end group-[.is-user]:self-end',
        'group-[.is-assistant]:justify-start group-[.is-assistant]:self-start',
        'group-[.is-system]:justify-start group-[.is-system]:self-start',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

// ===== MessageAction 单个操作按钮 =====

interface MessageActionProps extends ComponentProps<typeof Button> {
  /** 悬停提示文字 */
  tooltip?: string
  /** 无障碍标签 */
  label?: string
}

/** 单个操作按钮（含可选 Tooltip 包装） */
export function MessageAction({
  tooltip,
  children,
  label,
  variant = 'ghost',
  size = 'icon-sm',
  ...props
}: MessageActionProps): React.ReactElement {
  const button = (
    <Button size={size} type="button" variant={variant} {...props}>
      {children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  )

  if (tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  return button
}

// ===== MessageResponse Markdown 渲染 =====

interface MessageResponseProps {
  /** Markdown 内容 */
  children: string
  className?: string
  /** 基础目录路径，用于解析相对文件路径（如 Agent 会话工作目录） */
  basePath?: string
  /** 次级信息使用更小的排版密度 */
  compact?: boolean
}

/** 稳定引用的插件数组，避免 react-markdown 每帧重建插件管线 */
const REMARK_PLUGINS: any[] = [[remarkGfm, { singleTilde: false }], remarkMath]
const REHYPE_PLUGINS = [rehypeKatex]

// ===== Memo'd Markdown 子组件（稳定引用，避免 react-markdown 每帧重建组件映射） =====

/** 外部链接渲染器 */
const SessionPreviewMarkdownLink = React.memo(function SessionPreviewMarkdownLink({
  href,
  children: linkChildren,
  ...linkProps
}: React.AnchorHTMLAttributes<HTMLAnchorElement>): React.ReactElement {
  const { openExternal, openUrlInSessionBrowser } = useSessionWebPreview()

  return (
    <a
      {...linkProps}
      href={href}
      onClick={(e) => {
        e.preventDefault()
        if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
          void openUrlInSessionBrowser(href).catch(() => {
            void openExternal(href)
          })
        }
      }}
      title={href}
    >
      {linkChildren}
    </a>
  )
})

function MarkdownTable({
  children,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement>): React.ReactElement {
  return (
    <div className="my-3 max-w-full overflow-x-auto rounded-md border border-border/60">
      <table {...props} className={cn('m-0 w-max min-w-full whitespace-nowrap border-0', props.className)}>
        {children}
      </table>
    </div>
  )
}

/** 递归提取纯文本（children 可能是字符串数组） */
function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (!node) return ''
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (React.isValidElement(node)) {
    return extractText((node.props as { children?: React.ReactNode }).children)
  }
  return ''
}

/** 代码块 / Mermaid 渲染器 */
const MarkdownPre = React.memo(function MarkdownPre({
  children: preChildren,
}: { children?: React.ReactNode }): React.ReactElement {
  // react-markdown v10 会将 code 组件覆盖应用到代码块内，
  // 所以 pre 收到的子元素可能是函数组件而非原生 <code>。
  const codeChild = React.Children.toArray(preChildren).find(
    (child): child is React.ReactElement => {
      if (!React.isValidElement(child)) return false
      const t = (child as React.ReactElement).type
      return t === 'code' || typeof t === 'function' || typeof t === 'object'
    }
  ) as React.ReactElement | undefined

  if (codeChild) {
    const codeProps = codeChild.props as { className?: string; children?: React.ReactNode }
    const className = codeProps.className ?? ''
    // 使用 mermaid-detection 智能检测（覆盖 language-mermaid/mmd 以及未标语言但内容像 Mermaid 的情况）
    if (shouldInspectMermaidCodeBlock(className)) {
      const mermaidCode = extractText(codeProps.children).replace(/\r\n?/g, '\n').replace(/\n$/, '')
      if (shouldRenderMermaidCodeBlock(className, mermaidCode)) {
        return <LazyMermaidBlock code={mermaidCode} />
      }
    }
  }

  return <CodeBlock>{preChildren}</CodeBlock>
})

/** 行内代码 / 文件路径渲染器 */
const MarkdownInlineCode = React.memo(function MarkdownInlineCode({
  children: codeChildren,
  className: codeClassName,
  basePath,
  ...codeProps
}: React.HTMLAttributes<HTMLElement> & { basePath?: string }): React.ReactElement {
  if (codeClassName) {
    return <code className={codeClassName} {...codeProps}>{codeChildren}</code>
  }

  const text = typeof codeChildren === 'string' ? codeChildren : ''

  if (text) {
    if (isAbsoluteFilePath(text)) {
      return <FilePathChip filePath={text.trim()} />
    }
    if (basePath && isRelativeFilePath(text)) {
      return <FilePathChip filePath={text.trim()} basePath={basePath} />
    }
  }

  return <code {...codeProps}>{codeChildren}</code>
})

/** 使用 react-markdown 渲染 assistant 消息内容，代码块使用 Shiki 语法高亮 */
export const MessageResponse = React.memo(
  function MessageResponse({
    children,
    className,
    basePath,
    compact = false,
  }: MessageResponseProps): React.ReactElement {
    // 稳定引用的 components 对象，避免 react-markdown 每帧重建组件映射
    const components = React.useMemo(() => ({
      a: SessionPreviewMarkdownLink,
      table: MarkdownTable,
      pre: MarkdownPre,
      code: (props: React.HTMLAttributes<HTMLElement>) => (
        <MarkdownInlineCode {...props} basePath={basePath} />
      ),
    }), [basePath])

    const typographyClassName = compact
      ? 'prose dark:prose-invert max-w-none text-[0.8125rem] prose-p:my-1 prose-p:leading-[1.6] prose-li:my-0.5 prose-li:leading-[1.6] prose-pre:my-0 prose-headings:my-1 prose-headings:font-sans prose-headings:font-medium prose-blockquote:my-2 prose-blockquote:rounded-md prose-blockquote:border-l-2 prose-blockquote:bg-muted/35 prose-blockquote:px-3 prose-blockquote:py-2'
      : 'prose dark:prose-invert max-w-none text-[0.9375rem] prose-p:my-1.5 prose-p:leading-[1.62] prose-li:leading-[1.62] prose-pre:my-0 prose-headings:my-2 prose-headings:font-sans prose-headings:font-medium prose-blockquote:my-3 prose-blockquote:rounded-md prose-blockquote:border-l-2 prose-blockquote:bg-muted/35 prose-blockquote:px-3 prose-blockquote:py-2'

    return (
      <div
        className={cn(
          typographyClassName,
          'min-w-0 max-w-full break-words [overflow-wrap:anywhere]',
          '[&_pre]:max-w-full [&_pre]:whitespace-pre-wrap [&_pre]:break-words',
          '[&_code]:break-words [&_code]:[overflow-wrap:anywhere]',
          '[&_table]:max-w-full',
          '[&_thead]:bg-muted/45 [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2 [&_tr]:border-b [&_tr]:border-border/50 [&_tr:last-child]:border-b-0',
          '[&_.katex-display]:my-3 [&_.mermaid-block-wrapper]:my-3',
          '[&_.code-block-wrapper+.code-block-wrapper]:mt-4',
          '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
          className
        )}
      >
        <Markdown
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={REHYPE_PLUGINS}
          components={components}
        >
          {children}
        </Markdown>
      </div>
    )
  },
  (prevProps, nextProps) => prevProps.children === nextProps.children
    && prevProps.basePath === nextProps.basePath
    && prevProps.compact === nextProps.compact
)

// ===== UserMessageContent 可折叠用户消息 =====

/** 折叠行数阈值 */
const COLLAPSE_LINE_THRESHOLD = 4

/** 将文本中的 @file:路径、/skill:名称、#mcp:名称 替换为样式化 chip */
const MENTION_RE = /@file:(\S+)|\/skill:(\S+)|#mcp:(\S+)/g

function renderTextWithMentions(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  // 重置 lastIndex（全局正则复用时需要）
  MENTION_RE.lastIndex = 0

  while ((match = MENTION_RE.exec(text)) !== null) {
    // 添加 match 前的纯文本
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    const key = `mention-${match.index}`

    if (match[1]) {
      // @file: 文件引用 — 轻品牌 chip
      const filePath = match[1]
      const fileName = filePath.split('/').pop() || filePath
      parts.push(
        <span
          key={key}
          className="inline-flex items-center gap-0.5 rounded px-1 py-[1px] text-[13px] font-medium whitespace-nowrap align-baseline bg-[hsl(var(--brand-soft))] text-[hsl(var(--brand-soft-foreground))]"
          title={filePath}
        >
          <FileText className="size-3 inline shrink-0" />
          {fileName}
        </span>
      )
    } else if (match[2]) {
      // /skill: Skill 引用 — 紫色 chip
      const skillName = formatGlobalSkillMentionLabel(match[2])
      parts.push(
        <span key={key} className="inline-flex items-center gap-0.5 rounded px-1 py-[1px] text-[13px] font-medium whitespace-nowrap align-baseline bg-[hsl(var(--brand-soft))] text-[hsl(var(--brand-soft-foreground))]">
          <Wand2 className="size-3 inline shrink-0" />
          {skillName}
        </span>
      )
    } else if (match[3]) {
      // #mcp: MCP 引用 — 绿色 chip
      const mcpName = match[3]
      parts.push(
        <span key={key} className="inline-flex items-center gap-0.5 rounded px-1 py-[1px] text-[13px] font-medium whitespace-nowrap align-baseline bg-[hsl(var(--brand-soft))] text-[hsl(var(--brand-soft-foreground))]">
          <Server className="size-3 inline shrink-0" />
          {mcpName}
        </span>
      )
    }

    lastIndex = match.index + match[0].length
  }

  // 添加剩余文本
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : text
}

interface UserMessageContentProps extends HTMLAttributes<HTMLDivElement> {
  children: string
  attachmentsNode?: React.ReactNode
}

/**
 * 用户消息内容组件
 * - 超过 4 行时默认折叠
 * - 点击展开/收起，带渐变遮罩
 */
export const UserMessageContent = React.memo(
  function UserMessageContent({ children, className, attachmentsNode, ...props }: UserMessageContentProps): React.ReactElement {
    const [isExpanded, setIsExpanded] = React.useState(false)
    const [shouldCollapse, setShouldCollapse] = React.useState(false)
    const contentRef = React.useRef<HTMLDivElement | null>(null)
    const { element: measurementElement, width: measurementWidth, setElement: setMeasurementElement } = useElementWidth<HTMLDivElement>()

    const attachContentRef = React.useCallback((node: HTMLDivElement | null) => {
      contentRef.current = node
      setMeasurementElement(node)
    }, [setMeasurementElement])

    // 检测内容是否超过阈值行数
    React.useEffect(() => {
      if (!contentRef.current) return

      const normalizedText = normalizeMeasurementText(children)
      const fontSpec = getElementFontSpec(measurementElement)

      if (measurementElement && measurementWidth > 0 && fontSpec) {
        const { lineCount } = measurePreWrapText({
          text: normalizedText,
          widthPx: measurementWidth,
          font: fontSpec.font,
          lineHeightPx: fontSpec.lineHeightPx,
        })
        setShouldCollapse(lineCount > COLLAPSE_LINE_THRESHOLD)
        return
      }

      const element = contentRef.current
      const lineHeight = parseFloat(getComputedStyle(element).lineHeight)
      const maxHeight = lineHeight * COLLAPSE_LINE_THRESHOLD

      // scrollHeight 超过最大高度 + 容差时折叠
      setShouldCollapse(element.scrollHeight > maxHeight + 10)
    }, [children, measurementElement, measurementWidth])

    const toggleExpand = React.useCallback(() => {
      setIsExpanded((prev) => !prev)
    }, [])

    return (
      <div
        className={cn(
          'relative inline-flex w-fit max-w-[min(100%,42rem)] min-w-0 flex-col rounded-[14px] border border-[hsl(var(--kila-user-bubble-border)/0.72)] bg-[hsl(var(--kila-user-bubble))] px-3.5 py-2.5 text-[hsl(var(--kila-user-bubble-foreground))]',
          shouldCollapse && !isExpanded && 'pb-6',
          className
        )}
        {...props}
      >
        {attachmentsNode}
        <div
          ref={attachContentRef}
          className={cn(
            'min-w-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-left overflow-hidden transition-[max-height] duration-200 text-[0.9375rem] leading-[1.62] text-[hsl(var(--kila-user-bubble-foreground))]',
            '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
            shouldCollapse && !isExpanded && 'max-h-[6.5em]'
          )}
        >
          {renderTextWithMentions(children)}
        </div>
        {shouldCollapse && (
          <button
            type="button"
            onClick={toggleExpand}
            className={cn(
              'mt-1 flex items-center gap-1 text-xs text-[hsl(var(--kila-user-bubble-foreground)/0.72)] transition-colors hover:text-[hsl(var(--kila-user-bubble-foreground))]',
              !isExpanded &&
                'absolute bottom-0 left-0 right-0 rounded-b-[14px] bg-gradient-to-t from-[hsl(var(--kila-user-bubble))] via-[hsl(var(--kila-user-bubble))] to-transparent px-3.5 pb-2.5 pt-4'
            )}
          >
            {isExpanded ? (
              <>
                <ChevronUp className="size-3" />
                <span>收起</span>
              </>
            ) : (
              <>
                <ChevronDown className="size-3" />
                <span>展开全部</span>
              </>
            )}
          </button>
        )}
      </div>
    )
  },
  (prevProps, nextProps) => prevProps.children === nextProps.children
)

// ===== MessageLoading 加载动画 =====

type MessageLoadingProps = HTMLAttributes<HTMLDivElement> & { startedAt?: number }

function formatLoadingElapsed(ms: number): string {
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

/** 等待首个 chunk 的加载动画 */
export function MessageLoading({ className, startedAt, ...props }: MessageLoadingProps): React.ReactElement {
  const [elapsed, setElapsed] = React.useState(() => startedAt ? Date.now() - startedAt : 0)

  React.useEffect(() => {
    if (!startedAt) return

    setElapsed(Date.now() - startedAt)
    const timer = window.setInterval(() => {
      setElapsed(Date.now() - startedAt)
    }, 100)

    return () => window.clearInterval(timer)
  }, [startedAt])

  return (
    <div className={cn('mt-0 inline-flex items-center gap-2 text-muted-foreground/60', className)} {...props}>
      <Brain className="size-4 animate-pulse text-muted-foreground/70" />
      <span className="text-xs font-normal text-muted-foreground">思考中...</span>
      {startedAt && elapsed >= 1000 && (
        <span className="text-xs font-normal text-muted-foreground/60 tabular-nums">
          ({formatLoadingElapsed(elapsed)})
        </span>
      )}
    </div>
  )
}

// ===== MessageStopped 已停止生成 =====

type MessageStoppedProps = HTMLAttributes<HTMLDivElement>

/** "已停止生成" 状态标记 */
export function MessageStopped({ className, ...props }: MessageStoppedProps): React.ReactElement {
  return (
    <div
      className={cn('flex items-center gap-1.5 text-sm text-muted-foreground mt-2', className)}
      {...props}
    >
      <span className="size-2 rounded-full bg-muted-foreground/40" />
      <span>已停止生成</span>
    </div>
  )
}

// ===== MessageAttachments 消息附件展示 =====

interface MessageAttachmentsProps extends HTMLAttributes<HTMLDivElement> {
  /** 附件列表 */
  attachments: FileAttachment[]
}

/** 消息附件容器 */
export function MessageAttachments({
  attachments,
  className,
  ...props
}: MessageAttachmentsProps): React.ReactElement {
  const imageAttachments = attachments.filter((att) => att.mediaType.startsWith('image/'))
  const fileAttachments = attachments.filter((att) => !att.mediaType.startsWith('image/'))
  const isSingleImage = imageAttachments.length === 1 && fileAttachments.length === 0

  return (
    <div className={cn('flex flex-col gap-2 mb-2', className)} {...props}>
      {/* 图片附件 */}
      {imageAttachments.length > 0 && (
        <div className="flex flex-wrap gap-2.5">
          {imageAttachments.map((att) => (
            <MessageAttachmentImage key={att.id} attachment={att} isSingle={isSingleImage} />
          ))}
        </div>
      )}
      {/* 文件附件 */}
      {fileAttachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {fileAttachments.map((att) => (
            <MessageAttachmentFile key={att.id} attachment={att} />
          ))}
        </div>
      )}
    </div>
  )
}

// ===== MessageAttachmentImage 图片附件展示 =====

interface MessageAttachmentImageProps {
  attachment: FileAttachment
  /** 是否为唯一附件（单图模式） */
  isSingle?: boolean
}

/** 图片附件展示（单图: max 500px，多图: 280px 方块） */
function MessageAttachmentImage({ attachment, isSingle = false }: MessageAttachmentImageProps): React.ReactElement {
  const { imageSrc, loadState, retry, markError } = useAttachmentImage(
    attachment.localPath,
    attachment.mediaType,
  )

  const handleSave = React.useCallback((): void => {
    void window.electronAPI.saveImageAs(attachment.localPath, attachment.filename).catch((error) => {
      console.error('[MessageAttachmentImage] 保存附件失败:', error)
    })
  }, [attachment.localPath, attachment.filename])

  const sizeClass = isSingle ? 'w-[280px] h-[200px]' : 'size-[280px]'
  if (loadState === 'loading') {
    return (
      <div
        className={cn('rounded-lg bg-muted/30 animate-pulse shrink-0', sizeClass)}
        role="status"
        aria-label={`正在加载 ${attachment.filename}`}
      />
    )
  }

  if (loadState === 'error' || !imageSrc) {
    return (
      <div className={cn('flex shrink-0 flex-col items-center justify-center gap-2 rounded-lg bg-destructive/5 px-3 text-center text-destructive/75', sizeClass)}>
        <XCircle className="size-5" />
        <span className="line-clamp-2 text-xs">图片加载失败：{attachment.filename}</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={retry} className="rounded-md bg-background/70 px-2 py-1 text-xs text-foreground/70 hover:text-foreground">
            重试
          </button>
          <button type="button" onClick={handleSave} className="rounded-md bg-background/70 px-2 py-1 text-xs text-foreground/70 hover:text-foreground">
            另存为
          </button>
        </div>
      </div>
    )
  }

  const imgElement = isSingle ? (
    <img
      src={imageSrc}
      alt={attachment.filename}
      className="max-w-[500px] max-h-[min(500px,50vh)] rounded-lg object-contain"
      onError={markError}
    />
  ) : (
    <img
      src={imageSrc}
      alt={attachment.filename}
      className="size-[280px] rounded-lg object-cover shrink-0"
      onError={markError}
    />
  )

  return (
    <div className="relative group inline-block">
      {imgElement}
      <button
        type="button"
        onClick={handleSave}
        className="absolute bottom-2 right-2 p-1.5 rounded-md bg-black/50 text-white opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-black/70"
        aria-label="保存图片"
        title="保存图片"
      >
        <Download className="size-4" />
      </button>
    </div>
  )
}

// ===== MessageAttachmentFile 文件附件展示 =====

interface MessageAttachmentFileProps {
  attachment: FileAttachment
}

/** 文件附件展示（标签样式，teal 色调） */
function MessageAttachmentFile({ attachment }: MessageAttachmentFileProps): React.ReactElement {
  /** 截断文件名 */
  const displayName = attachment.filename.length > 20
    ? attachment.filename.slice(0, 17) + '...'
    : attachment.filename

  return (
    <div className="flex shrink-0 items-center gap-2 rounded-lg border border-border/70 bg-accent px-3 py-1.5 text-[13px] text-foreground/80">
      <Paperclip className="size-4" />
      <span>{displayName}</span>
    </div>
  )
}

// ===== StreamingMessageResponse 流式 Per-Block 渲染 =====

const STREAM_FADE_DURATION = 280
const REVEALED_STREAM_PLUGIN: Pluggable = [rehypeStreamAnimated, { revealed: true } as StreamAnimatedOptions]

/** 字符计数（使用 spread 正确处理 surrogate pairs） */
function countStreamChars(text: string): number {
  return [...text].length
}

function getNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

/** 单个 Block 的 memo'd Markdown 渲染器 */
const StreamdownBlock = React.memo<MarkdownOptions>(
  ({ children, ...rest }) => <Markdown {...rest}>{children}</Markdown>,
  (prev, next) =>
    prev.children === next.children &&
    prev.components === next.components &&
    isSamePlugins(prev.rehypePlugins as PluggableList | undefined, next.rehypePlugins as PluggableList | undefined) &&
    isSamePlugins(prev.remarkPlugins as PluggableList | undefined, next.remarkPlugins as PluggableList | undefined),
)
StreamdownBlock.displayName = 'StreamdownBlock'

interface StreamingMessageResponseProps {
  /** Smoothed content from useSmoothStreamContent */
  children: string
  className?: string
  basePath?: string
  compact?: boolean
}

/**
 * 流式 per-block Markdown 渲染组件
 *
 * 对标 LobeHub StreamdownRender：
 * - marked.lexer 拆 block
 * - useStreamQueue 四态状态机
 * - births[] 管理逐字淡入时间戳
 * - rehypeStreamAnimated 字符级 CSS fade
 */
export const StreamingMessageResponse = React.memo(
  function StreamingMessageResponse({
    children,
    className,
    basePath,
    compact = false,
  }: StreamingMessageResponseProps): React.ReactElement {
    const generatedId = React.useId()

    // 稳定引用的 components 对象
    const components = React.useMemo(() => ({
      a: SessionPreviewMarkdownLink,
      table: MarkdownTable,
      pre: MarkdownPre,
      code: (props: React.HTMLAttributes<HTMLElement>) => (
        <MarkdownInlineCode {...props} basePath={basePath} />
      ),
    }), [basePath])

    // 稳定化基础插件
    const baseRehypePlugins = useStablePlugins(REHYPE_PLUGINS as PluggableList)
    const remarkPlugins = useStablePlugins(REMARK_PLUGINS as PluggableList)

    // remend 修复截断的 Markdown 语法
    const processedContent = React.useMemo(() => {
      return remend(children || '')
    }, [children])

    // marked.lexer 拆 block
    const blocks: BlockInfo[] = React.useMemo(() => {
      const tokens = marked.lexer(processedContent)
      let offset = 0
      return tokens.map((token) => {
        const block = { content: token.raw, startOffset: offset }
        offset += token.raw.length
        return block
      })
    }, [processedContent])

    // 四态状态机
    const { getBlockState, charDelay } = useStreamQueue(blocks)

    // births[] 跨帧持久化
    const blockCharDelayRef = React.useRef<Map<number, number>>(new Map())
    const blockBirthsRef = React.useRef<Map<number, number[]>>(new Map())

    const renderNow = getNow()

    // births[] 增量构建
    const birthsForRender = React.useMemo(() => {
      const nextBirths = new Map<number, number[]>()
      const prevBirths = blockBirthsRef.current

      for (const [index, block] of blocks.entries()) {
        const state = getBlockState(index)
        if (state === 'queued') continue

        const blockCharCount = countStreamChars(block.content)
        const prev = prevBirths.get(block.startOffset)
        let arr: number[]

        if (prev && prev.length === blockCharCount) {
          arr = prev
        } else if (prev && prev.length > blockCharCount) {
          arr = prev.slice(0, blockCharCount)
        } else if (!prev && state === 'revealed') {
          // 初始挂载时已 revealed 的 block（如切换对话切回）：
          // 所有字符的 birth 设为远过去，立即 settled，不播放 fade 动画
          const pastTs = renderNow - STREAM_FADE_DURATION - 100
          arr = new Array(blockCharCount).fill(pastTs)
        } else {
          arr = prev ? prev.slice() : []
          const cap = renderNow + STREAM_FADE_DURATION
          for (let i = arr.length; i < blockCharCount; i++) {
            const prevBirth = i > 0 ? (arr[i - 1] as number) : renderNow - charDelay
            const chained = prevBirth + charDelay
            arr.push(Math.min(cap, Math.max(chained, renderNow)))
          }
        }

        nextBirths.set(block.startOffset, arr)
      }

      return nextBirths
    }, [blocks, charDelay, getBlockState, renderNow])

    // per-block 动画元信息
    const blockAnimationMetaResult = React.useMemo(() => {
      const nextBlockCharDelay = new Map<number, number>()
      const blockAnimationMeta = new Map<number, ReturnType<typeof resolveBlockAnimationMeta>>()

      for (const [index, block] of blocks.entries()) {
        const state = getBlockState(index)
        const births = birthsForRender.get(block.startOffset)
        const lastBirthTs = births && births.length > 0 ? (births.at(-1) ?? renderNow) : renderNow
        const lastElapsedMs = renderNow - lastBirthTs
        const animationMeta = resolveBlockAnimationMeta({
          currentCharDelay: charDelay,
          fadeDuration: STREAM_FADE_DURATION,
          lastElapsedMs,
          previousCharDelay: blockCharDelayRef.current.get(block.startOffset),
          state,
        })

        nextBlockCharDelay.set(block.startOffset, animationMeta.charDelay)
        blockAnimationMeta.set(block.startOffset, animationMeta)
      }

      return { blockAnimationMeta, blockCharDelay: nextBlockCharDelay }
    }, [birthsForRender, blocks, charDelay, getBlockState, renderNow])

    // 跨帧持久化 births 和 charDelay
    React.useEffect(() => {
      blockCharDelayRef.current = blockAnimationMetaResult.blockCharDelay
      blockBirthsRef.current = birthsForRender
    }, [birthsForRender, blockAnimationMetaResult.blockCharDelay])

    const typographyClassName = compact
      ? 'prose dark:prose-invert max-w-none text-[0.8125rem] prose-p:my-1 prose-p:leading-[1.6] prose-li:my-0.5 prose-li:leading-[1.6] prose-pre:my-0 prose-headings:my-1 prose-headings:font-sans prose-headings:font-medium prose-blockquote:my-2 prose-blockquote:rounded-md prose-blockquote:border-l-2 prose-blockquote:bg-muted/35 prose-blockquote:px-3 prose-blockquote:py-2'
      : 'prose dark:prose-invert max-w-none text-[0.9375rem] prose-p:my-1.5 prose-p:leading-[1.62] prose-li:leading-[1.62] prose-pre:my-0 prose-headings:my-2 prose-headings:font-sans prose-headings:font-medium prose-blockquote:my-3 prose-blockquote:rounded-md prose-blockquote:border-l-2 prose-blockquote:bg-muted/35 prose-blockquote:px-3 prose-blockquote:py-2'

    return (
      <div
        className={cn(
          typographyClassName,
          'min-w-0 max-w-full break-words [overflow-wrap:anywhere]',
          '[&_pre]:max-w-full [&_pre]:whitespace-pre-wrap [&_pre]:break-words',
          '[&_code]:break-words [&_code]:[overflow-wrap:anywhere]',
          '[&_table]:max-w-full',
          '[&_thead]:bg-muted/45 [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2 [&_tr]:border-b [&_tr]:border-border/50 [&_tr:last-child]:border-b-0',
          '[&_.katex-display]:my-3 [&_.mermaid-block-wrapper]:my-3',
          '[&_.code-block-wrapper+.code-block-wrapper]:mt-4',
          '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
          'streamdown-animated',
          className
        )}
      >
        {blocks.map((block, index) => {
          const state = getBlockState(index)
          if (state === 'queued') return null

          const animationMeta = blockAnimationMetaResult.blockAnimationMeta.get(block.startOffset)
          if (!animationMeta) return null

          const births = birthsForRender.get(block.startOffset)
          const plugins: Pluggable[] = animationMeta.settled
            ? [...baseRehypePlugins, REVEALED_STREAM_PLUGIN]
            : [
                ...baseRehypePlugins,
                [
                  rehypeStreamAnimated,
                  {
                    births,
                    fadeDuration: STREAM_FADE_DURATION,
                    nowMs: renderNow,
                  } as StreamAnimatedOptions,
                ],
              ]

          const key = `${generatedId}-${block.startOffset}`

          return (
            <StreamdownBlock
              key={key}
              components={components}
              rehypePlugins={plugins}
              remarkPlugins={remarkPlugins}
            >
              {block.content}
            </StreamdownBlock>
          )
        })}
      </div>
    )
  },
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    prevProps.basePath === nextProps.basePath &&
    prevProps.compact === nextProps.compact
)

// ===== Streaming CSS (injected once) =====

const STREAMING_CSS = `
.streamdown-animated .stream-char {
  opacity: 0;
  animation: streamFadeIn 280ms cubic-bezier(0.33, 0, 0.67, 1) forwards;
}
.streamdown-animated .stream-char-revealed {
  opacity: 1;
  animation: none;
}
@keyframes streamFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
.streamdown-animated .katex-display .katex-html span {
  mask: none !important;
  animation: none !important;
}
.code-line-new {
  animation: codeLineFadeIn 200ms cubic-bezier(0.33, 0, 0.67, 1) forwards;
}
@keyframes codeLineFadeIn {
  from { opacity: 0; transform: translateY(2px); }
  to { opacity: 1; transform: translateY(0); }
}
`

let streamingCssInjected = false
function ensureStreamingCss(): void {
  if (streamingCssInjected || typeof document === 'undefined') return
  const style = document.createElement('style')
  style.textContent = STREAMING_CSS
  style.setAttribute('data-kila-streaming', '')
  document.head.appendChild(style)
  streamingCssInjected = true
}
// Inject CSS on module load
ensureStreamingCss()

// ===== StreamingIndicator 流式呼吸脉冲点 =====

type StreamingIndicatorProps = HTMLAttributes<HTMLSpanElement>

/** 流式生成中的呼吸脉冲点指示器 */
export function StreamingIndicator({ className, ...props }: StreamingIndicatorProps): React.ReactElement {
  return (
    <span
      className={cn(
        'inline-block size-2 rounded-full bg-primary/60 animate-pulse ml-1 align-middle',
        className
      )}
      {...props}
    />
  )
}
