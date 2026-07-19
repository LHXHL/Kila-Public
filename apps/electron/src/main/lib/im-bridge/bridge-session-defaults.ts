import type {
  BridgeBinding,
  BridgeChannelSessionOverride,
  BridgeChannelType,
  BridgeConfig,
  Channel,
  SessionMeta,
} from '@kila/shared'

export type BridgeDefaultsSource = 'session' | 'channel' | 'general' | 'app'

export type BridgeSessionDefaultsResolution =
  | {
    ok: true
    source: BridgeDefaultsSource
    channelId: string
    modelId: string
  }
  | {
    ok: false
    error: string
  }

export type InboundBridgeSessionPlan =
  | {
    ok: true
    source: BridgeDefaultsSource
    channelId: string
    modelId: string
    shouldSyncSessionMeta: boolean
  }
  | {
    ok: false
    error: string
  }

interface ResolveBridgeSessionDefaultsInput {
  channelType: BridgeChannelType
  config: BridgeConfig
  channels: Channel[]
  appSettings?: {
    agentChannelId?: string
    agentModelId?: string
  }
  session?: Pick<SessionMeta, 'channelId' | 'modelId'>
  ignoreSessionSelection?: boolean
}

interface ResolveConfiguredBridgeSessionDefaultsInput {
  channelType: BridgeChannelType
  config: BridgeConfig
  channels: Channel[]
  appSettings?: {
    agentChannelId?: string
    agentModelId?: string
  }
}

interface ComputeBridgeSessionDefaultsSyncUpdatesInput {
  bindings: Array<Pick<BridgeBinding, 'channelType' | 'sessionId'>>
  sessions: Array<Pick<SessionMeta, 'id' | 'channelId' | 'modelId'>>
  previousConfig: BridgeConfig
  nextConfig: BridgeConfig
  channels: Channel[]
  appSettings?: {
    agentChannelId?: string
    agentModelId?: string
  }
}

export interface BridgeSessionDefaultsSyncUpdate {
  sessionId: string
  channelId: string
  modelId: string
}

function getChannelLabel(channelType: BridgeChannelType): string {
  switch (channelType) {
    case 'telegram':
      return 'Telegram'
    case 'discord':
      return 'Discord'
    case 'feishu':
      return 'Feishu'
    case 'wechat':
      return 'WeChat'
  }
}

function getChannelOverride(
  config: BridgeConfig,
  channelType: BridgeChannelType,
): BridgeChannelSessionOverride | undefined {
  switch (channelType) {
    case 'telegram':
      return config.telegram.defaultSession
    case 'discord':
      return config.discord.defaultSession
    case 'feishu':
      return config.feishu.defaultSession
    case 'wechat':
      return config.wechat.defaultSession
  }
}

function validateCandidate(
  sourceLabel: string,
  channelId: string,
  modelId: string,
  channels: Channel[],
): string | null {
  const channel = channels.find((item) => item.id === channelId)
  if (!channel) {
    return `${sourceLabel} 默认模型无效：供应商渠道不存在 (${channelId})。`
  }
  if (!channel.enabled) {
    return `${sourceLabel} 默认模型无效：供应商渠道已禁用 (${channelId})。`
  }

  const model = channel.models.find((item) => item.id === modelId)
  if (!model) {
    return `${sourceLabel} 默认模型无效：模型不存在 (${modelId})。`
  }
  if (!model.enabled) {
    return `${sourceLabel} 默认模型无效：模型已禁用 (${modelId})。`
  }

  return null
}

function resolveCandidate(
  candidate: {
    source: BridgeDefaultsSource
    channelId?: string
    modelId?: string
    label: string
  },
  channels: Channel[],
): BridgeSessionDefaultsResolution | null {
  const channelId = candidate.channelId?.trim()
  const modelId = candidate.modelId?.trim()

  if (!channelId && !modelId) {
    return null
  }

  if (!channelId || !modelId) {
    return {
      ok: false,
      error: `${candidate.label} 默认模型配置不完整：必须同时提供 channelId 和 modelId。`,
    }
  }

  const error = validateCandidate(candidate.label, channelId, modelId, channels)
  if (error) {
    return {
      ok: false,
      error,
    }
  }

  return {
    ok: true,
    source: candidate.source,
    channelId,
    modelId,
  }
}

function getSessionSelection(
  session?: Pick<SessionMeta, 'channelId' | 'modelId'>,
): { channelId?: string; modelId?: string } {
  return {
    channelId: session?.channelId?.trim() || undefined,
    modelId: session?.modelId?.trim() || undefined,
  }
}

function sameSelection(
  left: { channelId?: string; modelId?: string },
  right: { channelId: string; modelId: string },
): boolean {
  return left.channelId === right.channelId && left.modelId === right.modelId
}

export function resolveConfiguredBridgeSessionDefaults(
  input: ResolveConfiguredBridgeSessionDefaultsInput,
): BridgeSessionDefaultsResolution {
  const channelLabel = getChannelLabel(input.channelType)
  const candidates: Array<{
    source: BridgeDefaultsSource
    channelId?: string
    modelId?: string
    label: string
  }> = [
    {
      source: 'channel',
      channelId: getChannelOverride(input.config, input.channelType)?.channelId,
      modelId: getChannelOverride(input.config, input.channelType)?.modelId,
      label: `${channelLabel}`,
    },
    {
      source: 'general',
      channelId: input.config.defaultSession.channelId,
      modelId: input.config.defaultSession.modelId,
      label: 'Bridge General',
    },
    {
      source: 'app',
      channelId: input.appSettings?.agentChannelId,
      modelId: input.appSettings?.agentModelId,
      label: 'Agent 默认模型',
    },
  ]

  for (const candidate of candidates) {
    const resolution = resolveCandidate(candidate, input.channels)
    if (resolution) {
      return resolution
    }
  }

  return {
    ok: false,
    error: `${channelLabel} 默认模型未配置，请在 Bridge 设置中配置 Default Model，或设置全局 Agent 默认模型。`,
  }
}

