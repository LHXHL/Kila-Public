import { useEffect } from 'react'
import { useStore } from 'jotai'
import type { AgentEvent, SessionStreamEvent } from '@kila/shared'
import {
  agentStreamingStatesAtom,
  applyAgentEvent,
  type AgentStreamState,
} from '@/atoms/agent-stream-atoms'
import { syncUsageSnapshotAtom } from '@/atoms/usage-atoms'
import {
  agentPromptSuggestionsAtom,
  backgroundTasksAtomFamily,
} from '@/atoms/agent-ui-atoms'
import {
  agentContextCalibrationSnapshotsAtom,
  agentContextSnapshotsAtom,
} from '@/atoms/agent-context-atoms'

const DEFAULT_AGENT_STREAM_STATE = (): AgentStreamState => ({
  running: true,
  content: '',
  toolActivities: [],
  processEvents: [],
  model: undefined,
  startedAt: Date.now(),
})

export function useAgentStreamListener(): void {
  const store = useStore()

  useEffect(() => {
    const updateAgentState = (
      sessionId: string,
      updater: (prev: AgentStreamState) => AgentStreamState,
    ): void => {
      store.set(agentStreamingStatesAtom, (prev) => {
        const current = prev.get(sessionId) ?? DEFAULT_AGENT_STREAM_STATE()
        const next = updater(current)
        const map = new Map(prev)
        map.set(sessionId, next)
        return map
      })
    }

    const handleAgentEvent = (sessionId: string, streamEvent: AgentEvent): void => {
      if (streamEvent.type === 'context_snapshot') {
        store.set(agentContextSnapshotsAtom, (prev) => {
          const current = prev.get(sessionId)
          if (
            current?.fingerprint === streamEvent.snapshot.fingerprint &&
            current?.estimatedInputTokens === streamEvent.snapshot.estimatedInputTokens &&
            current?.contextWindow === streamEvent.snapshot.contextWindow
          ) {
            return prev
          }

          const map = new Map(prev)
          map.set(sessionId, streamEvent.snapshot)
          return map
        })
      }

      if (streamEvent.type === 'budget_warning') {
        // 预算超限告警由 TokenUsageSettings 页面在打开时检测并提示，
        // 这里不再产生站内通知。
        return
      }

      updateAgentState(sessionId, (state) => applyAgentEvent(state, streamEvent))
      void store.set(syncUsageSnapshotAtom)

      if (streamEvent.type === 'complete' && streamEvent.usage?.inputTokens) {
        const snapshot = store.get(agentContextSnapshotsAtom).get(sessionId)
        if (snapshot) {
          store.set(agentContextCalibrationSnapshotsAtom, (prev) => {
            const nextSnapshot = {
              modelId: snapshot.modelId,
              fingerprint: snapshot.fingerprint,
              estimatedTokens: snapshot.estimatedInputTokens,
              actualTokens: streamEvent.usage!.contextInputTokens ?? streamEvent.usage!.inputTokens,
              contextWindow: streamEvent.usage!.contextWindow ?? snapshot.contextWindow,
            }
            const current = prev.get(sessionId)
            if (
              current &&
              current.modelId === nextSnapshot.modelId &&
              current.fingerprint === nextSnapshot.fingerprint &&
              current.estimatedTokens === nextSnapshot.estimatedTokens &&
              current.actualTokens === nextSnapshot.actualTokens &&
              current.contextWindow === nextSnapshot.contextWindow
            ) {
              return prev
            }

            const map = new Map(prev)
            map.set(sessionId, nextSnapshot)
            return map
          })
        }
      }

      if (streamEvent.type === 'task_backgrounded') {
        store.set(backgroundTasksAtomFamily(sessionId), (prev) => {
          if (prev.some((task) => task.toolUseId === streamEvent.toolUseId)) return prev
          return [...prev, {
            id: streamEvent.taskId,
            type: 'agent' as const,
            toolUseId: streamEvent.toolUseId,
            startTime: Date.now(),
            elapsedSeconds: 0,
            intent: streamEvent.intent,
          }]
        })
        return
      }

      if (streamEvent.type === 'shell_backgrounded') {
        store.set(backgroundTasksAtomFamily(sessionId), (prev) => {
          if (prev.some((task) => task.toolUseId === streamEvent.toolUseId)) return prev
          return [...prev, {
            id: streamEvent.shellId,
            type: 'shell' as const,
            toolUseId: streamEvent.toolUseId,
            startTime: Date.now(),
            elapsedSeconds: 0,
            intent: streamEvent.command || streamEvent.intent,
          }]
        })
        return
      }

      if (streamEvent.type === 'tool_result') {
        store.set(backgroundTasksAtomFamily(sessionId), (prev) =>
          prev.filter((task) => task.toolUseId !== streamEvent.toolUseId),
        )
        return
      }

      if (streamEvent.type === 'shell_killed') {
        store.set(backgroundTasksAtomFamily(sessionId), (prev) => {
          const task = prev.find((item) => item.id === streamEvent.shellId)
          if (!task) return prev
          return prev.filter((item) => item.toolUseId !== task.toolUseId)
        })
        return
      }

      if (streamEvent.type === 'prompt_suggestion') {
        store.set(agentPromptSuggestionsAtom, (prev) => {
          const map = new Map(prev)
          map.set(sessionId, streamEvent.suggestion)
          return map
        })
      }
    }

    return window.electronAPI.onSessionStreamEvent((event: SessionStreamEvent) => {
      if (event.type !== 'agent_event') return
      handleAgentEvent(event.sessionId, event.event)
    })
  }, [store])
}
