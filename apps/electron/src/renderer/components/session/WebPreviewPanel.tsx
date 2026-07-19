import * as React from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, Globe, Play, RotateCw, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSessionWebPreview } from '@/hooks/useSessionWebPreview'
import { WEB_PREVIEW_PARTITION, normalizeWebPreviewUrl } from './session-web-preview-state'
import type { KilaWebviewElement } from '@/types/webview'

interface WebPreviewPanelProps {
  sessionId: string
}

function readWebviewNavigationState(webview: KilaWebviewElement | null) {
  if (!webview) {
    return {
      currentUrl: null,
      canGoBack: false,
      canGoForward: false,
    }
  }

  try {
    return {
      currentUrl: webview.getURL() || null,
      canGoBack: webview.canGoBack(),
      canGoForward: webview.canGoForward(),
    }
  } catch {
    return {
      currentUrl: null,
      canGoBack: false,
      canGoForward: false,
    }
  }
}

export function WebPreviewPanel({ sessionId }: WebPreviewPanelProps): React.ReactElement {
  const {
    session,
    state,
    setSessionWebPreviewState,
    clearSessionWebPreviewState,
    openExternal,
    openUrlInSessionBrowser,
    openHtmlFileInSessionBrowser,
    startSessionWebPreviewServer,
    stopSessionWebPreviewServer,
  } = useSessionWebPreview(sessionId)
  const [webviewNode, setWebviewNode] = React.useState<KilaWebviewElement | null>(null)
  const [isWebviewDomReady, setIsWebviewDomReady] = React.useState(false)
  const previousProjectPathRef = React.useRef<string | null>(session?.project.path ?? null)
  const projectPath = session?.project.path ?? null
  const handleWebviewRef = React.useCallback((node: KilaWebviewElement | null) => {
    setWebviewNode((prev) => (prev === node ? prev : node))
  }, [])

  React.useEffect(() => {
    setIsWebviewDomReady(false)
  }, [webviewNode])

  React.useEffect(() => {
    const previousProjectPath = previousProjectPathRef.current
    if (previousProjectPath === null) {
      previousProjectPathRef.current = projectPath
      return
    }

    if (projectPath !== previousProjectPath) {
      previousProjectPathRef.current = projectPath
      clearSessionWebPreviewState()
    }
  }, [clearSessionWebPreviewState, projectPath])

  React.useEffect(() => {
    if (!webviewNode) return

    const syncNavigation = () => {
      const navigation = readWebviewNavigationState(webviewNode)
      setSessionWebPreviewState((prev) => ({
        ...prev,
        currentUrl: navigation.currentUrl ?? prev.currentUrl,
        draftUrl: navigation.currentUrl ?? prev.draftUrl,
        canGoBack: navigation.canGoBack,
        canGoForward: navigation.canGoForward,
      }))
    }

    const handleStartLoading = () => {
      setSessionWebPreviewState((prev) => ({
        ...prev,
        isLoading: true,
        lastError: null,
      }))
    }

    const handleStopLoading = () => {
      const navigation = readWebviewNavigationState(webviewNode)
      setSessionWebPreviewState((prev) => ({
        ...prev,
        isLoading: false,
        serverStatus: prev.serverBaseUrl ? 'running' : prev.serverStatus,
        currentUrl: navigation.currentUrl ?? prev.currentUrl,
        draftUrl: navigation.currentUrl ?? prev.draftUrl,
        canGoBack: navigation.canGoBack,
        canGoForward: navigation.canGoForward,
        lastError: null,
      }))
    }

    const handleDomReady = () => {
      setIsWebviewDomReady(true)
      syncNavigation()
    }

    const handleFailLoad = (event: any) => {
      if (event?.errorCode === -3) return
      setSessionWebPreviewState((prev) => ({
        ...prev,
        isLoading: false,
        serverStatus: prev.serverBaseUrl ? 'error' : prev.serverStatus,
        lastError: event?.errorDescription || '网页加载失败',
      }))
    }

    webviewNode.addEventListener('dom-ready', handleDomReady)
    webviewNode.addEventListener('did-start-loading', handleStartLoading)
    webviewNode.addEventListener('did-stop-loading', handleStopLoading)
    webviewNode.addEventListener('did-navigate', syncNavigation)
    webviewNode.addEventListener('did-navigate-in-page', syncNavigation)
    webviewNode.addEventListener('did-fail-load', handleFailLoad)

    return () => {
      webviewNode.removeEventListener('dom-ready', handleDomReady)
      webviewNode.removeEventListener('did-start-loading', handleStartLoading)
      webviewNode.removeEventListener('did-stop-loading', handleStopLoading)
      webviewNode.removeEventListener('did-navigate', syncNavigation)
      webviewNode.removeEventListener('did-navigate-in-page', syncNavigation)
      webviewNode.removeEventListener('did-fail-load', handleFailLoad)
    }
  }, [setSessionWebPreviewState, webviewNode])

  const handleSubmit = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const nextUrl = normalizeWebPreviewUrl(state.draftUrl)
    if (!nextUrl) {
      setSessionWebPreviewState((prev) => ({
        ...prev,
        lastError: '只支持 http / https 地址',
      }))
      return
    }

    void openUrlInSessionBrowser(nextUrl)
  }, [openUrlInSessionBrowser, setSessionWebPreviewState, state.draftUrl])

  const handleStart = React.useCallback(async () => {
    const info = await startSessionWebPreviewServer()
    if (state.lastPreviewedFilePath) {
      await openHtmlFileInSessionBrowser(state.lastPreviewedFilePath)
      return
    }
    await openUrlInSessionBrowser(info.baseUrl)
  }, [openHtmlFileInSessionBrowser, openUrlInSessionBrowser, startSessionWebPreviewServer, state.lastPreviewedFilePath])

  const handleOpenExternal = React.useCallback(() => {
    if (!state.currentUrl) return
    void openExternal(state.currentUrl)
  }, [openExternal, state.currentUrl])

  const handleStop = React.useCallback(() => {
    void stopSessionWebPreviewServer()
  }, [stopSessionWebPreviewServer])

  const handleBack = React.useCallback(() => {
    if (!isWebviewDomReady) return
    webviewNode?.goBack()
  }, [isWebviewDomReady, webviewNode])

  const handleForward = React.useCallback(() => {
    if (!isWebviewDomReady) return
    webviewNode?.goForward()
  }, [isWebviewDomReady, webviewNode])

  const handleReload = React.useCallback(() => {
    if (!isWebviewDomReady) return
    webviewNode?.reload()
  }, [isWebviewDomReady, webviewNode])

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className="px-3 pb-2.5 pt-3">
        <div className="mb-2 flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg border border-border/45 bg-muted/35">
            <Globe className="size-4 text-foreground/70" />
          </div>
          <div>
            <div className="text-sm font-medium text-foreground">网页预览</div>
            <div className="text-[11px] text-muted-foreground">点击 Start 启动本地预览服务，或直接输入 http / https 地址。</div>
          </div>
        </div>

        <form aria-label="网页预览导航" className="flex flex-wrap items-center gap-2" onSubmit={handleSubmit}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 rounded-full px-3 text-xs"
            onClick={() => { void handleStart() }}
            disabled={state.serverStatus === 'starting'}
            aria-label="启动本地预览服务"
          >
            <Play className="size-3.5" />
            <span>Start</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 rounded-full px-3 text-xs"
            onClick={handleStop}
            disabled={state.serverStatus === 'idle' && !state.serverBaseUrl}
            aria-label="停止本地预览服务"
          >
            <Square className="size-3.5" />
            <span>Stop</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={handleBack}
            disabled={!state.canGoBack}
            aria-label="后退"
          >
            <ArrowLeft className="size-3.5" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={handleForward}
            disabled={!state.canGoForward}
            aria-label="前进"
          >
            <ArrowRight className="size-3.5" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={handleReload}
            disabled={!state.currentUrl}
            aria-label="刷新网页"
          >
            <RotateCw className={`size-3.5 ${state.isLoading ? 'animate-spin' : ''}`} />
          </Button>

          <Input
            value={state.draftUrl}
            onChange={(event) => {
              const nextDraftUrl = event.target.value
              setSessionWebPreviewState((prev) => ({
                ...prev,
                draftUrl: nextDraftUrl,
                lastError: null,
              }))
            }}
            placeholder="Enter URL or start a preview server..."
            aria-label="预览地址"
            className="h-8 min-w-[180px] flex-1 rounded-full border-border/55 bg-background/75 px-3 text-xs"
          />

          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={handleOpenExternal}
            disabled={!state.currentUrl}
            aria-label="在外部浏览器打开"
          >
            <ExternalLink className="size-3.5" />
          </Button>
        </form>

        {state.lastError && (
          <div role="alert" className="mt-2 text-[11px] text-destructive">{state.lastError}</div>
        )}
        {!state.lastError && state.serverBaseUrl && (
          <div className="mt-2 text-[11px] text-muted-foreground">
            本地预览服务运行中：{state.serverBaseUrl}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 bg-muted/15">
        {state.currentUrl ? (
          <webview
            ref={handleWebviewRef}
            src={state.currentUrl}
            partition={WEB_PREVIEW_PARTITION}
            webpreferences="contextIsolation=yes, nodeIntegration=no, sandbox=yes"
            className="h-full w-full bg-background"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6">
            <div className="flex max-w-[280px] flex-col items-center gap-2 text-center text-muted-foreground">
              <Globe className="size-8" />
              <div className="text-sm font-medium text-foreground">输入 URL 或点击 Start 启动本地预览服务</div>
              <div className="text-xs leading-5">
                {projectPath
                  ? '打开 HTML 文件时会自动预览，Start 也可以手动打开当前会话项目目录的本地预览服务。'
                  : '当前会话还没有可用的项目目录。'}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
