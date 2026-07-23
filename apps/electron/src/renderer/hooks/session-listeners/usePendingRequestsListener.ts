import { useEffect } from 'react'
import { useStore } from 'jotai'
import type { AgentEvent, SessionStreamEvent } from '@kila/shared'
import {
  enqueuePendingAskUserRequestMap,
  enqueuePendingPermissionRequestMap,
  resolvePendingAskUserRequestMap,
  resolvePendingPermissionRequestMap,
  allPendingAskUserRequestsAtom,
  allPendingPermissionRequestsAtom,
} from '@/atoms/agent-permission-atoms'
import {
  notificationsEnabledAtom,
  sendDesktopNotification,
} from '@/atoms/notifications'

export function usePendingRequestsListener(): void {
  const store = useStore()

  useEffect(() => {
    const handleAgentEvent = (streamEvent: AgentEvent): void => {
      if (streamEvent.type === 'permission_request') {
        store.set(allPendingPermissionRequestsAtom, (prev) =>
          enqueuePendingPermissionRequestMap(prev, streamEvent.request),
        )

        const enabled = store.get(notificationsEnabledAtom)
        sendDesktopNotification(
          '需要权限确认',
          streamEvent.request.toolName
            ? `Agent 请求使用工具: ${streamEvent.request.toolName}`
            : 'Agent 需要你的权限确认',
          enabled,
          { sessionId: streamEvent.request.sessionId },
        )
        return
      }

      if (streamEvent.type === 'permission_resolved') {
        store.set(allPendingPermissionRequestsAtom, (prev) =>
          resolvePendingPermissionRequestMap(prev, streamEvent.requestId),
        )
        return
      }

      if (streamEvent.type === 'ask_user_request') {
        store.set(allPendingAskUserRequestsAtom, (prev) =>
          enqueuePendingAskUserRequestMap(prev, streamEvent.request),
        )

        const enabled = store.get(notificationsEnabledAtom)
        sendDesktopNotification(
          'Agent 需要你的输入',
          streamEvent.request.questions[0]?.question ?? 'Agent 有问题需要你回答',
          enabled,
          { sessionId: streamEvent.request.sessionId },
        )
        return
      }

      if (streamEvent.type === 'ask_user_resolved') {
        store.set(allPendingAskUserRequestsAtom, (prev) =>
          resolvePendingAskUserRequestMap(prev, streamEvent.requestId),
        )
      }
    }

    return window.electronAPI.onSessionStreamEvent((event: SessionStreamEvent) => {
      if (event.type !== 'agent_event') return
      handleAgentEvent(event.event)
    })
  }, [store])
}
