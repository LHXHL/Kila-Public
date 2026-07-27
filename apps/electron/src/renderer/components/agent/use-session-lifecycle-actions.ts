/**
 * useSessionLifecycleActions
 *
 * 从 AgentView 拆出的会话生命周期动作：回退（rewind）、分叉（branch）、在新会话中重试。
 * Hook 内部直接消费 Jotai 原子（tabs/layout/sessions/current/streaming），
 * 因此这些 setter 的类型由 Jotai 推断，无需在 deps 里手写；仅接收 AgentView 的本地状态与选择。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { sessionMessageToLegacyAgentMessage, type AgentMessage, type ThinkingLevel } from '@kila/shared'
import { tabsAtom, splitLayoutAtom, openTab } from '@/atoms/tab-atoms'
import { sessionsAtom, currentSessionIdAtom } from '@/atoms/session-atoms'
import { agentStreamingStatesAtom } from '@/atoms/agent-atoms'

interface UseSessionLifecycleActionsDeps {
  sessionId: string
  currentSelection: { channelId: string | null; modelId: string | null }
  thinkingLevel: ThinkingLevel
  historyTurns: number | 'infinite'
  projectPath: string | null
  enabledToolIds: string[] | undefined
  rewindTargetMessageId: string | null
  setRewindTargetMessageId: React.Dispatch<React.SetStateAction<string | null>>
  setMessages: React.Dispatch<React.SetStateAction<AgentMessage[]>>
}

interface SessionLifecycleActions {
  handleConfirmRewind: () => Promise<void>
  handleBranchFromMessage: (messageId: string) => void
  handleRetryInNewSession: () => Promise<void>
}

export function useSessionLifecycleActions(deps: UseSessionLifecycleActionsDeps): SessionLifecycleActions {
  const { t } = useTranslation()
  const {
    sessionId,
    currentSelection,
    thinkingLevel,
    historyTurns,
    projectPath,
    enabledToolIds,
    rewindTargetMessageId,
    setRewindTargetMessageId,
    setMessages,
  } = deps

  const tabs = useAtomValue(tabsAtom)
  const layout = useAtomValue(splitLayoutAtom)
  const setTabs = useSetAtom(tabsAtom)
  const setLayout = useSetAtom(splitLayoutAtom)
  const setSessions = useSetAtom(sessionsAtom)
  const setCurrentSessionId = useSetAtom(currentSessionIdAtom)
  const setStreamingStates = useSetAtom(agentStreamingStatesAtom)

  const handleConfirmRewind = React.useCallback(async (): Promise<void> => {
    if (!rewindTargetMessageId) return
    try {
      const retained = await window.electronAPI.rewindSession({
        sessionId,
        messageId: rewindTargetMessageId,
      })
      setMessages(retained
        .map(sessionMessageToLegacyAgentMessage)
        .filter((message): message is AgentMessage => message !== null))
      toast.success(t('agent.session.rewound'), {
        description: t('agent.session.rewoundDescription'),
      })
    } catch (error) {
      console.error('[AgentView] 回退会话失败:', error)
      toast.error(error instanceof Error ? error.message : t('agent.session.rewindFailed'))
    } finally {
      setRewindTargetMessageId(null)
    }
  }, [rewindTargetMessageId, sessionId, setMessages, setRewindTargetMessageId, t])

  const handleBranchFromMessage = React.useCallback((messageId: string): void => {
    window.electronAPI.branchSessionFromMessage({
      sessionId,
      messageId,
    }).then(async (meta) => {
      const nextSessions = await window.electronAPI.listSessions()
      setSessions(nextSessions)
      const result = openTab(tabs, layout, { type: 'agent', sessionId: meta.id, title: meta.title })
      setTabs(result.tabs)
      setLayout(result.layout)
      setCurrentSessionId(meta.id)
      toast.success(t('agent.session.branched'), {
        description: t('agent.session.branchedDescription', { title: meta.title }),
      })
    }).catch((error) => {
      console.error('[AgentView] 创建分叉会话失败:', error)
      toast.error(error instanceof Error ? error.message : t('agent.session.branchFailed'))
    })
  }, [layout, sessionId, setCurrentSessionId, setLayout, setSessions, setTabs, t, tabs])

  const handleRetryInNewSession = React.useCallback(async (): Promise<void> => {
    if (!currentSelection.channelId) return

    try {
      const meta = await window.electronAPI.createSession({
        channelId: currentSelection.channelId ?? undefined,
        modelId: currentSelection.modelId || undefined,
        thinkingLevel: thinkingLevel,
        historyTurns: historyTurns,
        projectPath: projectPath ?? undefined,
      })
      const sessions = await window.electronAPI.listSessions()
      setSessions(sessions)

      // 切换到新会话 tab
      const result = openTab(tabs, layout, { type: 'agent', sessionId: meta.id, title: meta.title })
      setTabs(result.tabs)
      setLayout(result.layout)
      setCurrentSessionId(meta.id)

      // 发送引用旧会话的默认提示词
      const prompt = t('agent.session.retryNewSessionPrompt', { sessionId })

      // 初始化新会话流式状态
      setStreamingStates((prev) => {
        const map = new Map(prev)
        map.set(meta.id, {
          running: true,
          content: '',
          toolActivities: [],
          processEvents: [],
          model: currentSelection.modelId || undefined,
          startedAt: Date.now(),
        })
        return map
      })

      window.electronAPI.sendSessionMessage({
        sessionId: meta.id,
        userMessage: prompt,
        channelId: currentSelection.channelId ?? undefined,
        modelId: currentSelection.modelId || undefined,
        thinkingLevel: thinkingLevel,
        historyTurns: historyTurns,
        enabledToolIds,
        skipAutoTitle: true,
      }).catch(console.error)
    } catch (error) {
      console.error('[AgentView] 在新会话中重试失败:', error)
    }
  }, [sessionId, currentSelection.channelId, currentSelection.modelId, enabledToolIds, historyTurns, thinkingLevel, projectPath, tabs, layout, setCurrentSessionId, setSessions, setTabs, setLayout, setStreamingStates, t])

  return { handleConfirmRewind, handleBranchFromMessage, handleRetryInNewSession }
}
