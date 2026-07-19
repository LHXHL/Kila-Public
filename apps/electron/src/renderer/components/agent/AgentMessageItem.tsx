/**
 * AgentMessageItem — 单条消息渲染组件
 *
 * 包含 EmptyState、AttachedFileChip、RetryingNotice、RetryAttemptItem
 * 和主 AgentMessageItem 组件。负责 user / assistant / tool / status 四种角色的消息展示。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { FileText, FileImage, RotateCw, AlertTriangle, ChevronDown, ChevronRight, Plus, Minimize2, Pencil, GitBranch, History } from 'lucide-react'
import {
  Message,
  MessageAction,
  MessageContent,
  MessageActions,
  MessageResponse,
  StreamingMessageResponse,
  StreamingIndicator,
  UserMessageContent,
} from '@/components/ai-elements/message'
import { UserAvatar } from '@/components/message/UserAvatar'
import { CopyButton } from '@/components/message/CopyButton'
import { Button } from '@/components/ui/button'
import { useAttachmentImage } from '@/hooks/use-attachment-image'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { userProfileAtom } from '@/atoms/user-profile'
import {
  parseAssistantRenderableBlocks,
  parseStreamingAssistantBlocks,
  type AssistantRenderableBlock,
} from '@/lib/generative-ui/parse-show-widget'
import { WidgetRenderer } from './WidgetRenderer'
import { SchemaWidgetRenderer } from './SchemaWidgetRenderer'
import { ProcessTimeline } from './process-cards'
import { FollowUpChips } from './FollowUpChips'
import { MemoryTraceBadge } from './MemoryTraceBadge'
import {
  formatMessageTime,
  getMessageSourceLabel,
  shouldShowMessageSourceBadge,
  extractAttachedFiles,
  getAssistantPlainText,
  isImageFile,
  type AttachedFileRef,
} from './agent-messages-utils'
import { buildAssistantTurnTimelineEntries, type AssistantTurnTimelineEntry } from '@/atoms/agent-atoms'
import type {
  AgentMessage,
  RetryAttempt,
  SessionPinnedWidget,
  WidgetDraftIntent,
} from '@kila/shared'
import type { AgentStreamState } from '@/atoms/agent-atoms'

// ===== AttachedFileChip =====

function AttachedFileChip({ file, role = 'assistant' }: { file: AttachedFileRef; role?: 'user' | 'assistant' }): React.ReactElement {
  const isImg = isImageFile(file.filename) || file.mediaType?.startsWith('image/')
  const Icon = isImg ? FileImage : FileText
  const image = useAttachmentImage(file.path, file.mediaType || 'image/png', isImg)

  if (isImg && image.loadState === 'loaded' && image.imageSrc) {
    return (
      <div className="inline-block rounded-lg overflow-hidden max-w-[240px] shadow-sm">
        <img
          src={image.imageSrc}
          alt={file.filename}
          className="w-full h-auto rounded-lg object-cover"
          loading="lazy"
          onError={image.markError}
        />
      </div>
    )
  }

  if (isImg && image.loadState === 'error') {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-md bg-destructive/10 px-2.5 py-1 text-[12px] text-destructive hover:bg-destructive/15"
        onClick={image.retry}
        title="点击重试读取图片"
      >
        <RotateCw className="size-3.5" />
        图片读取失败，重试
      </button>
    )
  }

  return (
    <div className={cn(
      "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px]",
      role === 'user'
        ? "bg-[hsl(var(--brand-strong)/0.08)] text-[hsl(var(--brand-soft-foreground))]"
        : "bg-muted/60 text-muted-foreground"
    )}>
      <Icon className={cn(
        "size-3.5 shrink-0",
        role === 'user' && "text-[hsl(var(--brand-soft-foreground)/0.7)]"
      )} />
      <span className="truncate max-w-[200px]">{file.filename}</span>
    </div>
  )
}

// ===== RetryAttemptItem =====

function RetryAttemptItem({
  attempt,
  isLatest,
  isFailed,
}: {
  attempt: RetryAttempt
  isLatest: boolean
  isFailed: boolean
}): React.ReactElement {
  const [showStderr, setShowStderr] = React.useState(false)
  const [showStack, setShowStack] = React.useState(false)

  const time = new Date(attempt.timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  return (
    <div className={cn('pl-6 space-y-2', isLatest && 'font-medium')}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="text-xs text-foreground/90">
            第 {attempt.attempt} 次 ({time}) - {attempt.reason}
          </div>
          <div className="break-words font-mono text-xs text-destructive/80">
            {attempt.errorMessage}
          </div>

          {attempt.environment && (
            <div className="space-y-0.5 text-[11px] text-muted-foreground">
              <div>运行时: {attempt.environment.runtime}</div>
              <div>平台: {attempt.environment.platform}</div>
              <div>模型: {attempt.environment.model}</div>
              {attempt.environment.workspace && <div>工作区: {attempt.environment.workspace}</div>}
            </div>
          )}

          {attempt.stderr && (
            <div className="mt-2">
              <button
                type="button"
                className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground/80"
                onClick={() => setShowStderr(!showStderr)}
              >
                {showStderr ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                显示 stderr 输出
              </button>
              {showStderr && (
                <pre className="mt-1 max-h-[200px] overflow-x-auto overflow-y-auto rounded-md border border-border/25 bg-muted/15 p-2 text-[10px] text-foreground/70">
                  {attempt.stderr}
                </pre>
              )}
            </div>
          )}

          {attempt.stack && (
            <div className="mt-2">
              <button
                type="button"
                className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground/80"
                onClick={() => setShowStack(!showStack)}
              >
                {showStack ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                显示堆栈跟踪
              </button>
              {showStack && (
                <pre className="mt-1 max-h-[200px] overflow-x-auto overflow-y-auto rounded-md border border-border/25 bg-muted/15 p-2 text-[10px] text-foreground/70">
                  {attempt.stack}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ===== RetryingNotice =====

export function RetryingNotice({ retrying }: { retrying: NonNullable<AgentStreamState['retrying']> }): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false)
  const [countdown, setCountdown] = React.useState(0)

  React.useEffect(() => {
    if (retrying.failed || retrying.history.length === 0) {
      setCountdown(0)
      return
    }

    const lastAttempt = retrying.history[retrying.history.length - 1]
    if (!lastAttempt) return

    const updateCountdown = (): void => {
      const elapsed = (Date.now() - lastAttempt.timestamp) / 1000
      const remaining = Math.max(0, lastAttempt.delaySeconds - elapsed)
      setCountdown(Math.ceil(remaining))

      if (remaining <= 0) {
        setCountdown(0)
      }
    }

    updateCountdown()

    const timer = setInterval(updateCountdown, 100)
    return () => clearInterval(timer)
  }, [retrying.failed, retrying.history])

  return (
    <div className="mb-1.5 overflow-hidden rounded-xl border border-border/35 bg-background/55">
      <button
        type="button"
        className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors hover:bg-muted/10"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/20">
          {retrying.failed ? (
            <AlertTriangle className="size-4 shrink-0 text-destructive" />
          ) : (
            <RotateCw className="size-4 shrink-0 animate-spin text-foreground/45" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">
            {retrying.failed ? '重试失败' : '正在重试'}
          </div>
          <div className="truncate text-[12px] text-muted-foreground/85">
          {retrying.failed
            ? `重试失败 (${retrying.currentAttempt}/${retrying.maxAttempts})`
            : countdown > 0
              ? `重试倒计时 ${countdown}秒 (${retrying.currentAttempt}/${retrying.maxAttempts})`
              : `重试中 (${retrying.currentAttempt}/${retrying.maxAttempts})`}
            {retrying.history.length > 0 && ` · ${retrying.history[retrying.history.length - 1]?.reason}`}
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="size-4 shrink-0 text-foreground/45" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-foreground/45" />
        )}
      </button>

      {expanded && retrying.history.length > 0 && (
        <div className="space-y-3 border-t border-border/20 px-2.5 py-2.5">
          <div className="text-[11px] font-medium text-muted-foreground">
            尝试历史：
          </div>
          {retrying.history.map((attempt, index) => (
            <RetryAttemptItem
              key={attempt.timestamp}
              attempt={attempt}
              isLatest={index === retrying.history.length - 1}
              isFailed={retrying.failed && index === retrying.history.length - 1}
            />
          ))}
          {!retrying.failed && (
            <div className="flex items-center gap-2 pl-9 text-[11px] text-muted-foreground">
              {countdown > 0 ? (
                <>
                  <RotateCw className="size-3 animate-spin text-foreground/45" />
                  <span>等待 {countdown} 秒后开始第 {retrying.currentAttempt} 次尝试</span>
                </>
              ) : (
                <>
                  <RotateCw className="size-3 animate-spin text-foreground/45" />
                  <span>正在进行第 {retrying.currentAttempt} 次尝试...</span>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ===== AssistantLongContent =====

function AssistantLongContent({ children }: { children: React.ReactNode }): React.ReactElement {
  return <>{children}</>
}

// ===== renderAssistantRenderableBlocks =====

export function renderAssistantRenderableBlocks(
  blocks: AssistantRenderableBlock[],
  sessionPath?: string | null,
  options?: {
    isStreaming?: boolean
    sessionId?: string
    sourceMessageId?: string
    blockKeyPrefix?: string
    onPinned?: (widget: SessionPinnedWidget) => void
    onDraftIntent?: (intent: WidgetDraftIntent) => void
  },
): React.ReactNode[] {
  return blocks.flatMap((block, index) => {
    const blockKey = `${options?.blockKeyPrefix ?? ''}${block.kind}:${index}`

    if (block.kind === 'codeWidget') {
      return [
        <WidgetRenderer
          key={`${block.cacheKey}:${index}`}
          title={block.title}
          widgetCode={block.widgetCode}
          cacheKey={block.cacheKey}
          isStreaming={options?.isStreaming}
          sessionId={options?.sessionId}
          sourceMessageId={options?.sourceMessageId}
          sourceBlockKey={blockKey}
          onPinned={options?.onPinned}
          draftSource={options?.sourceMessageId ? {
            widgetKey: blockKey,
            messageId: options.sourceMessageId,
          } : undefined}
          onDraftIntent={options?.onDraftIntent}
        />,
      ]
    }

    if (block.kind === 'schemaWidget') {
      return [
        <SchemaWidgetRenderer
          key={`${block.cacheKey}:${index}`}
          title={block.title}
          caption={block.caption}
          widgetType={block.widgetType}
          spec={block.spec}
          sessionId={options?.sessionId}
          sourceMessageId={options?.sourceMessageId}
          sourceBlockKey={blockKey}
          onPinned={options?.onPinned}
          draftSource={options?.sourceMessageId ? {
            widgetKey: blockKey,
            messageId: options.sourceMessageId,
          } : undefined}
          onDraftIntent={options?.onDraftIntent}
        />,
      ]
    }

    const markdown = block.markdown.trim()
    if (!markdown) return []

    return [
      <MessageResponse
        key={`markdown:${index}:${markdown.slice(0, 24)}`}
        basePath={sessionPath || undefined}
      >
        {markdown}
      </MessageResponse>,
    ]
  })
}

export function renderStreamingAssistantBlocks(
  content: string,
  sessionPath?: string | null,
): React.ReactNode[] {
  const parsed = parseStreamingAssistantBlocks(content)

  // Completed blocks: Widget blocks use WidgetRenderer, markdown blocks use StreamingMessageResponse
  const nodes: React.ReactNode[] = parsed.completedBlocks.flatMap((block, index) => {
    if (block.kind === 'codeWidget') {
      return [
        <WidgetRenderer
          key={`${block.cacheKey}:${index}`}
          title={block.title}
          widgetCode={block.widgetCode}
          cacheKey={block.cacheKey}
          isStreaming
        />,
      ]
    }
    if (block.kind === 'schemaWidget') {
      return [
        <SchemaWidgetRenderer
          key={`${block.cacheKey}:${index}`}
          title={block.title}
          caption={block.caption}
          widgetType={block.widgetType}
          spec={block.spec}
        />,
      ]
    }
    const markdown = block.markdown.trim()
    if (!markdown) return []
    return [
      <StreamingMessageResponse
        key={`streaming-md:${index}:${markdown.slice(0, 24)}`}
        basePath={sessionPath || undefined}
      >
        {markdown}
      </StreamingMessageResponse>,
    ]
  })

  if (parsed.partialWidget) {
    nodes.push(
      <WidgetRenderer
        key={`partial:${parsed.partialWidget.cacheKey}`}
        title={parsed.partialWidget.title}
        widgetCode={parsed.partialWidget.widgetCode}
        cacheKey={parsed.partialWidget.cacheKey}
        isStreaming
        showOverlay={parsed.partialWidget.scriptsTruncated}
      />,
    )
  }

  return nodes
}

export function AssistantTurnTimeline({
  entries,
  sessionPath,
  streaming = false,
  backgroundTasks,
  startedAt,
  animate = false,
  sessionId,
  sourceMessageId,
  onPinnedWidget,
  onWidgetDraftIntent,
}: {
  entries: AssistantTurnTimelineEntry[]
  sessionPath?: string | null
  streaming?: boolean
  backgroundTasks?: React.ComponentProps<typeof ProcessTimeline>['backgroundTasks']
  startedAt?: number
  animate?: boolean
  sessionId?: string
  sourceMessageId?: string
  onPinnedWidget?: (widget: SessionPinnedWidget) => void
  onWidgetDraftIntent?: (intent: WidgetDraftIntent) => void
}): React.ReactElement | null {
  if (entries.length === 0) {
    if (!streaming) return null

    return (
      <ProcessTimeline
        entries={[]}
        backgroundTasks={backgroundTasks}
        startedAt={startedAt}
        streaming={streaming}
        sessionPath={sessionPath}
        animate={animate}
      />
    )
  }

  return (
    <>
      {entries.map((entry) => {
        if (entry.kind === 'process') {
          return (
            <ProcessTimeline
              key={entry.id}
              entries={entry.entries}
              backgroundTasks={backgroundTasks}
              startedAt={startedAt}
              streaming={streaming}
              sessionPath={sessionPath}
              animate={animate}
            />
          )
        }

        const textNodes = streaming
          ? renderStreamingAssistantBlocks(entry.text, sessionPath)
          : renderAssistantRenderableBlocks(
            parseAssistantRenderableBlocks(entry.text),
            sessionPath,
            {
              sessionId,
              sourceMessageId,
              blockKeyPrefix: `${entry.id}:`,
              onPinned: onPinnedWidget,
              onDraftIntent: onWidgetDraftIntent,
            },
          )

        return (
          <React.Fragment key={entry.id}>
            {textNodes}
          </React.Fragment>
        )
      })}
    </>
  )
}

function getMemoryTraceFromEvents(events?: AgentMessage['events']) {
  return events?.find((event) => event.type === 'memory_trace')?.trace
}

// ===== AgentMessageItem =====

export interface AgentMessageItemProps {
  sessionId: string
  message: AgentMessage
  sessionPath?: string | null
  onRetry?: () => void
  onRegenerateTurn?: (messageId: string) => void
  onEditTurn?: (message: AgentMessage) => void
  onBranchFromMessage?: (messageId: string) => void
  onRewindToMessage?: (messageId: string) => void
  onRetryInNewSession?: () => void
  onCompact?: () => void
  onPinnedWidget?: (widget: SessionPinnedWidget) => void
  onWidgetDraftIntent?: (intent: WidgetDraftIntent) => void
  followUpSuggestion?: string | null
  onUseFollowUp?: (prompt: string) => void
}

export const AgentMessageItem = React.memo(function AgentMessageItem({
  sessionId,
  message,
  sessionPath,
  onRetry,
  onRegenerateTurn,
  onEditTurn,
  onBranchFromMessage,
  onRewindToMessage,
  onRetryInNewSession,
  onCompact,
  onPinnedWidget,
  onWidgetDraftIntent,
  followUpSuggestion,
  onUseFollowUp,
}: AgentMessageItemProps): React.ReactElement | null {
  const userProfile = useAtomValue(userProfileAtom)

  if (message.role === 'user') {
    const { files: attachedFiles, text: messageText } = extractAttachedFiles(message)
    const hasVisibleUserBody = Boolean(messageText || attachedFiles.length > 0)

    return (
      <Message from="user">
        <div className="mb-2.5 flex items-start justify-end gap-2.5 self-end text-right">
          <div className="flex h-[35px] flex-col items-end justify-between">
            <span className="text-sm font-medium leading-none text-foreground/70">{userProfile.userName}</span>
            <div className="flex items-center gap-2">
              {shouldShowMessageSourceBadge(message) && (
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                  {getMessageSourceLabel(message)}
                </Badge>
              )}
              {message.relatedTaskId && (
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                  {message.relatedTaskId}
                </Badge>
              )}
              <span className="text-[10px] text-foreground/[0.38] leading-none">{formatMessageTime(message.createdAt)}</span>
            </div>
          </div>
          <UserAvatar avatar={userProfile.avatar} size={35} />
        </div>
        <MessageContent>
          {messageText && (
            <UserMessageContent
              attachmentsNode={attachedFiles.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {attachedFiles.map((file) => (
                    <AttachedFileChip key={file.path} file={file} role="user" />
                  ))}
                </div>
              ) : undefined}
            >
              {messageText}
            </UserMessageContent>
          )}
          {!messageText && attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 justify-end">
              {attachedFiles.map((file) => (
                <AttachedFileChip key={file.path} file={file} role="assistant" />
              ))}
            </div>
          )}
        </MessageContent>
        {(messageText || (hasVisibleUserBody && (onEditTurn || onRegenerateTurn || onRewindToMessage))) && (
          <MessageActions className="mt-0.5">
            {messageText && <CopyButton content={messageText} />}
            {hasVisibleUserBody && onEditTurn && (
              <MessageAction
                tooltip="编辑后重发"
                label="编辑后重发"
                onClick={() => onEditTurn(message)}
              >
                <Pencil className="size-4" />
              </MessageAction>
            )}
            {hasVisibleUserBody && onRewindToMessage && (
              <MessageAction
                tooltip="回退到此消息"
                label="回退到此消息"
                onClick={() => onRewindToMessage(message.id)}
              >
                <History className="size-4" />
              </MessageAction>
            )}
            {hasVisibleUserBody && onRegenerateTurn && (
              <MessageAction
                tooltip="重新生成"
                label="重新生成"
                onClick={() => onRegenerateTurn(message.id)}
              >
                <RotateCw className="size-4" />
              </MessageAction>
            )}
          </MessageActions>
        )}
      </Message>
    )
  }

  if (message.role === 'assistant' || message.role === 'tool') {
    const { files: attachedFiles, text: messageText } = extractAttachedFiles(message)
    const timelineEntries = React.useMemo(
      () => message.role === 'assistant'
        ? buildAssistantTurnTimelineEntries(message.events, messageText)
        : [],
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [message.role, message.events, messageText],
    )
    const memoryTrace = message.role === 'assistant'
      ? getMemoryTraceFromEvents(message.events)
      : undefined
    const copyText = message.role === 'assistant'
      ? getAssistantPlainText(messageText)
      : messageText
    const hasVisibleAssistantBody = Boolean(
      copyText
      || attachedFiles.length > 0
      || timelineEntries.length > 0,
    )

    return (
      <Message from="assistant">
        <MessageContent>
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {attachedFiles.map((file) => (
                <AttachedFileChip key={file.path} file={file} />
              ))}
            </div>
          )}
          {message.role === 'assistant'
            ? (
              <AssistantLongContent>
                <AssistantTurnTimeline
                  entries={timelineEntries}
                  sessionPath={sessionPath}
                  sessionId={sessionId}
                  sourceMessageId={message.id}
                  onPinnedWidget={onPinnedWidget}
                  onWidgetDraftIntent={onWidgetDraftIntent}
                />
                <MemoryTraceBadge trace={memoryTrace} />
              </AssistantLongContent>
            )
            : messageText
              ? (
                <MessageResponse basePath={sessionPath || undefined}>{messageText}</MessageResponse>
              )
              : null}
        </MessageContent>
        {(copyText || (message.role === 'assistant' && hasVisibleAssistantBody && (onBranchFromMessage || onRegenerateTurn || onRewindToMessage))) && (
          <MessageActions className="mt-0.5">
            {copyText && <CopyButton content={copyText} />}
            {message.role === 'assistant' && hasVisibleAssistantBody && onBranchFromMessage && (
              <MessageAction
                tooltip="分叉会话"
                label="分叉会话"
                onClick={() => onBranchFromMessage(message.id)}
              >
                <GitBranch className="size-4" />
              </MessageAction>
            )}
            {message.role === 'assistant' && hasVisibleAssistantBody && onRewindToMessage && (
              <MessageAction
                tooltip="回退到此消息"
                label="回退到此消息"
                onClick={() => onRewindToMessage(message.id)}
              >
                <History className="size-4" />
              </MessageAction>
            )}
            {message.role === 'assistant' && hasVisibleAssistantBody && onRegenerateTurn && (
              <MessageAction
                tooltip="重新生成"
                label="重新生成"
                onClick={() => onRegenerateTurn(message.id)}
              >
                <RotateCw className="size-4" />
              </MessageAction>
            )}
          </MessageActions>
        )}
        {message.role === 'assistant' && onUseFollowUp && (
          <FollowUpChips suggestion={followUpSuggestion ?? null} onUse={onUseFollowUp} />
        )}
      </Message>
    )
  }

  if (message.role === 'status' && !message.errorCode) {
    return (
      <Message from="assistant">
        <MessageContent>
          <div className="rounded-xl bg-muted/60 px-4 py-3 text-sm text-muted-foreground shadow-sm">
            <MessageResponse>{message.content}</MessageResponse>
          </div>
        </MessageContent>
        <MessageActions className="mt-0.5">
          <CopyButton content={message.content} />
        </MessageActions>
      </Message>
    )
  }

  if (message.role === 'status' && message.errorCode) {
    return (
      <Message from="assistant">
        <MessageContent>
          <div className="text-destructive">
            <MessageResponse>{message.content}</MessageResponse>
          </div>
          <div className="flex items-center gap-2 mt-3">
            {message.errorCode === 'prompt_too_long' && onCompact && (
              <Button size="sm" onClick={onCompact}>
                <Minimize2 className="size-3.5 mr-1.5" />
                压缩上下文
              </Button>
            )}
            {onRetry && (
              <Button size="sm" variant={message.errorCode === 'prompt_too_long' ? 'outline' : 'default'} onClick={onRetry}>
                <RotateCw className="size-3.5 mr-1.5" />
                重试
              </Button>
            )}
            {onRetryInNewSession && (
              <Button size="sm" variant="outline" onClick={onRetryInNewSession}>
                <Plus className="size-3.5 mr-1.5" />
                在新会话中重试
              </Button>
            )}
          </div>
        </MessageContent>
        <MessageActions className="mt-0.5">
          <CopyButton content={message.content} />
        </MessageActions>
      </Message>
    )
  }

  return null
})
