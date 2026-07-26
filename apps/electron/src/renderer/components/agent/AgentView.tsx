/**
 * AgentView — Agent 模式主视图容器
 *
 * 职责：
 * - 加载当前 Agent 会话消息
 * - 发送/停止/压缩 Agent 消息
 * - 附件上传处理
 * - 复用统一 Session 壳层，并承接 Agent runtime 专属交互
 *
 * 注意：IPC 流式事件监听已提升到全局 useGlobalSessionListeners，
 * 本组件为纯展示 + 交互组件。
 *
 * 布局：SessionHeader | AgentMessages | AgentInput + SessionSidePanel
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { toast } from 'sonner'
import { Clock3, CornerDownLeft, Square, Settings, Paperclip, FolderPlus, X, Sparkles, Eye, EyeOff } from 'lucide-react'
import { AgentMessages } from './AgentMessages'
import {
  mergeRecoveredComposerDraft,
  preparePendingFilePayloads,
} from './agent-send-transaction'

import { PermissionBanner } from './PermissionBanner'
import { AskUserBanner } from './AskUserBanner'
import { WidgetDraftBanner } from './WidgetDraftBanner'
import { ContextUsageIndicator } from '@/components/composer/ContextUsageIndicator'
import { ModelSelector } from '@/components/composer/ModelSelector'
import { AttachmentPreviewItem } from '@/components/composer/AttachmentPreviewItem'
import { SkillTriggerButton } from '@/components/composer/SkillTriggerButton'
import { ThinkingLevelSelector } from '@/components/composer/ThinkingLevelSelector'
import { SystemPromptSelector } from '@/components/composer/SystemPromptSelector'
import { ToolSelectorPopover } from '@/components/composer/ToolSelectorPopover'

const SessionSidePanel = React.lazy(() => import('@/components/session/SessionSidePanel').then((module) => ({ default: module.SessionSidePanel })))
import { RichTextInput, type RichTextInputHandle } from '@/components/ai-elements/rich-text-input'
import { useSessionLifecycleActions } from './use-session-lifecycle-actions'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { activeToolIdsAtom } from '@/atoms/agent-tool-atoms'
import {
  sessionModelPreferencesAtom,
  selectedModelAtom,
} from '@/atoms/session-preference-atoms'
import { incognitoModeAtom } from '@/atoms/agent-ui-atoms'
import {
  agentStreamingStatesAtom,
  agentContextInputsAtom,
  agentContextStatusAtomFamily,
  agentContextCalibrationSnapshotsAtom,
  agentChannelIdAtom,
  agentModelIdAtom,
  agentPendingPromptAtom,
  agentPendingFilesMapAtom,
  getSessionPendingFiles,
  setSessionPendingFilesMap,
  agentStreamErrorsAtom,
  agentSessionDraftsAtom,
  agentPromptSuggestionsAtom,
  agentMessageHydratingAtom,
  agentMessageRefreshAtom,
  agentQueuedSendMapAtom,
  enqueueQueuedSendMap,
  prependQueuedSendMap,
  removeQueuedSendMapItem,
  shiftQueuedSendMap,
  type AgentQueuedSend,
  cachedTeamOverviewsAtom,
  cachedTeamActivitiesAtom,
  dismissedTeamSessionIdsAtom,
  buildTeamActivityEntries,
  rebuildTeamDataFromMessages,
  agentAttachedDirectoriesMapAtom,
  clearWidgetDraftProposalAtom,
  widgetDraftProposalMapAtom,
} from '@/atoms/agent-atoms'
import { tabsAtom, splitLayoutAtom, openTab } from '@/atoms/tab-atoms'
import { sessionsAtom, currentSessionIdAtom } from '@/atoms/session-atoms'
import { SessionHeader } from '@/components/session/SessionHeader'
import {
  useSessionContextLengthPreference,
  useSessionThinkingLevelPreference,
} from '@/hooks/useSessionPreferences'
import {
  buildSessionTurnReplayPlan,
  createOptimisticReplayUserMessage,
  sessionMessageToLegacyAgentMessage,
  type AgentMessage,
  type AgentPendingFile,
  type Channel,
  type FileAttachment,
  type ModelOption,
  type SessionSendInput,
} from '@kila/shared'
import { useAgentAttachments } from './use-agent-attachments'

const SESSION_MESSAGE_PAGE_SIZE = 100

interface PendingComposerSnapshot {
  files: AgentPendingFile[]
  data: Map<string, string>
}

interface EditingTurnState {
  messageId: string
  originalDraft: string
  originalPending: PendingComposerSnapshot
}

/** 隐身模式切换按钮 — 紧贴发送按钮左侧 */
function IncognitoToggle(): React.ReactElement {
  const [incognitoMode, setIncognitoMode] = useAtom(incognitoModeAtom)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            'size-[30px] rounded-lg transition-colors',
            incognitoMode
              ? 'text-primary bg-primary/10 hover:bg-primary/15'
              : 'text-foreground/30 hover:text-foreground/60'
          )}
          onClick={() => setIncognitoMode((prev) => !prev)}
        >
          {incognitoMode ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>{incognitoMode ? '隐身模式已开启 — 本条消息不加入记忆' : '点击开启隐身模式'}</p>
      </TooltipContent>
    </Tooltip>
  )
}

