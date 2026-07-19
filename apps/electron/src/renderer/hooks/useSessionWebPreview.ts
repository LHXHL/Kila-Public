import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { agentSidePanelActiveToolMapAtom } from '@/atoms/agent-atoms'
import { sessionWebPreviewStateMapAtom, sessionsAtom } from '@/atoms/session-atoms'
import { useSessionIdOptional } from '@/contexts/session-context'
import {
  createEmptySessionWebPreviewState,
  type SessionWebPreviewState,
  normalizeWebPreviewUrl,
} from '@/components/session/session-web-preview-state'

function updateSessionPreviewMap(
  sessionId: string,
  setStateMap: ReturnType<typeof useSetAtom<typeof sessionWebPreviewStateMapAtom>>,
  updater: SessionWebPreviewState | ((prev: SessionWebPreviewState) => SessionWebPreviewState),
): void {
  setStateMap((prev) => {
    const map = new Map(prev)
    const current = map.get(sessionId) ?? createEmptySessionWebPreviewState()
    const next = typeof updater === 'function'
      ? (updater as (prev: SessionWebPreviewState) => SessionWebPreviewState)(current)
      : updater

    if (next.currentUrl === null
      && next.draftUrl === ''
      && next.serverStatus === 'idle'
      && next.serverBaseUrl === null
      && next.lastPreviewedFilePath === null
      && next.lastError === null
    ) {
      map.delete(sessionId)
    } else {
      map.set(sessionId, next)
    }
    return map
  })
}

