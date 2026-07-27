import { atom, type Atom } from 'jotai'
import type {
  AgentMessage,
  AgentPendingFile,
  SessionMessage,
} from '@kila/shared'
import {
  estimateSessionContext,
  resolveModelMetadata,
  withLegacyAttachedFilesBlock,
} from '@kila/shared'
import type {
  EstimateSessionContextInput,
  SessionContextCalibrationSnapshot,
  SessionContextSnapshot,
} from '@kila/shared'
import type { AgentStreamState } from './agent-stream-atoms'
import { agentStreamingStatesAtom } from './agent-stream-atoms'

export interface AgentContextChannelMeta {
  provider: string
  baseUrl: string
}

export interface AgentContextCalibrationSnapshot extends SessionContextCalibrationSnapshot {
  contextWindow?: number
}

export interface AgentContextInput {
  channel?: AgentContextChannelMeta | null
  modelId?: string | null
  historyTurns?: EstimateSessionContextInput['historyTurns']
  messages: AgentMessage[]
  currentTurnText?: string
  pendingFiles?: Pick<AgentPendingFile, 'id' | 'filename' | 'mediaType' | 'size'>[]
  systemPrompt?: string
  dynamicContext?: string
}

/** 上下文使用量状态 */
export interface AgentContextStatus {
  isCompacting: boolean
  inputTokens?: number
  contextWindow?: number
  estimatedTokens?: number
  fingerprint?: string
  modelId?: string
  source?: 'live' | 'estimate'
  canSeedCalibration: boolean
}

function hasMeaningfulContextPayload(input: AgentContextInput, includeDraft: boolean): boolean {
  if (input.messages.length > 0) return true
  if (includeDraft && input.currentTurnText?.trim()) return true
  return includeDraft && Boolean(input.pendingFiles?.length)
}

function buildPendingFilesBlock(
  pendingFiles?: Pick<AgentPendingFile, 'filename'>[],
): string | undefined {
  if (!pendingFiles || pendingFiles.length === 0) return undefined

  return [
    '<attached_files>',
    ...pendingFiles.map((file) => `- ${file.filename}: ${file.filename}`),
    '</attached_files>',
  ].join('\n')
}

function serializeAgentMessageForEstimate(message: AgentMessage): SessionMessage {
  return {
    id: message.id,
    role: message.role,
    content: withLegacyAttachedFilesBlock(message.content, message.attachments),
    createdAt: message.createdAt,
    model: message.model,
    attachments: message.attachments,
    events: message.events,
    errorCode: message.errorCode,
    errorTitle: message.errorTitle,
    errorDetails: message.errorDetails,
    errorOriginal: message.errorOriginal,
    errorCanRetry: message.errorCanRetry,
    errorActions: message.errorActions,
  }
}

function resolveContextWindow(
  channel: AgentContextChannelMeta | null | undefined,
  modelId: string | undefined,
  streamState?: AgentStreamState,
  calibration?: AgentContextCalibrationSnapshot,
): number | undefined {
  if (streamState?.contextWindow) {
    return streamState.contextWindow
  }

  if (channel && modelId) {
    const metadata = resolveModelMetadata({
      channelProvider: channel.provider,
      channelBaseUrl: channel.baseUrl,
      modelId,
    })
    if (metadata.contextWindowTokens) {
      return metadata.contextWindowTokens
    }
  }

  if (calibration?.modelId === modelId) {
    return calibration?.contextWindow
  }

  return undefined
}

export function deriveAgentContextStatus(
  input: AgentContextInput & {
    streamState?: AgentStreamState
    calibration?: AgentContextCalibrationSnapshot
  },
): AgentContextStatus {
  const modelId = input.modelId ?? input.streamState?.model
  const isCompacting = input.streamState?.isCompacting ?? false
  const hasLiveUsage = typeof input.streamState?.inputTokens === 'number' && input.streamState.inputTokens > 0
  const includeDraft = !input.streamState?.running && !hasLiveUsage
  const contextWindow = resolveContextWindow(input.channel, modelId ?? undefined, input.streamState, input.calibration)

  if (!modelId || (!hasLiveUsage && !hasMeaningfulContextPayload(input, includeDraft))) {
    return {
      isCompacting,
      contextWindow,
      canSeedCalibration: false,
    }
  }

  const estimate = estimateSessionContext({
    modelId,
    contextWindow,
    historyTurns: input.historyTurns,
    systemPrompt: input.systemPrompt ?? '',
    dynamicContext: input.dynamicContext ?? '',
    visibleMessages: input.messages.map(serializeAgentMessageForEstimate),
    currentTurnText: includeDraft ? input.currentTurnText?.trim() || undefined : undefined,
    attachedFilesBlock: includeDraft ? buildPendingFilesBlock(input.pendingFiles) : undefined,
    calibration: input.calibration,
  })

  return {
    isCompacting,
    inputTokens: hasLiveUsage ? input.streamState?.inputTokens : estimate.displayTokens,
    contextWindow,
    estimatedTokens: estimate.estimatedTokens,
    fingerprint: estimate.fingerprint,
    modelId,
    source: hasLiveUsage ? 'live' : 'estimate',
    canSeedCalibration: hasLiveUsage,
  }
}

export const agentContextInputsAtom = atom<Map<string, AgentContextInput>>(new Map())

export const agentContextCalibrationSnapshotsAtom = atom<Map<string, AgentContextCalibrationSnapshot>>(new Map())
export const agentContextSnapshotsAtom = atom<Map<string, SessionContextSnapshot>>(new Map())

const agentContextStatusAtomCache = new Map<string, Atom<AgentContextStatus>>()

export function agentContextStatusAtomFamily(sessionId: string) {
  const existing = agentContextStatusAtomCache.get(sessionId)
  if (existing) return existing

  const created = atom<AgentContextStatus>((get) => {
    const input = get(agentContextInputsAtom).get(sessionId)
    const streamState = get(agentStreamingStatesAtom).get(sessionId)
    const calibration = get(agentContextCalibrationSnapshotsAtom).get(sessionId)
    const snapshot = get(agentContextSnapshotsAtom).get(sessionId)

    if (!input) {
      return {
        isCompacting: streamState?.isCompacting ?? false,
        inputTokens: streamState?.inputTokens ?? snapshot?.estimatedInputTokens,
        estimatedTokens: snapshot?.estimatedInputTokens,
        fingerprint: snapshot?.fingerprint,
        modelId: snapshot?.modelId,
        contextWindow: streamState?.contextWindow ?? snapshot?.contextWindow ?? calibration?.contextWindow,
        source: streamState?.inputTokens ? 'live' : snapshot ? 'estimate' : undefined,
        canSeedCalibration: false,
      }
    }

    if (
      snapshot &&
      !streamState?.inputTokens &&
      (!input.modelId || snapshot.modelId === input.modelId)
    ) {
      return {
        isCompacting: streamState?.isCompacting ?? false,
        inputTokens: snapshot.estimatedInputTokens,
        estimatedTokens: snapshot.estimatedInputTokens,
        fingerprint: snapshot.fingerprint,
        modelId: snapshot.modelId,
        contextWindow: snapshot.contextWindow ?? calibration?.contextWindow,
        source: 'estimate',
        canSeedCalibration: false,
      }
    }

    return deriveAgentContextStatus({
      ...input,
      streamState,
      calibration,
    })
  })
  agentContextStatusAtomCache.set(sessionId, created)
  return created
}

/** Session 删除后释放派生 atom 缓存。 */
export function releaseAgentContextStatusAtom(sessionId: string): void {
  agentContextStatusAtomCache.delete(sessionId)
}
