import * as React from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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

    /** Electron webview 的 did-fail-load 事件负载（仅取用到的字段） */
    interface WebviewFailLoadEvent {
      errorCode?: number
      errorDescription?: string
    }

    const handleFailLoad = (event: WebviewFailLoadEvent) => {
      // -3 是 ERR_ABORTED，用户主动取消导航时会触发，不算失败
      if (event?.errorCode === -3) return
      setSessionWebPreviewState((prev) => ({
        ...prev,
        isLoading: false,
        serverStatus: prev.serverBaseUrl ? 'error' : prev.serverStatus,
        lastError: event?.errorDescription || t('session.webPreview.loadFailed'),
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
  }, [setSessionWebPreviewState, t, webviewNode])

  const handleSubmit = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const nextUrl = normalizeWebPreviewUrl(state.draftUrl)
    if (!nextUrl) {
      setSessionWebPreviewState((prev) => ({
        ...prev,
        lastError: t('session.webPreview.invalidUrl'),
      }))
      return
    }

    void openUrlInSessionBrowser(nextUrl)
  }, [openUrlInSessionBrowser, setSessionWebPreviewState, state.draftUrl, t])

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
            <div className="text-sm font-medium text-foreground">{t('session.webPreview.title')}</div>
            <div className="text-[11px] text-muted-foreground">{t('session.webPreview.subtitle')}</div>
          </div>
        </div>

        <form aria-label={t('session.webPreview.navigation')} className="flex flex-wrap items-center gap-2" onSubmit={handleSubmit}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 rounded-lg px-3 text-xs"
            onClick={() => { void handleStart() }}
            disabled={state.serverStatus === 'starting'}
            aria-label={t('session.webPreview.start')}
          >
            <Play className="size-3.5" />
            <span>Start</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 rounded-lg px-3 text-xs"
            onClick={handleStop}
            disabled={state.serverStatus === 'idle' && !state.serverBaseUrl}
            aria-label={t('session.webPreview.stop')}
          >
            <Square className="size-3.5" />
            <span>Stop</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg"
            onClick={handleBack}
            disabled={!state.canGoBack}
            aria-label={t('session.webPreview.back')}
          >
            <ArrowLeft className="size-3.5" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg"
            onClick={handleForward}
            disabled={!state.canGoForward}
            aria-label={t('session.webPreview.forward')}
          >
            <ArrowRight className="size-3.5" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg"
            onClick={handleReload}
            disabled={!state.currentUrl}
            aria-label={t('session.webPreview.reload')}
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
            placeholder={t('session.webPreview.urlPlaceholder')}
            aria-label={t('session.webPreview.urlLabel')}
            className="h-8 min-w-[180px] flex-1 rounded-lg border-border/55 bg-background/75 px-3 text-xs"
          />

          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 rounded-lg"
            onClick={handleOpenExternal}
            disabled={!state.currentUrl}
            aria-label={t('session.webPreview.openExternal')}
          >
            <ExternalLink className="size-3.5" />
          </Button>
        </form>

        {state.lastError && (
          <div role="alert" className="mt-2 text-[11px] text-destructive">{state.lastError}</div>
        )}
        {!state.lastError && state.serverBaseUrl && (
          <div className="mt-2 text-[11px] text-muted-foreground">
            {t('session.webPreview.serverRunning', { url: state.serverBaseUrl })}
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
              <div className="text-sm font-medium text-foreground">{t('session.webPreview.emptyTitle')}</div>
              <div className="text-xs leading-5">
                {projectPath
                  ? t('session.webPreview.emptyWithProject')
                  : t('session.webPreview.emptyWithoutProject')}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
