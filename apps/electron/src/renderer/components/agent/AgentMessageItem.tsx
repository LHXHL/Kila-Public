/**
 * AgentMessageItem — 单条消息渲染组件
 *
 * 包含 EmptyState、AttachedFileChip 和主 AgentMessageItem 组件。
 * 负责 user / assistant / tool / status 四种角色的消息展示。
 * 流式过程提示（RetryingNotice / CompactingNotice）已拆至 agent-stream-notices.tsx。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { FileText, FileImage, RotateCw, Plus, Minimize2, Pencil, GitBranch, History } from 'lucide-react'
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
import { CopyButton, CopyMenuButton } from '@/components/message/CopyButton'
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
  SessionPinnedWidget,
  WidgetDraftIntent,
} from '@kila/shared'

// ===== AttachedFileChip =====

function AttachedFileChip({ file, role = 'assistant' }: { file: AttachedFileRef; role?: 'user' | 'assistant' }): React.ReactElement {
  const { t } = useTranslation()
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
        title={t('agent.message.imageRetryTitle')}
      >
        <RotateCw className="size-3.5" />
        {t('agent.message.imageLoadFailedRetry')}
      </button>
    )
  }

  return (
    <div className={cn(
      "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px]",
      role === 'user'
        ? "bg-[hsl(var(--brand-strong)/0.08)] text-brand-soft-foreground"
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
  const { t } = useTranslation()
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
                  {getMessageSourceLabel(message, t)}
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
              basePath={sessionPath || undefined}
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
                tooltip={t('agent.message.editAndResend')}
                label={t('agent.message.editAndResend')}
                onClick={() => onEditTurn(message)}
              >
                <Pencil className="size-4" />
              </MessageAction>
            )}
            {hasVisibleUserBody && onRewindToMessage && (
              <MessageAction
                tooltip={t('agent.message.rewindToMessage')}
                label={t('agent.message.rewindToMessage')}
                onClick={() => onRewindToMessage(message.id)}
              >
                <History className="size-4" />
              </MessageAction>
            )}
            {hasVisibleUserBody && onRegenerateTurn && (
              <MessageAction
                tooltip={t('agent.message.regenerate')}
                label={t('agent.message.regenerate')}
                onClick={() => onRegenerateTurn(message.id)}
              >
                <RotateCw className="size-4" />
              </MessageAction>
            )}
            {messageText && <CopyMenuButton content={messageText} />}
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
                tooltip={t('agent.message.branchSession')}
                label={t('agent.message.branchSession')}
                onClick={() => onBranchFromMessage(message.id)}
              >
                <GitBranch className="size-4" />
              </MessageAction>
            )}
            {message.role === 'assistant' && hasVisibleAssistantBody && onRewindToMessage && (
              <MessageAction
                tooltip={t('agent.message.rewindToMessage')}
                label={t('agent.message.rewindToMessage')}
                onClick={() => onRewindToMessage(message.id)}
              >
                <History className="size-4" />
              </MessageAction>
            )}
            {message.role === 'assistant' && hasVisibleAssistantBody && onRegenerateTurn && (
              <MessageAction
                tooltip={t('agent.message.regenerate')}
                label={t('agent.message.regenerate')}
                onClick={() => onRegenerateTurn(message.id)}
              >
                <RotateCw className="size-4" />
              </MessageAction>
            )}
            {copyText && <CopyMenuButton content={copyText} />}
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
          <CopyMenuButton content={message.content} />
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
                {t('agent.message.compactContext')}
              </Button>
            )}
            {onRetry && (
              <Button size="sm" variant={message.errorCode === 'prompt_too_long' ? 'outline' : 'default'} onClick={onRetry}>
                <RotateCw className="size-3.5 mr-1.5" />
                {t('common.retry')}
              </Button>
            )}
            {onRetryInNewSession && (
              <Button size="sm" variant="outline" onClick={onRetryInNewSession}>
                <Plus className="size-3.5 mr-1.5" />
                {t('agent.message.retryInNewSession')}
              </Button>
            )}
          </div>
        </MessageContent>
        <MessageActions className="mt-0.5">
          <CopyButton content={message.content} />
          <CopyMenuButton content={message.content} />
        </MessageActions>
      </Message>
    )
  }

  return null
})