export function useSessionWebPreview(explicitSessionId?: string) {
  const contextSessionId = useSessionIdOptional()
  const sessionId = explicitSessionId ?? contextSessionId
  const sessions = useAtomValue(sessionsAtom)
  const previewStateMap = useAtomValue(sessionWebPreviewStateMapAtom)
  const setPreviewStateMap = useSetAtom(sessionWebPreviewStateMapAtom)
  const setSidePanelActiveToolMap = useSetAtom(agentSidePanelActiveToolMapAtom)

  const session = React.useMemo(
    () => (sessionId ? sessions.find((item) => item.id === sessionId) ?? null : null),
    [sessionId, sessions],
  )

  const state = sessionId
    ? previewStateMap.get(sessionId) ?? createEmptySessionWebPreviewState()
    : createEmptySessionWebPreviewState()

  const activateWebTool = React.useCallback(() => {
    if (!sessionId) return
    setSidePanelActiveToolMap((prev) => {
      const map = new Map(prev)
      map.set(sessionId, 'web')
      return map
    })
  }, [sessionId, setSidePanelActiveToolMap])

  const setSessionWebPreviewState = React.useCallback((
    updater: SessionWebPreviewState | ((prev: SessionWebPreviewState) => SessionWebPreviewState),
  ) => {
    if (!sessionId) return
    updateSessionPreviewMap(sessionId, setPreviewStateMap, updater)
  }, [sessionId, setPreviewStateMap])

  const clearSessionWebPreviewState = React.useCallback(() => {
    if (!sessionId) return
    updateSessionPreviewMap(sessionId, setPreviewStateMap, createEmptySessionWebPreviewState())
  }, [sessionId, setPreviewStateMap])

  const openExternal = React.useCallback(async (url: string): Promise<void> => {
    await window.electronAPI.openExternal(url)
  }, [])

  const openUrlInSessionBrowser = React.useCallback(async (url: string): Promise<void> => {
    const normalized = normalizeWebPreviewUrl(url)
    if (!normalized) {
      throw new Error('只支持 http / https 地址')
    }

    if (!sessionId) {
      await openExternal(normalized)
      return
    }

    activateWebTool()
    updateSessionPreviewMap(sessionId, setPreviewStateMap, (prev) => ({
      ...prev,
      draftUrl: normalized,
      currentUrl: normalized,
      isLoading: true,
      lastError: null,
    }))
  }, [activateWebTool, openExternal, sessionId, setPreviewStateMap])

  const startSessionWebPreviewServer = React.useCallback(async () => {
    if (!sessionId) {
      throw new Error('当前上下文没有可启动预览服务的 sessionId')
    }

    activateWebTool()
    updateSessionPreviewMap(sessionId, setPreviewStateMap, (prev) => ({
      ...prev,
      serverStatus: 'starting',
      lastError: null,
    }))

    try {
      const info = await window.electronAPI.startSessionWebPreviewServer(sessionId)
      updateSessionPreviewMap(sessionId, setPreviewStateMap, (prev) => ({
        ...prev,
        serverStatus: 'running',
        serverBaseUrl: info.baseUrl,
        draftUrl: prev.currentUrl ?? info.baseUrl,
        lastError: null,
      }))
      return info
    } catch (error) {
      updateSessionPreviewMap(sessionId, setPreviewStateMap, (prev) => ({
        ...prev,
        serverStatus: 'error',
        lastError: error instanceof Error ? error.message : '启动网页预览服务失败',
      }))
      throw error
    }
  }, [activateWebTool, sessionId, setPreviewStateMap])

  const stopSessionWebPreviewServer = React.useCallback(async (): Promise<void> => {
    if (!sessionId) return
    updateSessionPreviewMap(sessionId, setPreviewStateMap, (prev) => ({
      ...prev,
      isLoading: false,
      lastError: null,
    }))

    try {
      await window.electronAPI.stopSessionWebPreviewServer(sessionId)
      updateSessionPreviewMap(sessionId, setPreviewStateMap, (prev) => {
        const shouldClearCurrentUrl = Boolean(prev.currentUrl && prev.serverBaseUrl && prev.currentUrl.startsWith(prev.serverBaseUrl))
        const nextCurrentUrl = shouldClearCurrentUrl ? null : prev.currentUrl
        return {
          ...prev,
          serverStatus: 'idle',
          serverBaseUrl: null,
          currentUrl: nextCurrentUrl,
          draftUrl: nextCurrentUrl ?? '',
          canGoBack: nextCurrentUrl ? prev.canGoBack : false,
          canGoForward: nextCurrentUrl ? prev.canGoForward : false,
          isLoading: false,
          lastError: null,
        }
      })
    } catch (error) {
      updateSessionPreviewMap(sessionId, setPreviewStateMap, (prev) => ({
        ...prev,
        serverStatus: prev.serverBaseUrl ? 'error' : prev.serverStatus,
        lastError: error instanceof Error ? error.message : '停止网页预览服务失败',
      }))
      throw error
    }
  }, [sessionId, setPreviewStateMap])

  const openHtmlFileInSessionBrowser = React.useCallback(async (filePath: string): Promise<void> => {
    if (!sessionId) {
      await window.electronAPI.previewFile(filePath)
      return
    }

    activateWebTool()
    updateSessionPreviewMap(sessionId, setPreviewStateMap, (prev) => ({
      ...prev,
      serverStatus: 'starting',
      lastError: null,
      lastPreviewedFilePath: filePath,
    }))

    try {
      const resolved = await window.electronAPI.resolveSessionHtmlPreview(sessionId, filePath)
      updateSessionPreviewMap(sessionId, setPreviewStateMap, (prev) => ({
        ...prev,
        serverStatus: 'running',
        serverBaseUrl: resolved.baseUrl,
        currentUrl: resolved.url,
        draftUrl: resolved.url,
        lastPreviewedFilePath: resolved.filePath,
        isLoading: true,
        lastError: null,
      }))
    } catch (error) {
      updateSessionPreviewMap(sessionId, setPreviewStateMap, (prev) => ({
        ...prev,
        serverStatus: 'error',
        isLoading: false,
        lastError: error instanceof Error ? error.message : 'HTML 预览启动失败',
      }))
      throw error
    }
  }, [activateWebTool, sessionId, setPreviewStateMap])

  return {
    sessionId,
    session,
    state,
    activateWebTool,
    setSessionWebPreviewState,
    clearSessionWebPreviewState,
    openExternal,
    openUrlInSessionBrowser,
    openHtmlFileInSessionBrowser,
    startSessionWebPreviewServer,
    stopSessionWebPreviewServer,
  }
}
