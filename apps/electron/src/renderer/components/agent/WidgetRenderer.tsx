import * as React from 'react'
import type {
  SessionPinnedWidget,
  WidgetDraftIntent,
  WidgetDraftIntentSource,
} from '@kila/shared'
import { AlertTriangle, Code, Pin, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import {
  DEFAULT_WIDGET_INTRINSIC_HEIGHT,
  MAX_WIDGET_IFRAME_HEIGHT,
  STREAM_WIDGET_DEBOUNCE_MS,
  STREAM_WIDGET_PLACEHOLDER_HEIGHT,
} from '@/lib/generative-ui/constants'
import {
  sanitizeForIframe,
  sanitizeForStreaming,
} from '@/lib/generative-ui/widget-sanitizer'
import {
  getWidgetIframeStyleBlock,
  resolveThemeVars,
} from '@/lib/generative-ui/widget-css-bridge'
import {
  getCachedWidgetHeight,
  getWidgetCacheKey,
  setCachedWidgetHeight,
} from '@/lib/generative-ui/widget-height-cache'
import { useSessionWebPreview } from '@/hooks/useSessionWebPreview'
import {
  containsAllowedWidgetCdnUrl,
  normalizeWidgetExternalUrl,
} from '@/lib/generative-ui/widget-url'
import { WidgetErrorBoundary } from './WidgetErrorBoundary'

interface WidgetRendererProps {
  widgetCode: string
  title?: string
  cacheKey?: string
  isStreaming?: boolean
  showOverlay?: boolean
  sessionId?: string
  sourceMessageId?: string
  sourceBlockKey?: string
  onPinned?: (widget: SessionPinnedWidget) => void
  onDraftIntent?: (intent: WidgetDraftIntent) => void
  draftSource?: WidgetDraftIntentSource
}

const WIDGET_DRAFT_PROMPT_MAX_CHARS = 600
const WIDGET_DRAFT_LABEL_MAX_CHARS = 80

function normalizeWidgetDraftIntent(
  rawIntent: unknown,
  source?: WidgetDraftIntentSource,
): WidgetDraftIntent | null {
  if (!source || !rawIntent || typeof rawIntent !== 'object') return null

  const intent = rawIntent as Partial<WidgetDraftIntent>
  if (intent.type !== 'draft_message') return null

  const prompt = typeof intent.prompt === 'string' ? intent.prompt.trim() : ''
  const promptWithinLimit = prompt.length <= WIDGET_DRAFT_PROMPT_MAX_CHARS
  if (!prompt || !promptWithinLimit) return null

  const label = typeof intent.label === 'string'
    ? intent.label.trim().slice(0, WIDGET_DRAFT_LABEL_MAX_CHARS)
    : undefined

  return {
    type: 'draft_message',
    prompt,
    ...(label ? { label } : {}),
    source,
  }
}

function WidgetRendererInner({
  widgetCode,
  title,
  cacheKey,
  isStreaming = false,
  showOverlay = false,
  sessionId,
  sourceMessageId,
  sourceBlockKey,
  onPinned,
  onDraftIntent,
  draftSource,
}: WidgetRendererProps): React.ReactElement {
  const { openExternal, openUrlInSessionBrowser } = useSessionWebPreview(sessionId)
  const resolvedCacheKey = React.useMemo(
    () => cacheKey || getWidgetCacheKey(widgetCode),
    [cacheKey, widgetCode],
  )
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null)
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSentMessageRef = React.useRef<{ type: 'widget:update' | 'widget:finalize'; html: string } | null>(null)
  const finalizedCodeRef = React.useRef('')
  const heightLockedRef = React.useRef(false)
  const [iframeReady, setIframeReady] = React.useState(false)
  const [iframeHeight, setIframeHeight] = React.useState<number>(() => (
    getCachedWidgetHeight(resolvedCacheKey)
    ?? (isStreaming ? STREAM_WIDGET_PLACEHOLDER_HEIGHT : DEFAULT_WIDGET_INTRINSIC_HEIGHT)
  ))
  const [showCode, setShowCode] = React.useState(false)
  const [finalized, setFinalized] = React.useState(false)
  const [isPinning, setIsPinning] = React.useState(false)
  const [widgetError, setWidgetError] = React.useState<string | null>(null)
  const [frameRevision, setFrameRevision] = React.useState(0)

  const hasCdnScript = React.useMemo(
    () => containsAllowedWidgetCdnUrl(widgetCode),
    [widgetCode],
  )
  const canPin = Boolean(sessionId && sourceMessageId && sourceBlockKey && !isStreaming)


  const updateIframeHeight = React.useCallback((height: number): void => {
    const nextHeight = Math.min(Math.max(1, Math.ceil(height + 2)), MAX_WIDGET_IFRAME_HEIGHT)

    setCachedWidgetHeight(resolvedCacheKey, nextHeight)
    setIframeHeight((previousHeight) => (
      heightLockedRef.current
        ? Math.max(previousHeight, nextHeight)
        : nextHeight
    ))
  }, [resolvedCacheKey])

  React.useEffect(() => {
    function handleMessage(event: MessageEvent): void {
      const sourceWindow = iframeRef.current?.contentWindow
      if (!event.data || typeof event.data.type !== 'string' || !sourceWindow || event.source !== sourceWindow) {
        return
      }

      if (event.data.type === 'widget:ready') {
        setWidgetError(null)
        setIframeReady(true)
        return
      }

      if (event.data.type === 'widget:error') {
        const message = typeof event.data.message === 'string' && event.data.message.trim()
          ? event.data.message.trim()
          : 'Widget 渲染失败'
        heightLockedRef.current = false
        setFinalized(true)
        setWidgetError(message)
        return
      }

      if (event.data.type === 'widget:rendered') {
        heightLockedRef.current = false
        setFinalized(true)
        return
      }

      if (event.data.type === 'widget:resize' && typeof event.data.height === 'number') {
        updateIframeHeight(event.data.height)
        return
      }

      if (event.data.type === 'widget:link') {
        const href = normalizeWidgetExternalUrl(event.data.href)
        if (href) {
          void openUrlInSessionBrowser(href).catch(() => {
            void openExternal(href).catch((error) => {
              console.error('[WidgetRenderer] 打开 Widget 链接失败:', error)
              toast.error('无法打开 Widget 链接')
            })
          })
        }
        return
      }

      if (event.data.type === 'widget:intent') {
        const normalizedIntent = normalizeWidgetDraftIntent(event.data.intent, draftSource)
        if (normalizedIntent) {
          onDraftIntent?.(normalizedIntent)
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [draftSource, onDraftIntent, openExternal, openUrlInSessionBrowser, updateIframeHeight])

  const postWidgetMessage = React.useCallback((type: 'widget:update' | 'widget:finalize', html: string): void => {
    const contentWindow = iframeRef.current?.contentWindow
    if (!contentWindow) return

    const lastSentMessage = lastSentMessageRef.current
    if (lastSentMessage?.type === type && lastSentMessage.html === html) return

    lastSentMessageRef.current = { type, html }
    contentWindow.postMessage({ type, html }, '*')
  }, [])

  React.useEffect(() => {
    if (!isStreaming || !iframeReady) return
    setWidgetError(null)

    const html = sanitizeForStreaming(widgetCode)

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(() => {
      postWidgetMessage('widget:update', html)
    }, STREAM_WIDGET_DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [iframeReady, isStreaming, postWidgetMessage, widgetCode])

  React.useEffect(() => {
    if (isStreaming || !iframeReady) return
    if (finalizedCodeRef.current === widgetCode) return

    const html = sanitizeForIframe(widgetCode)
    setWidgetError(null)
    finalizedCodeRef.current = widgetCode
    heightLockedRef.current = true
    setFinalized(false)

    postWidgetMessage('widget:finalize', html)
  }, [iframeReady, isStreaming, postWidgetMessage, widgetCode])

  React.useEffect(() => {
    if (!iframeReady) return

    const syncTheme = (): void => {
      const vars = resolveThemeVars()
      iframeRef.current?.contentWindow?.postMessage({
        type: 'widget:theme',
        vars,
        styleBlock: getWidgetIframeStyleBlock(vars),
        isDark: document.documentElement.classList.contains('dark'),
      }, '*')
    }

    syncTheme()

    const observer = new MutationObserver(syncTheme)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    return () => observer.disconnect()
  }, [iframeReady])

  React.useEffect(() => {
    if (iframeReady || widgetError) return

    const timer = window.setTimeout(() => {
      setWidgetError('Widget 运行环境加载超时，请检查应用资源或重试')
    }, 10_000)

    return () => window.clearTimeout(timer)
  }, [frameRevision, iframeReady, widgetError])

  React.useEffect(() => {
    setIframeHeight(
      getCachedWidgetHeight(resolvedCacheKey)
      ?? (isStreaming ? STREAM_WIDGET_PLACEHOLDER_HEIGHT : DEFAULT_WIDGET_INTRINSIC_HEIGHT),
    )
  }, [isStreaming, resolvedCacheKey])

  const handleRetry = React.useCallback((): void => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    lastSentMessageRef.current = null
    finalizedCodeRef.current = ''
    heightLockedRef.current = false
    setIframeReady(false)
    setFinalized(false)
    setWidgetError(null)
    setFrameRevision((value) => value + 1)
  }, [])

  const handlePin = React.useCallback(async (): Promise<void> => {
    if (!canPin || !sessionId || !sourceMessageId || !sourceBlockKey) return

    setIsPinning(true)

    try {
      const pinnedWidget = await window.electronAPI.pinSessionWidget({
        sessionId,
        sourceMessageId,
        sourceBlockKey,
        title: title?.trim() || 'Widget',
        payload: {
          title,
          widget_code: widgetCode,
        },
      })
      onPinned?.(pinnedWidget)
      toast.success('已固定到右侧 Board')
    } catch (error) {
      console.error('[WidgetRenderer] 固定 widget 失败:', error)
      toast.error('固定 widget 失败')
    } finally {
      setIsPinning(false)
    }
  }, [canPin, onPinned, sessionId, sourceBlockKey, sourceMessageId, title, widgetCode])

  const overlayVisible = !widgetError && (showOverlay || (hasCdnScript && !isStreaming && iframeReady && !finalized))

  return (
    <div className="group/widget relative my-1.5 w-full overflow-hidden rounded-xl border border-border/30 bg-background/40">
      <iframe
        key={frameRevision}
        ref={iframeRef}
        sandbox="allow-scripts"
        src="./widget-frame.html"
        title={title || 'Widget'}
        style={{
          width: '100%',
          height: showCode ? 0 : iframeHeight,
          border: 'none',
          display: showCode || widgetError ? 'none' : 'block',
          overflow: 'hidden',
          background: 'transparent',
          transition: 'height 200ms ease',
        }}
      />

      {widgetError && !showCode && (
        <div className="flex min-h-44 flex-col items-center justify-center gap-3 px-6 py-8 text-center" role="alert">
          <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="size-5" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Widget 无法渲染</p>
            <p className="max-w-xl text-xs leading-5 text-muted-foreground">{widgetError}</p>
          </div>
          <button
            type="button"
            onClick={handleRetry}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCcw className="size-3.5" />
            重试渲染
          </button>
        </div>
      )}

      {overlayVisible && !showCode && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, rgba(120,120,120,0.08) 50%, transparent 100%)',
            backgroundSize: '200% 100%',
            animation: 'widget-shimmer 1.5s ease-in-out infinite',
          }}
        />
      )}

      {showCode && (
        <pre className="max-h-80 overflow-auto border-t border-border/20 bg-muted/25 p-3 text-[11px] text-foreground/75">
          <code>{widgetCode}</code>
        </pre>
      )}

      <div className="absolute right-2 top-2 flex items-center gap-1 opacity-70 transition-opacity hover:opacity-100 group-hover/widget:opacity-100 group-focus-within/widget:opacity-100">
        {canPin && (
          <button
            type="button"
            onClick={() => { void handlePin() }}
            disabled={isPinning}
            className="inline-flex items-center gap-1 rounded-md border border-border/25 bg-background/80 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:cursor-wait disabled:opacity-60"
          >
            <Pin className="size-3.5" />
            {isPinning ? '固定中…' : '固定'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowCode((value) => !value)}
          className="inline-flex items-center gap-1 rounded-md border border-border/25 bg-background/80 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Code className="size-3.5" />
          {showCode ? '隐藏代码' : '查看代码'}
        </button>
      </div>
    </div>
  )
}

export function WidgetRenderer(props: WidgetRendererProps): React.ReactElement {
  return (
    <WidgetErrorBoundary>
      <WidgetRendererInner {...props} />
    </WidgetErrorBoundary>
  )
}