export function AgentView({ sessionId }: { sessionId: string }): React.ReactElement {
  const [messages, setMessages] = React.useState<AgentMessage[]>([])
  const [messagesLoading, setMessagesLoading] = React.useState(true)
  const [messagesLoadError, setMessagesLoadError] = React.useState<string | null>(null)
  const [messageLoadRetryVersion, setMessageLoadRetryVersion] = React.useState(0)
  const [messageWindowStart, setMessageWindowStart] = React.useState(0)
  const [totalMessageCount, setTotalMessageCount] = React.useState(0)
  const [loadingEarlierMessages, setLoadingEarlierMessages] = React.useState(false)
  const messageLoadGenerationRef = React.useRef(0)
  const [rewindTargetMessageId, setRewindTargetMessageId] = React.useState<string | null>(null)
  const [channels, setChannels] = React.useState<Channel[]>([])
  const setStreamingStates = useSetAtom(agentStreamingStatesAtom)
  const streamingStates = useAtomValue(agentStreamingStatesAtom)
  const streamState = streamingStates.get(sessionId)
  const streaming = streamState?.running ?? false
  const contextStatus = useAtomValue(agentContextStatusAtomFamily(sessionId))
  const [agentChannelId, setAgentChannelId] = useAtom(agentChannelIdAtom)
  const [agentModelId, setAgentModelId] = useAtom(agentModelIdAtom)
  const [pendingPrompt, setPendingPrompt] = useAtom(agentPendingPromptAtom)
  const [pendingFilesMap, setPendingFilesMap] = useAtom(agentPendingFilesMapAtom)
  const pendingFiles = getSessionPendingFiles(pendingFilesMap, sessionId)
  const setPendingFiles = React.useCallback((
    update: AgentPendingFile[] | ((previous: AgentPendingFile[]) => AgentPendingFile[]),
  ): void => {
    setPendingFilesMap((previousMap) => {
      const previousFiles = previousMap.get(sessionId) ?? []
      const nextFiles = typeof update === 'function' ? update(previousFiles) : update
      return setSessionPendingFilesMap(previousMap, sessionId, nextFiles)
    })
  }, [sessionId, setPendingFilesMap])
  const [queuedSendMap, setQueuedSendMap] = useAtom(agentQueuedSendMapAtom)
  const setAgentContextInputs = useSetAtom(agentContextInputsAtom)
  const setContextCalibrations = useSetAtom(agentContextCalibrationSnapshotsAtom)
  const setAgentStreamErrors = useSetAtom(agentStreamErrorsAtom)
  const store = useStore()
  const suggestionsMap = useAtomValue(agentPromptSuggestionsAtom)
  const suggestion = suggestionsMap.get(sessionId) ?? null
  const setPromptSuggestions = useSetAtom(agentPromptSuggestionsAtom)
  const setMessageHydrating = useSetAtom(agentMessageHydratingAtom)
  const sessions = useAtomValue(sessionsAtom)
  const setSessions = useSetAtom(sessionsAtom)
  const setCurrentSessionId = useSetAtom(currentSessionIdAtom)
  const setSessionModelPreferences = useSetAtom(sessionModelPreferencesAtom)
  const setGlobalModel = useSetAtom(selectedModelAtom)
  const [tabs, setTabs] = useAtom(tabsAtom)
  const [layout, setLayout] = useAtom(splitLayoutAtom)
  const setAttachedDirsMap = useSetAtom(agentAttachedDirectoriesMapAtom)
  const attachedDirsMap = useAtomValue(agentAttachedDirectoriesMapAtom)
  const attachedDirs = attachedDirsMap.get(sessionId) ?? []
  const activeToolIds = useAtomValue(activeToolIdsAtom)
  const sessionMeta = sessions.find((item) => item.id === sessionId) ?? null
  const projectPath = sessionMeta?.project.path ?? null
  const hasSessionModelSelection = Boolean(sessionMeta?.channelId || sessionMeta?.modelId)
  const currentSelection = React.useMemo(() => ({
    channelId: hasSessionModelSelection ? (sessionMeta?.channelId ?? null) : agentChannelId,
    modelId: hasSessionModelSelection ? (sessionMeta?.modelId ?? null) : agentModelId,
  }), [
    agentChannelId,
    agentModelId,
    hasSessionModelSelection,
    sessionMeta?.channelId,
    sessionMeta?.modelId,
  ])
  const [historyTurns] = useSessionContextLengthPreference()
  const [thinkingLevel] = useSessionThinkingLevelPreference()

  const draftsMap = useAtomValue(agentSessionDraftsAtom)
  const widgetDraftProposalMap = useAtomValue(widgetDraftProposalMapAtom)
  const setDraftsMap = useSetAtom(agentSessionDraftsAtom)
  const clearWidgetDraftProposal = useSetAtom(clearWidgetDraftProposalAtom)
  const inputContent = draftsMap.get(sessionId) ?? ''
  const widgetDraftProposal = widgetDraftProposalMap.get(sessionId) ?? null
  const setInputContent = React.useCallback((value: string) => {
    setDraftsMap((prev) => {
      const current = prev.get(sessionId)
      if (value.trim() === '') {
        if (!prev.has(sessionId)) return prev
        const map = new Map(prev)
        map.delete(sessionId)
        return map
      } else {
        if (current === value) return prev
        const map = new Map(prev)
        map.set(sessionId, value)
        return map
      }
    })
  }, [sessionId, setDraftsMap])
  const currentChannel = React.useMemo(() => (
    channels.find((channel) => channel.id === currentSelection.channelId) ?? null
  ), [channels, currentSelection.channelId])
  const enabledToolIds = React.useMemo(() => (
    activeToolIds.length > 0 ? activeToolIds : undefined
  ), [activeToolIds])
  const messageCount = React.useMemo(() => (
    messages.filter((message) => message.role === 'user' || message.role === 'assistant').length
  ), [messages])
  const displayedMessageCount = messageWindowStart > 0 ? totalMessageCount : messageCount
  const [editingTurn, setEditingTurn] = React.useState<EditingTurnState | null>(null)
  const inputRef = React.useRef<RichTextInputHandle | null>(null)
  const handleAttachedDirectoriesChange = React.useCallback((directories: string[]): void => {
    setAttachedDirsMap((previous) => {
      const next = new Map(previous)
      next.set(sessionId, directories)
      return next
    })
  }, [sessionId, setAttachedDirsMap])
  const {
    pendingFilesRef,
    isDragOver,
    dragFolderNotice,
    dismissDragFolderNotice,
    handleOpenFileDialog,
    handleRemoveFile,
    handlePasteFiles,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useAgentAttachments({
    sessionId,
    pendingFiles,
    setPendingFiles,
    attachedDirectories: attachedDirs,
    onAttachedDirectoriesChange: handleAttachedDirectoriesChange,
  })

  const queuedSendFlushRef = React.useRef<string | null>(null)
  const queuedSends = queuedSendMap.get(sessionId) ?? []
  const [contextDraftText, setContextDraftText] = React.useState(inputContent)
  React.useEffect(() => {
    const timer = window.setTimeout(() => setContextDraftText(inputContent), 160)
    return () => window.clearTimeout(timer)
  }, [inputContent])

  const pendingContextFiles = React.useMemo(() => pendingFiles.map(({ id, filename, mediaType, size }) => ({
    id,
    filename,
    mediaType,
    size,
  })), [pendingFiles])

  const setPendingComposerFiles = React.useCallback((
    files: AgentPendingFile[],
    data: Iterable<[string, string]>,
  ): void => {
    window.__pendingAgentFileData = new Map(data)
    setPendingFiles(files)
  }, [setPendingFiles])

  const capturePendingComposerSnapshot = React.useCallback((): PendingComposerSnapshot => {
    const files = pendingFilesRef.current.map((file) => ({ ...file }))
    const data = new Map<string, string>()
    for (const file of pendingFilesRef.current) {
      const value = window.__pendingAgentFileData?.get(file.id)
      if (typeof value === 'string') {
        data.set(file.id, value)
      }
    }
    return { files, data }
  }, [])

  React.useEffect(() => {
    setAgentContextInputs((prev) => {
      const nextInput = {
        channel: currentChannel
          ? {
            provider: currentChannel.provider,
            baseUrl: currentChannel.baseUrl,
          }
          : null,
        modelId: currentSelection.modelId,
        historyTurns,
        messages,
        currentTurnText: contextDraftText,
        pendingFiles: pendingContextFiles,
      }

      const existing = prev.get(sessionId)
      if (
        existing
        && existing.channel?.provider === nextInput.channel?.provider
        && existing.channel?.baseUrl === nextInput.channel?.baseUrl
        && existing.modelId === nextInput.modelId
        && existing.historyTurns === nextInput.historyTurns
        && existing.messages === nextInput.messages
        && existing.currentTurnText === nextInput.currentTurnText
        && existing.pendingFiles === nextInput.pendingFiles
      ) {
        return prev
      }

      const map = new Map(prev)
      map.set(sessionId, nextInput)
      return map
    })
  }, [
    currentChannel,
    currentSelection.modelId,
    historyTurns,
    contextDraftText,
    messages,
    pendingContextFiles,
    sessionId,
    setAgentContextInputs,
  ])

  React.useEffect(() => {
    if (
      !contextStatus.canSeedCalibration ||
      !contextStatus.modelId ||
      !contextStatus.fingerprint ||
      !contextStatus.estimatedTokens ||
      !contextStatus.inputTokens
    ) {
      return
    }

    setContextCalibrations((prev) => {
      const nextSnapshot = {
        modelId: contextStatus.modelId!,
        fingerprint: contextStatus.fingerprint!,
        estimatedTokens: contextStatus.estimatedTokens!,
        actualTokens: contextStatus.inputTokens!,
        contextWindow: contextStatus.contextWindow,
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
  }, [
    contextStatus.canSeedCalibration,
    contextStatus.contextWindow,
    contextStatus.estimatedTokens,
    contextStatus.fingerprint,
    contextStatus.inputTokens,
    contextStatus.modelId,
    sessionId,
    setContextCalibrations,
  ])

  // 为当前会话补全一个可用的模型选择：
  // session 显式选择 > 全局上次选择 > 第一个可用模型
  React.useEffect(() => {
    window.electronAPI.listChannels().then((availableChannels) => {
      setChannels(availableChannels)
      const enabledChannels = availableChannels.filter((channel) => channel.enabled)
      if (enabledChannels.length === 0) return

      const preferredChannel = currentSelection.channelId
        ? enabledChannels.find((channel) => channel.id === currentSelection.channelId)
        : null
      const channel = preferredChannel
        ?? enabledChannels.find((candidate) => candidate.models.some((model) => model.enabled))
        ?? enabledChannels[0]
      if (!channel) return

      const resolvedModel = currentSelection.modelId
        ? channel.models.find((model) => model.id === currentSelection.modelId && model.enabled)
        : null
      const model = resolvedModel ?? channel.models.find((candidate) => candidate.enabled)
      if (!model) return

      const nextSelection = { channelId: channel.id, modelId: model.id }
      const shouldSyncSession =
        sessionMeta?.channelId !== nextSelection.channelId ||
        sessionMeta?.modelId !== nextSelection.modelId
      const shouldSyncGlobal =
        !hasSessionModelSelection && (
          agentChannelId !== nextSelection.channelId ||
          agentModelId !== nextSelection.modelId
        )

      if (!shouldSyncSession && !shouldSyncGlobal) return

      setAgentChannelId(nextSelection.channelId)
      setAgentModelId(nextSelection.modelId)

      if (shouldSyncSession) {
        window.electronAPI.updateSessionMeta(sessionId, nextSelection)
          .then((updated) => {
            setSessions((prev) => prev.map((item) => (
              item.id === updated.id ? updated : item
            )))
          })
          .catch(console.error)
      }

      if (shouldSyncGlobal) {
        window.electronAPI.updateSettings({
          agentChannelId: nextSelection.channelId,
          agentModelId: nextSelection.modelId,
        }).catch(console.error)
      }
    }).catch(console.error)
  }, [
    agentChannelId,
    agentModelId,
    currentSelection.channelId,
    currentSelection.modelId,
    hasSessionModelSelection,
    sessionId,
    sessionMeta?.channelId,
    sessionMeta?.modelId,
    setAgentChannelId,
    setAgentModelId,
    setChannels,
    setSessions,
  ])

  // 监听消息刷新版本号
  const refreshMap = useAtomValue(agentMessageRefreshAtom)
  const refreshVersion = refreshMap.get(sessionId) ?? 0
  const [loadedRefreshVersion, setLoadedRefreshVersion] = React.useState(refreshVersion)

  // 加载当前会话消息
  React.useEffect(() => {
    let cancelled = false
    const requestGeneration = ++messageLoadGenerationRef.current
    setMessagesLoading(true)
    setMessagesLoadError(null)
    window.electronAPI
      .getRecentSessionMessages(sessionId, SESSION_MESSAGE_PAGE_SIZE)
      .then((result) => {
        if (cancelled || requestGeneration !== messageLoadGenerationRef.current) return
        const msgs = result.messages
          .map(sessionMessageToLegacyAgentMessage)
          .filter((message): message is AgentMessage => message !== null)

        setMessages(msgs)
        setMessagesLoading(false)
        setMessageWindowStart(Math.max(0, result.total - result.messages.length))
        setTotalMessageCount(result.total)
        setLoadingEarlierMessages(false)

        // 从持久化消息中重建 Team 数据并填充缓存（页面刷新后恢复）
        const teamData = rebuildTeamDataFromMessages(msgs)
        if (teamData) {
          if (teamData.overview) {
            store.set(cachedTeamOverviewsAtom, (prev) => {
              const map = new Map(prev)
              map.set(sessionId, teamData.overview!)
              return map
            })
          }
          const entries = buildTeamActivityEntries(teamData.toolActivities)
          if (entries.length > 0) {
            store.set(cachedTeamActivitiesAtom, (prev) => {
              const map = new Map(prev)
              map.set(sessionId, entries)
              return map
            })
          }
        }

        // 消息加载完成后，清除已完成的流式状态（running=false 的过渡气泡）
        // 在同一个微任务中执行，确保 React 在一次渲染中同时显示持久化消息并移除流式气泡
        setStreamingStates((prev) => {
          const state = prev.get(sessionId)
          if (!state || state.running) return prev  // 仍在运行中，不清除
          const map = new Map(prev)
          map.delete(sessionId)
          return map
        })
        setLoadedRefreshVersion(refreshVersion)
        setMessageHydrating((prev: Set<string>) => {
          if (!prev.has(sessionId)) return prev
          const next = new Set(prev)
          next.delete(sessionId)
          return next
        })
      })
      .catch((error) => {
        if (!cancelled && requestGeneration === messageLoadGenerationRef.current) {
          setLoadingEarlierMessages(false)
          setMessagesLoading(false)
          setMessagesLoadError(error instanceof Error ? error.message : '会话消息加载失败')
          console.error('[AgentView] 加载会话消息失败:', error)
        }
      })
    return () => { cancelled = true }
  }, [messageLoadRetryVersion, sessionId, refreshVersion, setMessageHydrating, setStreamingStates, store])

  const handleLoadEarlierMessages = React.useCallback(() => {
    if (loadingEarlierMessages || messageWindowStart <= 0) return
    const limit = Math.min(SESSION_MESSAGE_PAGE_SIZE, messageWindowStart)
    const offset = messageWindowStart - limit
    const requestGeneration = messageLoadGenerationRef.current
    setLoadingEarlierMessages(true)

    window.electronAPI.getSessionMessagesPage({ sessionId, offset, limit })
      .then((result) => {
        if (requestGeneration !== messageLoadGenerationRef.current) return
        const olderMessages = result.messages
          .map(sessionMessageToLegacyAgentMessage)
          .filter((message): message is AgentMessage => message !== null)
        setMessages((current) => {
          const currentIds = new Set(current.map((message) => message.id))
          return [...olderMessages.filter((message) => !currentIds.has(message.id)), ...current]
        })
        setMessageWindowStart(result.offset)
        setTotalMessageCount(result.total)
      })
      .catch((error) => {
        if (requestGeneration !== messageLoadGenerationRef.current) return
        console.error('[AgentView] 加载更早消息失败:', error)
        toast.error('加载更早消息失败')
      })
      .finally(() => {
        if (requestGeneration === messageLoadGenerationRef.current) {
          setLoadingEarlierMessages(false)
        }
      })
  }, [loadingEarlierMessages, messageWindowStart, sessionId])

  // 从会话元数据初始化附加目录
  React.useEffect(() => {
    const meta = sessions.find((s) => s.id === sessionId)
    const dirs = meta?.attachedDirectories ?? []
    setAttachedDirsMap((prev) => {
      const existing = prev.get(sessionId)
      // 避免不必要的更新
      if (JSON.stringify(existing) === JSON.stringify(dirs)) return prev
      const map = new Map(prev)
      if (dirs.length > 0) {
        map.set(sessionId, dirs)
      } else {
        map.delete(sessionId)
      }
      return map
    })
  }, [sessionId, sessions, setAttachedDirsMap])

  // 自动发送 pending prompt（从设置页"session完成配置"触发）
  React.useEffect(() => {
    if (!pendingPrompt) return
    if (pendingPrompt.sessionId !== sessionId) return
    if (!currentSelection.channelId || streaming) return

    // 立即清除，防止重复执行
    const prompt = pendingPrompt
    setPendingPrompt(null)

    // 短延时确保 IPC 订阅已就绪
    const timer = setTimeout(() => {
      // 初始化流式状态
      setStreamingStates((prev) => {
        const map = new Map(prev)
        map.set(sessionId, {
          running: true,
          content: '',
          toolActivities: [],
          processEvents: [],
          model: currentSelection.modelId || undefined,
          startedAt: Date.now(),
        })
        return map
      })

      // 乐观更新：显示用户消息
      const tempUserMsg: AgentMessage = {
        id: `temp-${Date.now()}`,
        role: 'user',
        content: prompt.message,
        createdAt: Date.now(),
      }
      setMessages((prev) => [...prev, tempUserMsg])

      // 发送消息
      const input: SessionSendInput = {
        sessionId,
        userMessage: prompt.message,
        channelId: currentSelection.channelId ?? undefined,
        modelId: currentSelection.modelId || undefined,
        sessionUpdatedAt: sessionMeta?.updatedAt,
        thinkingLevel: thinkingLevel,
        historyTurns: historyTurns,
        enabledToolIds,
        skipAutoTitle: true,
      }
      window.electronAPI.sendSessionMessage(input).catch((error) => {
        console.error('[AgentView] 自动发送配置消息失败:', error)
        toast.error('自动发送配置消息失败', {
          description: error instanceof Error ? error.message : '消息已恢复到输入框，请重试',
        })
        setMessages((prev) => prev.filter((message) => message.id !== tempUserMsg.id))
        const currentDraft = store.get(agentSessionDraftsAtom).get(sessionId) ?? ''
        setInputContent(mergeRecoveredComposerDraft(prompt.message, currentDraft))
        setStreamingStates((prev) => {
          const map = new Map(prev)
          map.delete(sessionId)
          return map
        })
      })
    }, 150)

    return () => clearTimeout(timer)
  }, [pendingPrompt, sessionId, currentSelection.channelId, currentSelection.modelId, enabledToolIds, historyTurns, sessionMeta?.updatedAt, thinkingLevel, streaming, setInputContent, setMessages, setPendingPrompt, setStreamingStates, store])

  /** ModelSelector 选择回调 */
  const handleModelSelect = React.useCallback((option: ModelOption): void => {
    const nextModel = {
      channelId: option.channelId,
      modelId: option.modelId,
    }

    setAgentChannelId(option.channelId)
    setAgentModelId(option.modelId)
    setSessionModelPreferences((prev) => {
      const map = new Map(prev)
      map.set(sessionId, nextModel)
      return map
    })
    setGlobalModel(nextModel)

    window.electronAPI.updateSessionMeta(sessionId, {
      channelId: option.channelId,
      modelId: option.modelId,
    })
      .then((updated) => {
        setSessions((prev) => prev.map((item) => (
          item.id === updated.id ? updated : item
        )))
      })
      .catch(console.error)

    // 持久化到设置
    window.electronAPI.updateSettings({
      agentChannelId: option.channelId,
      agentModelId: option.modelId,
    }).catch(console.error)
  }, [
    sessionId,
    setAgentChannelId,
    setAgentModelId,
    setSessionModelPreferences,
    setSessions,
    setGlobalModel,
  ])

  /** 构建 externalSelectedModel 给 ModelSelector */
  const externalSelectedModel = React.useMemo(() => {
    if (!currentSelection.channelId || !currentSelection.modelId) return null
    return { channelId: currentSelection.channelId, modelId: currentSelection.modelId }
  }, [currentSelection.channelId, currentSelection.modelId])

  const handleStartEditTurn = React.useCallback(async (message: AgentMessage): Promise<void> => {
    const snapshot = capturePendingComposerSnapshot()
    const nextFiles: AgentPendingFile[] = []
    const nextData = new Map<string, string>()

    try {
      for (const [index, attachment] of (message.attachments ?? []).entries()) {
        const base64 = await window.electronAPI.readAttachment(attachment.localPath)
        const pendingId = `edit-${message.id}-${index}-${Date.now()}`
        nextFiles.push({
          id: pendingId,
          filename: attachment.filename,
          mediaType: attachment.mediaType,
          size: attachment.size,
          previewUrl: attachment.mediaType.startsWith('image/')
            ? `data:${attachment.mediaType};base64,${base64}`
            : undefined,
        })
        nextData.set(pendingId, base64)
      }
    } catch (error) {
      console.error('[AgentView] 加载待编辑附件失败:', error)
      toast.error('读取原消息附件失败')
      return
    }

    setEditingTurn({
      messageId: message.id,
      originalDraft: inputContent,
      originalPending: snapshot,
    })
    setInputContent(message.content)
    setPendingComposerFiles(nextFiles, nextData)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }, [capturePendingComposerSnapshot, inputContent, setInputContent, setPendingComposerFiles])

  const handleCancelEditTurn = React.useCallback((): void => {
    if (!editingTurn) return
    setInputContent(editingTurn.originalDraft)
    setPendingComposerFiles(editingTurn.originalPending.files, editingTurn.originalPending.data)
    setEditingTurn(null)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }, [editingTurn, setInputContent, setPendingComposerFiles])

  const buildSessionSendInput = React.useCallback((
    finalMessage: string,
    attachments: FileAttachment[] = [],
  ): SessionSendInput => {
    const skills = [...finalMessage.matchAll(/\/skill:(\S+)/g)].map((m) => m[1]).filter(Boolean) as string[]
    const mcps = [...finalMessage.matchAll(/#mcp:(\S+)/g)].map((m) => m[1]).filter(Boolean) as string[]

    return {
      sessionId,
      userMessage: finalMessage,
      attachments: attachments.length > 0 ? attachments : undefined,
      channelId: currentSelection.channelId ?? undefined,
      modelId: currentSelection.modelId || undefined,
      sessionUpdatedAt: sessionMeta?.updatedAt,
      thinkingLevel,
      historyTurns,
      enabledToolIds,
      ...(attachedDirs.length > 0 && { additionalDirectories: attachedDirs }),
      ...(skills.length > 0 && { mentionedSkills: skills }),
      ...(mcps.length > 0 && { mentionedMcpServers: mcps }),
    }
  }, [
    attachedDirs,
    currentSelection.channelId,
    currentSelection.modelId,
    enabledToolIds,
    historyTurns,
    sessionId,
    sessionMeta?.updatedAt,
    thinkingLevel,
  ])

  const startSessionSend = React.useCallback((
    input: SessionSendInput,
    options?: {
      clearComposerDraft?: boolean
    },
  ): Promise<void> => {
    setAgentStreamErrors((prev) => {
      if (!prev.has(sessionId)) return prev
      const map = new Map(prev)
      map.delete(sessionId)
      return map
    })

    setPromptSuggestions((prev) => {
      if (!prev.has(sessionId)) return prev
      const map = new Map(prev)
      map.delete(sessionId)
      return map
    })

    const prevStream = store.get(agentStreamingStatesAtom).get(sessionId)
    if (!streaming && prevStream && prevStream.content && !prevStream.running) {
      setMessages((prev) => {
        const lastMsg = prev[prev.length - 1]
        if (lastMsg?.role === 'assistant') return prev
        return [...prev, {
          id: `snapshot-${Date.now()}`,
          role: 'assistant' as const,
          content: prevStream.content,
          createdAt: Date.now(),
          model: prevStream.model,
        }]
      })
    }

    store.set(dismissedTeamSessionIdsAtom, (prev: Set<string>) => {
      if (!prev.has(sessionId)) return prev
      const next = new Set(prev)
      next.delete(sessionId)
      return next
    })

    if (!streaming) {
      setStreamingStates((prev) => {
        const map = new Map(prev)
        map.set(sessionId, {
          running: true,
          content: '',
          toolActivities: [],
          processEvents: [],
          model: currentSelection.modelId || undefined,
          startedAt: Date.now(),
        })
        return map
      })
    }

    const tempUserMsg: AgentMessage = {
      id: `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      role: 'user',
      content: input.userMessage,
      createdAt: Date.now(),
      attachments: input.attachments,
    }
    setMessages((prev) => [...prev, tempUserMsg])

    if (options?.clearComposerDraft) {
      setInputContent('')
    }

    return window.electronAPI.sendSessionMessage(input).catch((error) => {
      console.error('[AgentView] 发送消息失败:', error)
      toast.error(error instanceof Error ? error.message : '发送消息失败')
      setMessages((prev) => prev.filter((message) => message.id !== tempUserMsg.id))
      if (options?.clearComposerDraft) {
        const currentDraft = store.get(agentSessionDraftsAtom).get(sessionId) ?? ''
        setInputContent(mergeRecoveredComposerDraft(input.userMessage, currentDraft))
      }
      if (!streaming) {
        setStreamingStates((prev) => {
          if (!prev.has(sessionId)) return prev
          const map = new Map(prev)
          map.delete(sessionId)
          return map
        })
      }
      throw error
    })
  }, [
    currentSelection.modelId,
    sessionId,
    setAgentStreamErrors,
    setInputContent,
    setPromptSuggestions,
    setStreamingStates,
    store,
    streaming,
  ])

  const enqueueSessionSend = React.useCallback((input: SessionSendInput): void => {
    const item: AgentQueuedSend = {
      id: `queued-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      sessionId,
      input,
      createdAt: Date.now(),
    }

    setQueuedSendMap((prev) => enqueueQueuedSendMap(prev, item))
    setPromptSuggestions((prev) => {
      if (!prev.has(sessionId)) return prev
      const map = new Map(prev)
      map.delete(sessionId)
      return map
    })
    toast.info('已加入等待区')
  }, [sessionId, setPromptSuggestions, setQueuedSendMap])

  const dispatchPreparedMessage = React.useCallback(async (
    finalMessage: string,
    attachments: FileAttachment[] = [],
    options?: {
      clearComposerDraft?: boolean
      incognito?: boolean
    },
  ): Promise<boolean> => {
    if ((!finalMessage.trim() && attachments.length === 0) || !currentSelection.channelId) return false

    const messageIncognito = options?.incognito
    const input = buildSessionSendInput(finalMessage, attachments)
    if (messageIncognito) {
      input.incognito = true
    }

    if (streaming) {
      enqueueSessionSend(input)
      if (options?.clearComposerDraft) {
        setInputContent('')
      }
      return true
    }

    await startSessionSend(input, options)

    return true
  }, [
    buildSessionSendInput,
    currentSelection.channelId,
    enqueueSessionSend,
    setInputContent,
    startSessionSend,
    streaming,
  ])

  const queuedSendFlushVersionRef = React.useRef(0)
  React.useEffect(() => {
    if (loadedRefreshVersion === queuedSendFlushVersionRef.current) return
    queuedSendFlushVersionRef.current = loadedRefreshVersion
    if (streaming || queuedSends.length === 0 || queuedSendFlushRef.current) return

    const timer = window.setTimeout(() => {
      const nextQueuedSend = store.get(agentQueuedSendMapAtom).get(sessionId)?.[0]
      if (!nextQueuedSend || queuedSendFlushRef.current) return

      queuedSendFlushRef.current = nextQueuedSend.id
      setQueuedSendMap((prev) => shiftQueuedSendMap(prev, sessionId).map)

      const sendPromise = startSessionSend(nextQueuedSend.input)
      if (queuedSendFlushRef.current === nextQueuedSend.id) {
        queuedSendFlushRef.current = null
      }

      sendPromise.catch(() => {
        setQueuedSendMap((prev) => prependQueuedSendMap(prev, nextQueuedSend))
      })
    }, 120)

    return () => window.clearTimeout(timer)
  }, [
    loadedRefreshVersion,
    queuedSends.length,
    sessionId,
    setQueuedSendMap,
    startSessionSend,
    store,
    streaming,
  ])

  const handleRemoveQueuedSend = React.useCallback((queuedId: string): void => {
    setQueuedSendMap((prev) => removeQueuedSendMapItem(prev, sessionId, queuedId))
  }, [sessionId, setQueuedSendMap])

  const handleUseFollowUp = React.useCallback((prompt: string): void => {
    setInputContent(prompt)
    setPromptSuggestions((prev) => {
      if (!prev.has(sessionId)) return prev
      const map = new Map(prev)
      map.delete(sessionId)
      return map
    })
    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }, [sessionId, setInputContent, setPromptSuggestions])

  const dispatchEditedTurn = React.useCallback((
    messageId: string,
    finalMessage: string,
    attachments: FileAttachment[] = [],
    onRejectedBeforePersistence?: () => Promise<void> | void,
  ): boolean => {
    if ((!finalMessage.trim() && attachments.length === 0) || !currentSelection.channelId || streaming) return false

    const plan = buildSessionTurnReplayPlan(messages, messageId)
    if (!plan) return false

    setAgentStreamErrors((prev) => {
      if (!prev.has(sessionId)) return prev
      const map = new Map(prev)
      map.delete(sessionId)
      return map
    })

    setPromptSuggestions((prev) => {
      if (!prev.has(sessionId)) return prev
      const map = new Map(prev)
      map.delete(sessionId)
      return map
    })

    const optimisticEditedUser = createOptimisticReplayUserMessage({
      ...plan.replayUserMessage,
      content: finalMessage,
      attachments: attachments.length > 0 ? attachments : undefined,
    }, {
      idPrefix: 'edit-temp',
    })

    setMessages([...plan.prefixBeforeTurn, optimisticEditedUser])
    setStreamingStates((prev) => {
      const map = new Map(prev)
      map.set(sessionId, {
        running: true,
        content: '',
        toolActivities: [],
        processEvents: [],
        model: currentSelection.modelId || undefined,
        startedAt: Date.now(),
      })
      return map
    })

    void window.electronAPI.editSessionTurn({
      sessionId,
      messageId,
      userMessage: finalMessage,
      attachments: attachments.length > 0 ? attachments : undefined,
    })
      .catch(async (error) => {
        console.error('[AgentView] 编辑重发失败:', error)
        toast.error('编辑重发失败', {
          description: '请稍后再试，或检查当前渠道和模型是否可用',
        })
        setStreamingStates((prev) => {
          const map = new Map(prev)
          map.delete(sessionId)
          return map
        })

        let persisted = false
        let persistenceKnown = false
        try {
          const sessionMessages = await window.electronAPI.getSessionMessages(sessionId)
          persistenceKnown = true
          persisted = sessionMessages.some((message) => (
            message.role === 'user'
            && message.content === finalMessage
            && message.createdAt >= optimisticEditedUser.createdAt - 1_000
          ))
          const nextMessages = sessionMessages
            .map(sessionMessageToLegacyAgentMessage)
            .filter((message): message is AgentMessage => message !== null)
          setMessages(nextMessages)
        } catch (reloadError) {
          console.error('[AgentView] 恢复编辑前消息失败:', reloadError)
        }

        if (persistenceKnown && !persisted) await onRejectedBeforePersistence?.()
      })

    return true
  }, [
    currentSelection.channelId,
    currentSelection.modelId,
    messages,
    sessionId,
    setAgentStreamErrors,
    setPromptSuggestions,
    setStreamingStates,
    streaming,
  ])

  /** 发送消息 */
  const handleSend = React.useCallback(async (): Promise<void> => {
    // 同步从 store 读取最新草稿，避免闭包捕获的 inputContent 在 InputRule 触发
    // chip 转换的瞬间还是旧值（onChange → atom 更新是异步的，Enter 紧随其后时会漏掉）。
    const latestDraft = store.get(agentSessionDraftsAtom).get(sessionId) ?? ''
    const text = latestDraft.trim()
    // 如果输入为空但有建议，使用建议内容
    const effectiveText = editingTurn ? text : (text || suggestion || '')
    if ((!effectiveText && pendingFiles.length === 0) || !currentSelection.channelId) return

    // 快照当前隐身状态，只有发送事务被接受后才重置
    const messageIncognito = store.get(incognitoModeAtom) || undefined
    const preparationDataSnapshot = new Map<string, string>()
    for (const file of pendingFiles) {
      const data = window.__pendingAgentFileData?.get(file.id)
      if (data) preparationDataSnapshot.set(file.id, data)
    }

    // 1. 如果有 pending 文件，先保存到 session 目录
    let savedAttachments: FileAttachment[] = []
    if (pendingFiles.length > 0) {
      const preparation = preparePendingFilePayloads(pendingFiles, window.__pendingAgentFileData)
      if (preparation.missingFileNames.length > 0) {
        toast.error('附件数据不可用', {
          description: `请重新添加：${preparation.missingFileNames.join('、')}`,
        })
        return
      }
      try {
        const saved = await window.electronAPI.saveFilesToSessionProject({
          sessionId,
          files: preparation.files,
        })
        if (saved.length !== pendingFiles.length) {
          throw new Error(`预期保存 ${pendingFiles.length} 个附件，实际保存 ${saved.length} 个`)
        }
        savedAttachments = saved.map((file, index) => {
          const mediaType = pendingFiles[index]?.mediaType ?? 'application/octet-stream'
          return {
            id: pendingFiles[index]?.id ?? `agent-file-${sessionId}-${index}`,
            filename: file.filename,
            mediaType,
            localPath: file.targetPath,
            size: pendingFiles[index]?.size ?? 0,
            // 图片类型携带 inlineData，避免磁盘读取路径问题
            ...(mediaType.startsWith('image/') && {
              inlineData: window.__pendingAgentFileData?.get(pendingFiles[index]?.id ?? ''),
            }),
          }
        })
      } catch (error) {
        console.error('[AgentView] 保存附件到项目目录失败:', error)
        toast.error('附件保存失败', {
          description: error instanceof Error ? error.message : '附件仍保留在输入区，请重试',
        })
        return
      }
    }

    // 2. 构建最终消息
    const finalMessage = effectiveText

    const rollbackSavedAttachments = async (): Promise<void> => {
      const rollbackResults = await Promise.allSettled(savedAttachments.map((attachment) => (
        attachment.localPath
          ? window.electronAPI.deleteFile(attachment.localPath)
          : Promise.resolve()
      )))
      if (rollbackResults.some((result) => result.status === 'rejected')) {
        console.error('[AgentView] 回滚未发送附件失败')
      }
    }

    let sent = false
    try {
      sent = editingTurn
        ? dispatchEditedTurn(editingTurn.messageId, finalMessage, savedAttachments, async () => {
          await rollbackSavedAttachments()
          for (const file of pendingFiles) {
            const data = preparationDataSnapshot.get(file.id)
            if (data) window.__pendingAgentFileData?.set(file.id, data)
          }
          setPendingFiles((current) => {
            const currentIds = new Set(current.map((file) => file.id))
            const restored = pendingFiles
              .filter((file) => !currentIds.has(file.id))
              .map((file) => {
                const data = preparationDataSnapshot.get(file.id)
                return file.previewUrl?.startsWith('blob:') && data && file.mediaType.startsWith('image/')
                  ? { ...file, previewUrl: `data:${file.mediaType};base64,${data}` }
                  : file
              })
            return [...restored, ...current]
          })
          setInputContent(finalMessage)
          setEditingTurn(editingTurn)
        })
        : await dispatchPreparedMessage(finalMessage, savedAttachments, {
          clearComposerDraft: true,
          incognito: messageIncognito,
        })
    } catch {
      // 保存附件与发送消息构成一个 UI 事务；发送未被接受时撤销本轮新写入的文件。
      await rollbackSavedAttachments()
      return
    }

    if (sent) {
      for (const file of pendingFiles) {
        if (file.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(file.previewUrl)
        window.__pendingAgentFileData?.delete(file.id)
      }
      setPendingFiles([])
      if (messageIncognito) store.set(incognitoModeAtom, false)
      if (editingTurn) {
        setInputContent('')
        setEditingTurn(null)
      }
      clearWidgetDraftProposal(sessionId)
    }
  }, [clearWidgetDraftProposal, currentSelection.channelId, dispatchEditedTurn, dispatchPreparedMessage, editingTurn, pendingFiles, sessionId, setInputContent, setPendingFiles, store, streaming, suggestion])

  /** 停止生成 */
  const handleStop = React.useCallback((): void => {
    setStreamingStates((prev) => {
      const current = prev.get(sessionId)
      if (!current) return prev
      const map = new Map(prev)
      map.set(sessionId, { ...current, running: false })
      return map
    })

    window.electronAPI.stopSession(sessionId).catch(console.error)
  }, [sessionId, setStreamingStates])

  const handleSendWidgetDraftProposal = React.useCallback((): void => {
    if (!widgetDraftProposal) return

    void dispatchPreparedMessage(widgetDraftProposal.prompt)
      .then((sent) => {
        if (sent) clearWidgetDraftProposal(sessionId)
      })
      .catch(() => undefined)
  }, [clearWidgetDraftProposal, dispatchPreparedMessage, sessionId, widgetDraftProposal])

  const handleEditWidgetDraftProposal = React.useCallback((): void => {
    if (!widgetDraftProposal) return

    const nextDraft = inputContent.trim()
      ? `${inputContent}\n\n${widgetDraftProposal.prompt}`
      : widgetDraftProposal.prompt

    setInputContent(nextDraft)
    clearWidgetDraftProposal(sessionId)
  }, [clearWidgetDraftProposal, inputContent, sessionId, setInputContent, widgetDraftProposal])

  const handleCancelWidgetDraftProposal = React.useCallback((): void => {
    clearWidgetDraftProposal(sessionId)
  }, [clearWidgetDraftProposal, sessionId])

  /** 手动发送 /compact 命令 */
  const handleCompact = React.useCallback((): void => {
    if (!currentSelection.channelId || streaming) return

    // 初始化流式状态
    setStreamingStates((prev) => {
      const map = new Map(prev)
      const current = prev.get(sessionId) ?? {
        running: true,
        content: '',
        toolActivities: [],
        processEvents: [],
        model: currentSelection.modelId || undefined,
        startedAt: Date.now(),
      }
      map.set(sessionId, { ...current, running: true, startedAt: current.startedAt ?? Date.now() })
      return map
    })

    window.electronAPI.sendSessionMessage({
      sessionId,
      userMessage: '/compact',
      channelId: currentSelection.channelId ?? undefined,
      modelId: currentSelection.modelId || undefined,
      sessionUpdatedAt: sessionMeta?.updatedAt,
      thinkingLevel: thinkingLevel,
      historyTurns: historyTurns,
      enabledToolIds,
      skipAutoTitle: true,
    }).catch(console.error)
  }, [sessionId, currentSelection.channelId, currentSelection.modelId, enabledToolIds, historyTurns, sessionMeta?.updatedAt, thinkingLevel, streaming, setStreamingStates])

  const replayTurn = React.useCallback((messageId: string): void => {
    if (!currentSelection.channelId || streaming) return

    const plan = buildSessionTurnReplayPlan(messages, messageId)
    if (!plan) return

    setAgentStreamErrors((prev) => {
      if (!prev.has(sessionId)) return prev
      const map = new Map(prev)
      map.delete(sessionId)
      return map
    })

    const optimisticReplayUser = createOptimisticReplayUserMessage(plan.replayUserMessage)
    setMessages([...plan.prefixBeforeTurn, optimisticReplayUser])
    setStreamingStates((prev) => {
      const map = new Map(prev)
      map.set(sessionId, {
        running: true,
        content: '',
        toolActivities: [],
        processEvents: [],
        model: currentSelection.modelId || undefined,
        startedAt: Date.now(),
      })
      return map
    })

    window.electronAPI.regenerateSessionTurn({
      sessionId,
      messageId,
    }).catch((error) => {
      console.error('[AgentView] 原地重生失败:', error)
      toast.error('重新生成失败', {
        description: '请稍后再试，或检查当前渠道和模型是否可用',
      })
      setStreamingStates((prev) => {
        const map = new Map(prev)
        map.delete(sessionId)
        return map
      })
      window.electronAPI.getSessionMessages(sessionId)
        .then((sessionMessages) => {
          const nextMessages = sessionMessages
            .map(sessionMessageToLegacyAgentMessage)
            .filter((message): message is AgentMessage => message !== null)
          setMessages(nextMessages)
        })
        .catch(console.error)
    })
  }, [messages, sessionId, currentSelection.channelId, currentSelection.modelId, streaming, setAgentStreamErrors, setStreamingStates])

  /** 重试：复用最近失败 turn 的 replay 路径，避免不断追加重复 user turn */
  const handleRetry = React.useCallback((): void => {
    const retryTarget = [...messages].reverse().find((message) => (
      (message.role === 'status' && message.errorCode)
      || message.role === 'assistant'
      || message.role === 'user'
    ))

    if (!retryTarget) return
    replayTurn(retryTarget.id)
  }, [messages, replayTurn])

  /** 原地重生某条助手回复所属 turn */
  const handleRegenerateTurn = React.useCallback((messageId: string): void => {
    replayTurn(messageId)
  }, [replayTurn])

  // 会话生命周期动作（回退 / 分叉 / 在新会话中重试）已拆分至 useSessionLifecycleActions。
  const {
    handleConfirmRewind,
    handleBranchFromMessage,
    handleRetryInNewSession,
  } = useSessionLifecycleActions({
    sessionId,
    currentSelection,
    thinkingLevel,
    historyTurns,
    projectPath,
    enabledToolIds,
    rewindTargetMessageId,
    setRewindTargetMessageId,
    setMessages,
  })

  const canSend = (inputContent.trim().length > 0 || pendingFiles.length > 0) && currentSelection.channelId !== null
  const railGutterClassName = 'mx-3 md:mx-[24px]'
  const inputRailClassName = 'relative z-10 px-3 pb-[calc(var(--kila-panel-edge-inset)+6px)] pt-2 md:px-[24px] md:pb-[calc(var(--kila-panel-edge-inset)+6px)]'
  const handleInsertSkillMention = React.useCallback((item: { id: string; label: string }) => {
    inputRef.current?.insertSkillMention(item)
  }, [])
  const handleUseStarterPrompt = React.useCallback((prompt: string) => {
    setInputContent(prompt)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }, [setInputContent])
  const handleEditTurn = React.useCallback((message: AgentMessage): void => {
    void handleStartEditTurn(message)
  }, [handleStartEditTurn])

  return (
    <div className="flex h-full overflow-hidden bg-workspace">
      {/* 主内容区域 */}
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {/* Agent Header */}
        <SessionHeader sessionId={sessionId} messageCount={displayedMessageCount} />

        {/* 消息区域 */}
        <AgentMessages
          sessionId={sessionId}
          messages={messages}
          streaming={streaming}
          streamState={streamState}
          sessionPath={projectPath}
          onRetry={handleRetry}
          onRegenerateTurn={handleRegenerateTurn}
          onEditTurn={handleEditTurn}
          onBranchFromMessage={handleBranchFromMessage}
          onRewindToMessage={streaming ? undefined : setRewindTargetMessageId}
          onRetryInNewSession={handleRetryInNewSession}
          onCompact={handleCompact}
          onUseStarterPrompt={handleUseStarterPrompt}
          followUpSuggestion={!streaming ? suggestion : null}
          onUseFollowUp={handleUseFollowUp}
          hasEarlierMessages={messageWindowStart > 0}
          loadedMessageCount={messages.length}
          totalMessageCount={Math.max(totalMessageCount, messages.length)}
          loadingEarlierMessages={loadingEarlierMessages}
          onLoadEarlierMessages={handleLoadEarlierMessages}
          initialLoading={messagesLoading}
          loadError={messagesLoadError}
          onRetryLoad={() => setMessageLoadRetryVersion((version) => version + 1)}
        />

        {/* 拖拽文件夹结果 */}
        {dragFolderNotice && (
          <div role="status" aria-live="polite" className={cn(railGutterClassName, 'mb-2 flex items-center gap-2 rounded-lg bg-muted/70 px-4 py-2.5 text-sm text-foreground')}>
            <FolderPlus className="size-4 shrink-0" />
            <span className="flex-1">{dragFolderNotice}</span>
            <button
              type="button"
              aria-label="关闭文件夹附加提示"
              className="shrink-0 rounded p-0.5 transition-colors hover:bg-muted"
              onClick={dismissDragFolderNotice}
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {/* 权限请求横幅 */}
        <PermissionBanner sessionId={sessionId} />

        {/* AskUserQuestion 交互式问答横幅 */}
        <AskUserBanner sessionId={sessionId} />

        {widgetDraftProposal && (
          <WidgetDraftBanner
            className={railGutterClassName}
            proposal={widgetDraftProposal}
            onSend={handleSendWidgetDraftProposal}
            onEdit={handleEditWidgetDraftProposal}
            onCancel={handleCancelWidgetDraftProposal}
          />
        )}

        {editingTurn && (
          <div className={cn(railGutterClassName, 'mb-2')}>
            <div className="surface-subtle flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-foreground">编辑已发送消息</div>
                <div className="text-[11px] text-muted-foreground">
                  重新发送后，这条消息之后的内容会按新输入重新执行。
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 rounded-lg px-3 text-xs"
                onClick={handleCancelEditTurn}
              >
                取消
              </Button>
            </div>
          </div>
        )}

        {/* 输入区域 — 独立浮层，和工作区共享同一主题色阶 */}
        <div className={inputRailClassName}>
          <div
            className={cn(
              'workspace-floating-panel workspace-composer-panel overflow-hidden rounded-[var(--kila-panel-radius)] transition-all duration-200',
              isDragOver && 'border-dashed border-primary/50 bg-brand-soft'
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {/* 无 Agent 渠道提示 */}
            {!currentSelection.channelId && (
              <div className="flex items-center gap-2 px-4 py-3 text-sm text-status-warning-foreground">
                <Settings size={14} />
                <span>请先配置并启用可用渠道</span>
                <button
                  type="button"
                  className="text-xs underline underline-offset-2 hover:text-foreground transition-colors"
                  onClick={() => { void window.electronAPI.openSettingsWindow('channels') }}
                >
                  前往设置
                </button>
              </div>
            )}

            {/* 附件预览区域 */}
            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 px-4 pb-1.5 pt-3">
                {pendingFiles.map((file) => (
                  <AttachmentPreviewItem
                    key={file.id}
                    filename={file.filename}
                    mediaType={file.mediaType}
                    size={file.size}
                    previewUrl={file.previewUrl}
                    onRemove={() => handleRemoveFile(file.id)}
                  />
                ))}
              </div>
            )}

            {/* Agent 建议提示 */}
            {suggestion && !streaming && !editingTurn && (
              <div className="px-4 pb-2 pt-1">
                <div className="group flex w-full items-start rounded-xl border border-border/70 bg-brand-soft text-sm transition-colors hover:bg-brand-soft-hover">
                  <button type="button" className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2.5 text-left" onClick={handleSend}>
                    <Sparkles className="mt-0.5 size-4 shrink-0 text-primary/70 group-hover:text-primary" />
                    <span className="min-w-0 flex-1 line-clamp-3 text-foreground/80 group-hover:text-foreground">{suggestion}</span>
                  </button>
                  <button
                    type="button"
                    aria-label="忽略建议"
                    className="mr-2 mt-2.5 shrink-0 rounded p-0.5 text-muted-foreground/40 transition-colors hover:bg-muted hover:text-foreground"
                    onClick={(e) => {
                      setPromptSuggestions((prev) => {
                        if (!prev.has(sessionId)) return prev
                        const map = new Map(prev)
                        map.delete(sessionId)
                        return map
                      })
                    }}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </div>
            )}

            {queuedSends.length > 0 && (
              <div className="px-3 pb-1.5">
                <div className="rounded-xl border border-border/60 bg-muted/25 px-3 py-2">
                  <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
                    <Clock3 className="size-3.5" />
                    <span>等待区</span>
                    <span>{queuedSends.length}</span>
                  </div>
                  <div className="space-y-1">
                    {queuedSends.map((item) => (
                      <div
                        key={item.id}
                        className="flex min-h-7 items-center gap-2 rounded-lg bg-workspace/72 px-2 text-xs text-foreground/80"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {item.input.userMessage.trim()
                            || item.input.attachments?.map((attachment) => attachment.filename).join(', ')
                            || '附件'}
                        </span>
                        <button
                          type="button"
                          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          onClick={() => handleRemoveQueuedSend(item.id)}
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <RichTextInput
              ref={inputRef}
              value={inputContent}
              onChange={setInputContent}
              onSubmit={handleSend}
              onPasteFiles={handlePasteFiles}
              placeholder={
                currentSelection.channelId
                  ? '输入消息...'
                  : '请先配置并启用可用渠道'
              }
              disabled={!currentSelection.channelId}
              autoFocusTrigger={sessionId}
              collapsible
              workspacePath={projectPath}
              capabilitySessionId={sessionId}
              attachedDirs={attachedDirs}
            />



            {/* Footer 工具栏 */}
            <div className="flex min-h-[48px] flex-wrap items-center justify-between gap-2 px-3 pb-2.5 pt-1.5">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                {currentSelection.channelId && (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-[30px] rounded-lg text-foreground/60 hover:text-foreground"
                          onClick={handleOpenFileDialog}
                          aria-label="添加附件"
                        >
                          <Paperclip className="size-5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p>添加附件</p>
                      </TooltipContent>
                    </Tooltip>
                    <SkillTriggerButton
                      onSelectSkill={handleInsertSkillMention}
                      onManageSkills={() => { void window.electronAPI.openSettingsWindow('skills') }}
                      buttonClassName="size-[30px] rounded-lg"
                      iconClassName="size-5"
                    />
                    <ToolSelectorPopover
                      buttonClassName="size-[30px] rounded-lg"
                      iconClassName="size-5"
                    />
                    <ThinkingLevelSelector
                      buttonClassName="size-[30px] rounded-lg"
                      iconClassName="size-5"
                    />
                    <SystemPromptSelector
                      buttonClassName="size-[30px] rounded-lg"
                      iconClassName="size-5"
                    />
                    <ModelSelector
                      presentation="bottom-popover"
                      externalSelectedModel={externalSelectedModel}
                      onModelSelect={handleModelSelect}
                    />
                    <ContextUsageIndicator sessionId={sessionId} />
                  </>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {streaming && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-[30px] rounded-lg text-destructive hover:bg-destructive/10"
                    onClick={handleStop}
                    aria-label="停止生成"
                  >
                    <Square className="size-[22px]" />
                  </Button>
                )}
                <IncognitoToggle />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className={cn(
                        'size-[30px] rounded-lg',
                        canSend
                          ? 'text-primary hover:bg-primary/10'
                          : 'text-foreground/30 cursor-not-allowed'
                      )}
                      onClick={handleSend}
                      disabled={!canSend}
                      aria-label={streaming ? '加入等待区' : '发送消息'}
                    >
                      {streaming ? <Clock3 className="size-[21px]" /> : <CornerDownLeft className="size-[22px]" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>{streaming ? '加入等待区' : '发送消息'}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 侧面板（Team Activity + File Browser） */}
      <React.Suspense fallback={null}>
        <SessionSidePanel sessionId={sessionId} />
      </React.Suspense>
      <AlertDialog open={rewindTargetMessageId !== null} onOpenChange={(open) => { if (!open) setRewindTargetMessageId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>回退到这条消息？</AlertDialogTitle>
            <AlertDialogDescription>
              该消息之后的会话记录会被删除，Agent 运行时状态也会重建。建议先创建分叉会话保留当前路线。项目文件不会自动回滚。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void handleConfirmRewind() }}>确认回退</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
