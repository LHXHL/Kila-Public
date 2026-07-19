import { useEffect } from 'react'
import { useStore } from 'jotai'
import type {
  SessionStreamCompletePayload,
  SessionStreamErrorPayload,
  SessionTitleUpdatedPayload,
  SessionUpdatedPayload,
} from '@kila/shared'
import {
  cachedTeamActivitiesAtom,
  cachedTeamOverviewsAtom,
  dismissedTeamSessionIdsAtom,
  buildTeamActivityEntries,
  extractTeamOverview,
} from '@/atoms/agent-team-atoms'
import { agentStreamingStatesAtom } from '@/atoms/agent-stream-atoms'
import {
  agentAttachedDirectoriesMapAtom,
  agentMessageHydratingAtom,
  agentMessageRefreshAtom,
  agentPendingFilesMapAtom,
  agentPendingPromptAtom,
  agentPromptSuggestionsAtom,
  agentQueuedSendMapAtom,
  agentSessionDraftsAtom,
  agentSidePanelActiveToolMapAtom,
  agentSidePanelCloseRequestMapAtom,
  agentStreamErrorsAtom,
  backgroundTasksAtomFamily,
  disposePendingFiles,
  releaseBackgroundTasksAtom,
  widgetDraftProposalMapAtom,
} from '@/atoms/agent-ui-atoms'
import {
  agentContextCalibrationSnapshotsAtom,
  agentContextInputsAtom,
  agentContextSnapshotsAtom,
  releaseAgentContextStatusAtom,
} from '@/atoms/agent-context-atoms'
import {
  allPendingAskUserRequestsAtom,
  allPendingPermissionRequestsAtom,
} from '@/atoms/agent-permission-atoms'
import {
  sessionContextLengthPreferencesAtom,
  sessionModelPreferencesAtom,
  sessionParallelModePreferencesAtom,
  sessionThinkingLevelPreferencesAtom,
} from '@/atoms/session-preference-atoms'
import {
  currentSessionIdAtom,
  sessionFileWorkbenchStateMapAtom,
  sessionWebPreviewStateMapAtom,
  sessionsAtom,
} from '@/atoms/session-atoms'
import { sessionPinnedWidgetsMapAtom } from '@/atoms/session-board-atoms'
import { sessionUsageSnapshotsAtom } from '@/atoms/usage-atoms'
import {
  addInAppNotificationAtom,
  notificationsEnabledAtom,
  sendDesktopNotification,
} from '@/atoms/notifications'
import {
  closeTab,
  splitLayoutAtom,
  tabsAtom,
  updateTabTitle,
} from '@/atoms/tab-atoms'

function deleteMapKey<T>(map: Map<string, T>, sessionId: string): Map<string, T> {
  if (!map.has(sessionId)) return map
  const next = new Map(map)
  next.delete(sessionId)
  return next
}

function deleteSetValue(set: Set<string>, sessionId: string): Set<string> {
  if (!set.has(sessionId)) return set
  const next = new Set(set)
  next.delete(sessionId)
  return next
}