export function resolveEffectiveBridgeSessionDefaults(
  input: ResolveBridgeSessionDefaultsInput,
): BridgeSessionDefaultsResolution {
  if (!input.ignoreSessionSelection) {
    const sessionCandidate = resolveCandidate({
      source: 'session',
      channelId: input.session?.channelId,
      modelId: input.session?.modelId,
      label: 'Session',
    }, input.channels)

    if (sessionCandidate) {
      return sessionCandidate
    }
  }

  return resolveConfiguredBridgeSessionDefaults(input)
}

export function resolveInboundBridgeSessionPlan(
  input: ResolveBridgeSessionDefaultsInput,
): InboundBridgeSessionPlan {
  const resolved = resolveEffectiveBridgeSessionDefaults(input)
  if (!resolved.ok) {
    return resolved
  }

  return {
    ...resolved,
    shouldSyncSessionMeta: resolved.source !== 'session' && !sameSelection(
      getSessionSelection(input.session),
      {
        channelId: resolved.channelId,
        modelId: resolved.modelId,
      },
    ),
  }
}

/**
 * 解析 bridge session 的 projectPath，优先级：
 * 1. binding 级（单个聊天/频道）
 * 2. channel 级（如 Telegram 渠道默认）
 * 3. 全局 bridge 默认
 * 4. undefined → temp 目录
 */
export function resolveBridgeProjectPath(input: {
  binding?: Pick<BridgeBinding, 'projectPath'>
  channelType: BridgeChannelType
  config: BridgeConfig
}): string | undefined {
  if (input.binding?.projectPath) return input.binding.projectPath
  const channelOverride = getChannelOverride(input.config, input.channelType)
  if (channelOverride?.projectPath) return channelOverride.projectPath
  if (input.config.defaultSession.projectPath) return input.config.defaultSession.projectPath
  return undefined
}

export function computeBridgeSessionDefaultsSyncUpdates(
  input: ComputeBridgeSessionDefaultsSyncUpdatesInput,
): BridgeSessionDefaultsSyncUpdate[] {
  const sessionsById = new Map(input.sessions.map((session) => [session.id, session]))
  const nextCache = new Map<BridgeChannelType, BridgeSessionDefaultsResolution>()
  const pending = new Map<string, { current: { channelId?: string; modelId?: string }; desired: { channelId: string; modelId: string } | null } | 'conflict'>()

  const resolveNext = (channelType: BridgeChannelType): BridgeSessionDefaultsResolution => {
    const cached = nextCache.get(channelType)
    if (cached) return cached
    const resolved = resolveConfiguredBridgeSessionDefaults({
      channelType,
      config: input.nextConfig,
      channels: input.channels,
      appSettings: input.appSettings,
    })
    nextCache.set(channelType, resolved)
    return resolved
  }

  // 检查 session 模型是否来自 defaults 链中的任意一级（channel → general → app）
  // 而非只匹配最终 resolved 值，避免 session 创建时跟随 general default 被误判为 conflict
  const followsDefaultsChain = (
    sessionSelection: { channelId?: string; modelId?: string },
    config: BridgeConfig,
    channelType: BridgeChannelType,
  ): boolean => {
    if (!sessionSelection.channelId && !sessionSelection.modelId) return true
    const channelOverride = getChannelOverride(config, channelType)
    if (channelOverride?.channelId && channelOverride?.modelId
      && sameSelection(sessionSelection, { channelId: channelOverride.channelId, modelId: channelOverride.modelId })) return true
    if (config.defaultSession.channelId && config.defaultSession.modelId
      && sameSelection(sessionSelection, { channelId: config.defaultSession.channelId, modelId: config.defaultSession.modelId })) return true
    if (input.appSettings?.agentChannelId && input.appSettings?.agentModelId
      && sameSelection(sessionSelection, { channelId: input.appSettings.agentChannelId, modelId: input.appSettings.agentModelId })) return true
    return false
  }

  for (const binding of input.bindings) {
    const session = sessionsById.get(binding.sessionId)
    if (!session) continue

    const currentSelection = getSessionSelection(session)
    const nextDefaults = resolveNext(binding.channelType)
    const followsPreviousDefaults = followsDefaultsChain(currentSelection, input.previousConfig, binding.channelType)
    const current = pending.get(binding.sessionId)

    if (!followsPreviousDefaults) {
      pending.set(binding.sessionId, 'conflict')
      continue
    }

    const desiredSelection = nextDefaults.ok
      ? {
          channelId: nextDefaults.channelId,
          modelId: nextDefaults.modelId,
        }
      : null

    if (!current) {
      pending.set(binding.sessionId, {
        current: currentSelection,
        desired: desiredSelection,
      })
      continue
    }

    if (current === 'conflict') {
      continue
    }

    if (!current.desired || !desiredSelection) {
      if (current.desired !== desiredSelection) {
        pending.set(binding.sessionId, 'conflict')
      }
      continue
    }

    if (
      current.desired.channelId !== desiredSelection.channelId
      || current.desired.modelId !== desiredSelection.modelId
    ) {
      pending.set(binding.sessionId, 'conflict')
    }
  }

  return Array.from(pending.entries())
    .flatMap(([sessionId, value]) => {
      if (value === 'conflict' || !value.desired || sameSelection(value.current, value.desired)) {
        return []
      }

      return [{
        sessionId,
        channelId: value.desired.channelId,
        modelId: value.desired.modelId,
      }]
    })
}
