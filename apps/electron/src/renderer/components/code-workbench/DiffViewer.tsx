import * as React from 'react'
import type { HighlightToken } from '@kila/core'
import { cn } from '@/lib/utils'
import { parseUnifiedDiffLines, type DiffDisplayLine } from './diff-lines'
import { useCodeTokens } from './use-code-tokens'

interface DiffViewerProps {
  patch: string
  language: string
  contentOnly?: boolean
  className?: string
}

const INITIAL_VISIBLE_DIFF_LINE_COUNT = 800
const VISIBLE_DIFF_LINE_BATCH_SIZE = 800

export function getDiffViewerVisibleLineCount(lineCount: number, requestedLineCount: number): number {
  return Math.min(lineCount, Math.max(INITIAL_VISIBLE_DIFF_LINE_COUNT, requestedLineCount))
}

function DiffTokenLine({ tokens, rawLine }: { tokens: HighlightToken[] | undefined; rawLine: string }): React.ReactElement {
  if (!tokens) return <>{rawLine || ' '}</>
  const coveredLength = tokens.reduce((total, token) => total + token.content.length, 0)
  return (
    <>
      {tokens.map((token, index) => (
        <span key={`${index}:${token.content}`} style={token.color ? { color: token.color } : undefined}>
          {token.content}
        </span>
      ))}
      {coveredLength < rawLine.length ? rawLine.slice(coveredLength) : null}
      {rawLine.length === 0 ? ' ' : null}
    </>
  )
}

function lineTone(line: DiffDisplayLine): string {
  if (line.kind === 'addition') return 'bg-[hsl(var(--status-success-soft)/0.72)]'
  if (line.kind === 'deletion') return 'bg-[hsl(var(--status-danger-soft)/0.7)]'
  if (line.kind === 'header') return 'bg-[hsl(var(--status-info-soft)/0.7)] text-[hsl(var(--status-info-foreground))]'
  if (line.kind === 'meta') return 'bg-muted/25 text-muted-foreground/70'
  return 'text-foreground/88 hover:bg-foreground/[0.025]'
}

function markerTone(line: DiffDisplayLine): string {
  if (line.kind === 'addition') return 'text-[hsl(var(--status-success-foreground))]'
  if (line.kind === 'deletion') return 'text-[hsl(var(--status-danger-foreground))]'
  return 'text-muted-foreground/35'
}

/** 语义化 unified diff：双侧行号、增删背景和源码 token 高亮。 */
export const DiffViewer = React.memo(function DiffViewer({
  patch,
  language,
  contentOnly = false,
  className,
}: DiffViewerProps): React.ReactElement {
  const parsedLines = React.useMemo(() => parseUnifiedDiffLines(patch), [patch])
  const filteredLines = React.useMemo(
    () => contentOnly
      ? parsedLines.filter((line) => line.kind !== 'header' && (line.kind !== 'meta' || line.content.startsWith('\\ No newline')))
      : parsedLines,
    [contentOnly, parsedLines],
  )
  const windowSource = `${contentOnly ? 'content' : 'full'}:${patch}`
  const [lineWindow, setLineWindow] = React.useState(() => ({
    source: windowSource,
    requestedLineCount: INITIAL_VISIBLE_DIFF_LINE_COUNT,
  }))
  const loadMoreRef = React.useRef<HTMLDivElement | null>(null)
  const requestedLineCount = lineWindow.source === windowSource
    ? lineWindow.requestedLineCount
    : INITIAL_VISIBLE_DIFF_LINE_COUNT
  const visibleLineCount = getDiffViewerVisibleLineCount(filteredLines.length, requestedLineCount)
  const visibleLines = React.useMemo(
    () => filteredLines.slice(0, visibleLineCount),
    [filteredLines, visibleLineCount],
  )
  const hiddenLineCount = Math.max(0, filteredLines.length - visibleLines.length)
  const highlightSource = React.useMemo(
    () => visibleLines.map((line) => line.kind === 'meta' || line.kind === 'header' ? '' : line.content).join('\n'),
    [visibleLines],
  )
  const tokenResult = useCodeTokens(highlightSource, language)

  React.useEffect(() => {
    const target = loadMoreRef.current
    if (!target || hiddenLineCount === 0) return

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      setLineWindow((current) => ({
        source: windowSource,
        requestedLineCount: (current.source === windowSource
          ? current.requestedLineCount
          : INITIAL_VISIBLE_DIFF_LINE_COUNT) + VISIBLE_DIFF_LINE_BATCH_SIZE,
      }))
    }, { rootMargin: '720px 0px' })

    observer.observe(target)
    return () => observer.disconnect()
  }, [hiddenLineCount, windowSource])

  return (
    <div className={cn('min-w-max py-1 font-mono text-[11px] leading-[1.65]', className)}>
      {visibleLines.map((line, index) => {
        const marker = line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '−' : ' '
        const isSourceLine = line.kind === 'addition' || line.kind === 'deletion' || line.kind === 'context'
        return (
          <div
            key={`${index}:${line.kind}:${line.oldLineNumber}:${line.newLineNumber}`}
            className={cn('group flex min-h-[20px] items-stretch', lineTone(line))}
          >
            <span className="sticky left-0 z-[2] w-[4.25ch] shrink-0 select-none bg-inherit pr-1.5 text-right tabular-nums text-muted-foreground/45">
              {line.oldLineNumber ?? ''}
            </span>
            <span className="sticky left-[4.25ch] z-[2] w-[4.25ch] shrink-0 select-none bg-inherit pr-1.5 text-right tabular-nums text-muted-foreground/45">
              {line.newLineNumber ?? ''}
            </span>
            <span className={cn('sticky left-[8.5ch] z-[2] w-[2.5ch] shrink-0 select-none bg-inherit text-center font-semibold', markerTone(line))}>
              {marker}
            </span>
            <span className={cn('whitespace-pre px-2 pr-8', !isSourceLine && 'italic')}>
              {isSourceLine
                ? <DiffTokenLine tokens={tokenResult?.lines[index]} rawLine={line.content} />
                : line.content || ' '}
            </span>
          </div>
        )
      })}
      {hiddenLineCount > 0 && <div ref={loadMoreRef} className="h-px min-w-full" aria-hidden="true" />}
    </div>
  )
})