export function useSessionMetaListener(): void {
  const store = useStore()

  useEffect(() => {
    const refreshAllLists = async (): Promise<void> => {
      try {
        const sessions = await window.electronAPI.listSessions()
        store.set(sessionsAtom, sessions)
      } catch (error) {
        console.error('[SessionListeners] 刷新列表失败:', error)
      }
    }

    const bumpAgentRefresh = (sessionId: string): void => {
      store.set(agentMessageHydratingAtom, (prev: Set<string>) => {
        const next = new Set(prev)
        next.add(sessionId)
        return next
      })
      store.set(agentMessageRefreshAtom, (prev) => {
        const map = new Map(prev)
        map.set(sessionId, (prev.get(sessionId) ?? 0) + 1)
        return map
      })
    }

    const cleanupComplete = window.electronAPI.onSessionStreamComplete((data: SessionStreamCompletePayload) => {
      const outcome = data.outcome ?? 'success'
      if (outcome === 'success') {
        const enabled = store.get(notificationsEnabledAtom)
        const session = store.get(sessionsAtom).find((item) => item.id === data.sessionId)
        store.set(addInAppNotificationAtom, {
          title: 'Kila 任务完成',
          body: session?.title ? `「${session.title}」已完成` : '当前任务已完成',
          level: 'success',
          category: 'agent',
          sessionId: data.sessionId,
        })
        sendDesktopNotification(
          'Kila 任务完成',
          session?.title ? `「${session.title}」已完成` : '当前任务已完成',
          enabled,
          { sessionId: data.sessionId },
        )
      }

      const streamState = store.get(agentStreamingStatesAtom).get(data.sessionId)
      if (streamState && streamState.toolActivities.length > 0) {
        const teamEntries = buildTeamActivityEntries(streamState.toolActivities)
        if (teamEntries.length > 0) {
          store.set(cachedTeamActivitiesAtom, (prev) => {
            const map = new Map(prev)
            map.set(data.sessionId, teamEntries)
            return map
          })
        }

        const overview = extractTeamOverview(streamState.toolActivities)
        if (overview) {
          store.set(cachedTeamOverviewsAtom, (prev) => {
            const map = new Map(prev)
            map.set(data.sessionId, overview)
            return map
          })
        }
      }

      store.set(agentStreamingStatesAtom, (prev) => {
        const current = prev.get(data.sessionId)
        if (!current) return prev
        const map = new Map(prev)
        map.set(data.sessionId, { ...current, running: false })
        return map
      })
      bumpAgentRefresh(data.sessionId)
    })

    const cleanupError = window.electronAPI.onSessionStreamError((data: SessionStreamErrorPayload) => {
      const session = store.get(sessionsAtom).find((item) => item.id === data.sessionId)
      store.set(addInAppNotificationAtom, {
        title: 'Kila 任务失败',
        body: session?.title ? `「${session.title}」执行失败：${data.error}` : data.error,
        level: 'error',
        category: 'agent',
        sessionId: data.sessionId,
      })

      store.set(agentStreamingStatesAtom, (prev) => {
        const current = prev.get(data.sessionId)
        if (!current) return prev
        const map = new Map(prev)
        map.set(data.sessionId, { ...current, running: false })
        return map
      })
      store.set(agentStreamErrorsAtom, (prev) => {
        const map = new Map(prev)
        map.set(data.sessionId, data.error)
        return map
      })
      bumpAgentRefresh(data.sessionId)
    })

    const cleanupTitleUpdated = window.electronAPI.onSessionTitleUpdated((data: SessionTitleUpdatedPayload) => {
      store.set(sessionsAtom, (prev) =>
        prev.map((session) => (
          session.id === data.sessionId
            ? { ...session, title: data.title, updatedAt: Date.now() }
            : session
        )),
      )
      store.set(tabsAtom, (tabs) => updateTabTitle(tabs, data.sessionId, data.title))
    })

    const cleanupSessionUpdated = window.electronAPI.onSessionUpdated((data: SessionUpdatedPayload) => {
      // 删除 Session 时同步关闭悬空 Tab，并释放所有 renderer-only 资源。
      if (data.reason === 'deleted') {
        const sessionId = data.sessionId
        const pendingFiles = store.get(agentPendingFilesMapAtom).get(sessionId) ?? []
        disposePendingFiles(
          pendingFiles,
          window.__pendingAgentFileData,
          (url) => URL.revokeObjectURL(url),
        )

        store.set(sessionsAtom, (prev) => prev.filter((session) => session.id !== sessionId))

        const tabResult = closeTab(store.get(tabsAtom), store.get(splitLayoutAtom), sessionId)
        store.set(tabsAtom, tabResult.tabs)
        store.set(splitLayoutAtom, tabResult.layout)
        if (store.get(currentSessionIdAtom) === sessionId) {
          const focusedPanel = tabResult.layout.panels[tabResult.layout.focusedPanelIndex]
          store.set(currentSessionIdAtom, focusedPanel?.activeTabId ?? null)
        }

        store.set(agentStreamingStatesAtom, (prev) => deleteMapKey(prev, sessionId))
        store.set(agentStreamErrorsAtom, (prev) => deleteMapKey(prev, sessionId))
        store.set(agentQueuedSendMapAtom, (prev) => deleteMapKey(prev, sessionId))
        store.set(agentMessageRefreshAtom, (prev) => deleteMapKey(prev, sessionId))
        store.set(agentMessageHydratingAtom, (prev) => deleteSetValue(prev, sessionId))
        store.set(agentPendingFilesMapAtom, (prev) => deleteMapKey(prev, sessionId))
        store.set(agentSessionDraftsAtom, (prev) => deleteMapKey(prev, sessionId))
        store.set(widgetDraftProposalMapAtom, (prev) => deleteMapKey(prev, sessionId))
        store.set(agentAttachedDirectoriesMapAtom, (prev) => deleteMapKey(prev, sessionId))
        store.set(agentSidePanelActiveToolMapAtom, (prev) => deleteMapKey(prev, sessionId))
        store.set(agentSidePanelCloseRequestMapAtom, (prev) => deleteMapKey(prev, sessionId))
        store.set(agentPromptSuggestionsAtom, (prev) => deleteMapKey(prev, sessionId))
        store.set(agentPendingPromptAtom, (prev) => prev?.sessionId === sessionId ? null : prev)

        store.set(allPendingPermissionRequestsAtom, (prev) => deleteMapKey(prev, sessionId))
        store.set(allPendingAskUserRequestsAtom, (prev) => deleteMapKey(prev, sessionId))

        store.set(agentContextInputsAtom, (prev) => deleteMapKey(prev, sessionId))
        store.set(agentContextCalibrationSnapshotsAtom, (prev) => deleteMapKey(prev, sessionId))
        store.set(agentContextSnapshotsAtom, (prev) => deleteMapKey(prev, sessionId))

        store.set(sessionModelPreferencesAtom, (prev) => deleteMapKey(prev, sessionId))
        store.set(sessionContextLengthPreferencesAtom, (prev) => deleteMapKey(prev, sessionId))
        store.set(sessionThinkingLevelPreferencesAtom, (prev) => deleteMapKey(prev, sessionId))
        store.set(sessionParallelModePreferencesAtom, (prev) => deleteMapKey(prev, sessionId))

        store.set(sessionFileWorkbenchStateMapAtom, (prev) => deleteMapKey(prev, sessionId))
        store.set(sessionWebPreviewStateMapAtom, (prev) => deleteMapKey(prev, sessionId))
        store.set(sessionPinnedWidgetsMapAtom, (prev) => deleteMapKey(prev, sessionId))
        store.set(sessionUsageSnapshotsAtom, (prev) => deleteMapKey(prev, sessionId))

        store.set(dismissedTeamSessionIdsAtom, (prev) => deleteSetValue(prev, sessionId))
        store.set(cachedTeamActivitiesAtom, (prev) => deleteMapKey(prev, sessionId))
        store.set(cachedTeamOverviewsAtom, (prev) => deleteMapKey(prev, sessionId))

        store.set(backgroundTasksAtomFamily(sessionId), [])
        releaseBackgroundTasksAtom(sessionId)
        releaseAgentContextStatusAtom(sessionId)
      }
      void refreshAllLists()
    })

    return () => {
      cleanupComplete()
      cleanupError()
      cleanupTitleUpdated()
      cleanupSessionUpdated()
    }
  }, [store])
}
