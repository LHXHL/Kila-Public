/**
 * ThinkingProcessCard — 思考过程折叠卡片
 *
 * 对标 LobeHub Thinking 组件：
 * - Accordion 手风琴折叠，标题行轻量无边框
 * - 图标：思考中 Loader2 旋转 / 完成后 Brain
 * - 展开内容：限高滚动区域，弱化文字色
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Brain, ChevronDown, Loader2 } from 'lucide-react'
import { MessageResponse, StreamingMessageResponse } from '@/components/ai-elements/message'
import { useSmoothStreamContent } from '@kila/ui'
import { cn } from '@/lib/utils'
import { useProcessDisclosure } from '../use-process-disclosure'
import {
  getRenderablePayloadText,
  getThinkingTitle,
  TOOL_PAYLOAD_EXPANDED_MAX_CHARS,
} from '../agent-messages-utils'
import type { ThinkingProcessEntry } from '@/atoms/agent-atoms'

// ===== StatusIcon — 状态小方块图标 =====

function StatusIcon({
  running,
  open,
}: {
  running: boolean
  open: boolean
}): React.ReactElement {
  return (
    <div
      className={cn(
        'flex size-6 shrink-0 items-center justify-center text-[12px] transition-colors duration-200',
        running
          ? 'text-muted-foreground'
          : open
            ? 'text-foreground/75'
            : 'text-muted-foreground',
      )}
    >
      {running ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Brain className="size-3.5" />
      )}
    </div>
  )
}


function ThinkingBody({
  text,
  running,
  sessionPath,
}: {
  text: string
  running: boolean
  sessionPath?: string | null
}): React.ReactElement {
  const { t, i18n } = useTranslation()
  const renderedThinking = React.useMemo(
    () => getRenderablePayloadText(text, TOOL_PAYLOAD_EXPANDED_MAX_CHARS),
    [text],
  )
  const smoothedThinking = useSmoothStreamContent(renderedThinking.text, {
    enabled: running,
    preset: 'balanced',
  })

  return (
    <div className="animate-in fade-in slide-in-from-top-1 duration-150">
      <div className="mx-1.5 max-h-[min(40vh,320px)] overflow-y-auto rounded-lg px-2 pb-2 pt-1 text-muted-foreground scrollbar-thin">
        {running ? (
          <StreamingMessageResponse
            compact
            basePath={sessionPath || undefined}
            className="text-muted-foreground [&_*]:text-inherit"
          >
            {smoothedThinking}
          </StreamingMessageResponse>
        ) : (
          <MessageResponse
            compact
            basePath={sessionPath || undefined}
            className="text-muted-foreground [&_*]:text-inherit"
          >
            {renderedThinking.text}
          </MessageResponse>
        )}
        {renderedThinking.truncatedCharCount > 0 && (
          <div className="mt-2 text-[10px] text-muted-foreground/70">
            {t('agent.thinking.truncated', {
              count: renderedThinking.truncatedCharCount,
              chars: renderedThinking.truncatedCharCount.toLocaleString(i18n.language),
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ===== ThinkingProcessCard =====

export function ThinkingProcessCard({
  entry,
  startedAt,
  streaming,
  sessionPath,
  fallback = false,
}: {
  entry?: ThinkingProcessEntry
  startedAt?: number
  streaming?: boolean
  sessionPath?: string | null
  fallback?: boolean
}): React.ReactElement {
  const { t } = useTranslation()
  const running = fallback ? Boolean(streaming) : Boolean(streaming && entry && !entry.done)
  const fullText = entry?.fullText ?? entry?.text
  const hasBody = !fallback && Boolean(fullText)
  const { open, setOpen, durationLabel } = useProcessDisclosure({
    hasBody,
    running,
    startedAt: entry?.startedAt ?? (running ? startedAt : undefined),
    elapsedSeconds: entry?.elapsedSeconds,
  })
  const title = getThinkingTitle(durationLabel, running, t, entry?.summaryText ?? fullText)
  const fullTextValue = fullText ?? ''

  return (
    <div className="w-full">
      {/* 标题行 — 点击展开/收起 */}
      <button
        type="button"
        disabled={!hasBody}
        aria-expanded={hasBody ? open : undefined}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors duration-200 disabled:opacity-100',
          hasBody && 'cursor-pointer hover:bg-muted/20',
        )}
        onClick={hasBody ? () => setOpen((v) => !v) : undefined}
      >
        <StatusIcon running={running} open={open} />
        <span
          className={cn(
            'flex-1 truncate text-[13px] transition-colors duration-200',
            running ? 'font-medium text-foreground/80' : 'text-muted-foreground',
          )}
        >
          {title}
        </span>
        {hasBody && (
          <ChevronDown
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground/40 transition-transform duration-200',
              open && 'rotate-180',
            )}
          />
        )}
      </button>

      {/* 关闭时完全卸载重内容，展开点击只执行同步状态更新。 */}
      {hasBody && open && (
        <ThinkingBody text={fullTextValue} running={running} sessionPath={sessionPath} />
      )}
    </div>
  )
}
