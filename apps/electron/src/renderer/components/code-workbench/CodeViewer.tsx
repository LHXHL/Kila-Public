import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { HighlightToken } from '@kila/core'
import { cn } from '@/lib/utils'
import { useCodeTokens } from './use-code-tokens'

interface CodeViewerProps {
  code: string
  language: string
  className?: string
  ariaLabel?: string
}

const INITIAL_VISIBLE_LINE_COUNT = 800
const VISIBLE_LINE_BATCH_SIZE = 800

export function getCodeViewerVisibleLineCount(lineCount: number, requestedLineCount: number): number {
  return Math.min(lineCount, Math.max(INITIAL_VISIBLE_LINE_COUNT, requestedLineCount))
}

function TokenLine({ tokens, rawLine }: { tokens: HighlightToken[] | undefined; rawLine: string }): React.ReactElement {
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

/** 面向文件阅读的完整代码视图：始终显示行号，不折叠，不使用聊天代码块外壳。 */
export const CodeViewer = React.memo(function CodeViewer({
  code,
  language,
  className,
  ariaLabel,
}: CodeViewerProps): React.ReactElement {
  const { t } = useTranslation()
  const normalizedCode = code.replace(/\n$/, '')
  const lines = React.useMemo(() => normalizedCode.split('\n'), [normalizedCode])
  const [lineWindow, setLineWindow] = React.useState(() => ({
    source: code,
    requestedLineCount: INITIAL_VISIBLE_LINE_COUNT,
  }))
  const viewportRef = React.useRef<HTMLDivElement | null>(null)
  const loadMoreRef = React.useRef<HTMLDivElement | null>(null)
  const requestedLineCount = lineWindow.source === code
    ? lineWindow.requestedLineCount
    : INITIAL_VISIBLE_LINE_COUNT
  const visibleLineCount = getCodeViewerVisibleLineCount(lines.length, requestedLineCount)
  const visibleLines = React.useMemo(() => lines.slice(0, visibleLineCount), [lines, visibleLineCount])
  const visibleCode = React.useMemo(() => visibleLines.join('\n'), [visibleLines])
  const tokenResult = useCodeTokens(visibleCode, language)
  const lineNumberWidth = Math.max(3, String(lines.length).length)
  const hiddenLineCount = Math.max(0, lines.length - visibleLines.length)

  React.useEffect(() => {
    const target = loadMoreRef.current
    const root = viewportRef.current
    if (!target || !root || hiddenLineCount === 0) return

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      setLineWindow((current) => ({
        source: code,
        requestedLineCount: (current.source === code
          ? current.requestedLineCount
          : INITIAL_VISIBLE_LINE_COUNT) + VISIBLE_LINE_BATCH_SIZE,
      }))
    }, { root, rootMargin: '720px 0px' })

    observer.observe(target)
    return () => observer.disconnect()
  }, [code, hiddenLineCount])

  return (
    <div
      ref={viewportRef}
      className={cn(
        'h-full min-h-0 overflow-auto bg-code-surface shadow-[inset_0_1px_0_hsl(var(--foreground)/0.035)]',
        className,
      )}
      aria-label={ariaLabel ?? t('fileBrowser.codeViewer.label')}
    >
      <pre className="m-0 min-w-max py-3 font-mono text-[12px] leading-[1.7] text-foreground/90">
        <code className="block">
          {visibleLines.map((line, index) => (
            <span key={index} className="flex min-h-[20px]">
              <span
                aria-hidden="true"
                className="sticky left-0 z-[1] shrink-0 select-none bg-[hsl(var(--code-surface)/0.96)] px-3 text-right tabular-nums text-muted-foreground/45 backdrop-blur-sm"
                style={{ width: `${lineNumberWidth + 2.25}ch` }}
              >
                {index + 1}
              </span>
              <span className="px-4 pr-8">
                <TokenLine tokens={tokenResult?.lines[index]} rawLine={line} />
              </span>
            </span>
          ))}
        </code>
      </pre>
      {hiddenLineCount > 0 && <div ref={loadMoreRef} className="h-px w-full" aria-hidden="true" />}
    </div>
  )
})
