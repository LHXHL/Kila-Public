import type { AgentGenerateTitleInput, Channel } from '@kila/shared'
import type { AppSettings } from '../../types'

export interface SessionTitleModelTarget {
  source: 'utility' | 'session'
  channelId: string
  modelId: string
}

interface ResolveSessionTitleModelTargetsInput {
  settings: Partial<AppSettings>
  channels: Channel[]
  sessionChannelId?: string
  sessionModelId?: string
}

interface GenerateSessionTitleWithFallbackInput {
  userMessage: string
  sessionChannelId?: string
  sessionModelId?: string
}

interface SessionTitleModelResolverDeps {
  getSettings: () => Partial<AppSettings>
  listChannels: () => Channel[]
  generateSingleTitle: (input: AgentGenerateTitleInput) => Promise<string | null>
}

function hasEnabledChannelModel(
  channels: Channel[],
  channelId: string,
  modelId: string,
): boolean {
  const channel = channels.find((item) => item.id === channelId && item.enabled)
  if (!channel) {
    return false
  }

  return channel.models.some((model) => model.id === modelId && model.enabled)
}

export function resolveSessionTitleModelTargets(
  input: ResolveSessionTitleModelTargetsInput,
): SessionTitleModelTarget[] {
  const {
    settings,
    channels,
    sessionChannelId,
    sessionModelId,
  } = input

  const targets: SessionTitleModelTarget[] = []
  const seen = new Set<string>()

  if (
    settings.utilityChannelId
    && settings.utilityModelId
    && hasEnabledChannelModel(channels, settings.utilityChannelId, settings.utilityModelId)
  ) {
    const key = `${settings.utilityChannelId}:${settings.utilityModelId}`
    seen.add(key)
    targets.push({
      source: 'utility',
      channelId: settings.utilityChannelId,
      modelId: settings.utilityModelId,
    })
  }

  if (sessionChannelId && sessionModelId) {
    const key = `${sessionChannelId}:${sessionModelId}`
    if (!seen.has(key)) {
      targets.push({
        source: 'session',
        channelId: sessionChannelId,
        modelId: sessionModelId,
      })
    }
  }

  return targets
}

export async function generateSessionTitleWithFallback(
  input: GenerateSessionTitleWithFallbackInput,
  deps: SessionTitleModelResolverDeps,
): Promise<string | null> {
  const settings = deps.getSettings()
  const channels = deps.listChannels()
  const targets = resolveSessionTitleModelTargets({
    settings,
    channels,
    sessionChannelId: input.sessionChannelId,
    sessionModelId: input.sessionModelId,
  })

  for (const target of targets) {
    const title = await deps.generateSingleTitle({
      userMessage: input.userMessage,
      channelId: target.channelId,
      modelId: target.modelId,
    })
    if (title) {
      return title
    }
  }

  return null
}
