import { atom, type Atom } from 'jotai'
import type {
  AgentMessage,
  AgentPendingFile,
  ProviderDbModel,
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
  providerDbEntry?: ProviderDbModel | null,
): number | undefined {
  if (streamState?.contextWindow) {
    return streamState.contextWindow
  }

  if (channel && modelId) {
    const metadata = resolveModelMetadata({
      channelProvider: channel.provider,
      channelBaseUrl: channel.baseUrl,
      modelId,
      // 注入 Provider DB 命中：capabilityProviderId 常按协议配成 'openai'，静态估算时
      // 若不传 entry，resolveModelMetadata 拿不到 DB 窗口，只能等流式 usage_update 回来才正确。
      providerDbEntry: providerDbEntry ?? undefined,
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
    providerDbEntry?: ProviderDbModel | null
  },
): AgentContextStatus {
  const modelId = input.modelId ?? input.streamState?.model
  const isCompacting = input.streamState?.isCompacting ?? false
  const hasLiveUsage = typeof input.streamState?.inputTokens === 'number' && input.streamState.inputTokens > 0
  const includeDraft = !input.streamState?.running && !hasLiveUsage
  const contextWindow = resolveContextWindow(input.channel, modelId ?? undefined, input.streamState, input.calibration, input.providerDbEntry)

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

/**
 * Provider DB 模型 entry 缓存（按 modelId）。
 *
 * 渲染层静态估算 contextWindow 时需要 DB 的 limit.context。capabilityProviderId 常按协议
 * 配成 'openai'，而模型实际归属另一个 provider，resolveModelMetadata 不传 entry 拿不到 DB 窗口。
 * 这里通过 findProviderDbModel IPC 异步预取并缓存，agentContextStatusAtomFamily 同步读取。
 * null 表示已查过但未命中，避免重复 IPC。
 */
export const providerDbModelCacheAtom = atom<Map<string, ProviderDbModel | null>>(new Map())

/** 按 modelId 异步预取 Provider DB entry 并回填缓存；已缓存则跳过。 */
export const prefetchProviderDbModelAtom = atom(null, async (get, set, modelId: string) => {
  const cache = get(providerDbModelCacheAtom)
  if (cache.has(modelId)) return
  try {
    const hit = await window.electronAPI.findProviderDbModel(modelId)
    const next = new Map(cache)
    next.set(modelId, hit?.model ?? null)
    set(providerDbModelCacheAtom, next)
  } catch {
    // 查询失败也标记为已查，避免反复触发 IPC；静态估算会退到 provider rule / calibration。
    const next = new Map(cache)
    next.set(modelId, null)
    set(providerDbModelCacheAtom, next)
  }
})

const agentContextStatusAtomCache = new Map<string, Atom<AgentContextStatus>>()

export function agentContextStatusAtomFamily(sessionId: string) {
  const existing = agentContextStatusAtomCache.get(sessionId)
  if (existing) return existing

  const created = atom<AgentContextStatus>((get) => {
    const input = get(agentContextInputsAtom).get(sessionId)
    const streamState = get(agentStreamingStatesAtom).get(sessionId)
    const calibration = get(agentContextCalibrationSnapshotsAtom).get(sessionId)
    const snapshot = get(agentContextSnapshotsAtom).get(sessionId)
    const providerDbCache = get(providerDbModelCacheAtom)
    const modelId = input?.modelId ?? streamState?.model ?? snapshot?.modelId
    const providerDbEntry = modelId ? providerDbCache.get(modelId) : undefined

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
      providerDbEntry,
    })
  })
  agentContextStatusAtomCache.set(sessionId, created)
  return created
}

/** Session 删除后释放派生 atom 缓存。 */
export function releaseAgentContextStatusAtom(sessionId: string): void {
  agentContextStatusAtomCache.delete(sessionId)
}
