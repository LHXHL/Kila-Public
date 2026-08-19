import { atom, type Atom } from 'jotai'
import type {
  AgentMessage,
  AgentPendingFile,
  SessionContextPartition,
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
  /** 上下文构成分解（估算口径，来自最近一次发送快照）；旧快照可能缺失。 */
  contextPartition?: SessionContextPartition
  /** 本会话累计平均缓存命中率 cacheRead/(cacheRead+cacheCreation)；provider 不上报 cache 时为 undefined。 */
  cacheHitRate?: number
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
    // 与运行时 buildPiModel 同源走 resolveModelMetadata。注意：shared 的窗口解析
    // 单一数据源是「手动覆盖 > 模型名推断」，Provider DB entry 不参与窗口取值，
    // 不要在这里为窗口预取 DB（拿不到也不需要）。
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
  const cacheHitRate = deriveSessionCacheHitRate(input.streamState?.cumulativeUsage)

  if (!modelId || (!hasLiveUsage && !hasMeaningfulContextPayload(input, includeDraft))) {
    return {
      isCompacting,
      contextWindow,
      cacheHitRate,
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
    cacheHitRate,
  }
}

/**
 * 本会话累计平均缓存命中率：cacheRead / (cacheRead + cacheCreation)。
 * 两项均为 0（provider 未上报 cache）时返回 undefined，UI 不显示该行，
 * 避免「0%」被误读为缓存完全未命中。
 */
export function deriveSessionCacheHitRate(
  cumulativeUsage: AgentStreamState['cumulativeUsage'],
): number | undefined {
  const cacheRead = cumulativeUsage?.cacheReadTokens ?? 0
  const cacheCreation = cumulativeUsage?.cacheCreationTokens ?? 0
  const cacheTotal = cacheRead + cacheCreation
  if (cacheTotal <= 0) return undefined
  return cacheRead / cacheTotal
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
        contextPartition: snapshot?.contextPartition,
        cacheHitRate: deriveSessionCacheHitRate(streamState?.cumulativeUsage),
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
        contextPartition: snapshot.contextPartition,
      }
    }

    return {
      ...deriveAgentContextStatus({
        ...input,
        streamState,
        calibration,
      }),
      contextPartition: snapshot?.contextPartition,
    }
  })
  agentContextStatusAtomCache.set(sessionId, created)
  return created
}

/** Session 删除后释放派生 atom 缓存。 */
export function releaseAgentContextStatusAtom(sessionId: string): void {
  agentContextStatusAtomCache.delete(sessionId)
}
