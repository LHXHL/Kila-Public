import type { Channel } from '@kila/shared'

export type ChannelModelResolution =
  | {
      ok: true
      modelId: string
    }
  | {
      ok: false
      error: string
    }

function normalizeModelId(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function findEnabledModel(channel: Channel, modelId: string | undefined) {
  if (!modelId) {
    return undefined
  }

  return channel.models.find((model) => model.id === modelId && model.enabled)
}

export function resolveChannelModel(
  channel: Channel,
  options?: {
    requestedModelId?: string
    preferredModelId?: string
  },
): ChannelModelResolution {
  const requestedModelId = normalizeModelId(options?.requestedModelId)
  if (requestedModelId) {
    const requestedModel = channel.models.find((model) => model.id === requestedModelId)
    if (!requestedModel) {
      return {
        ok: false,
        error: `模型 ${requestedModelId} 不属于渠道 ${channel.name}`,
      }
    }

    if (!requestedModel.enabled) {
      return {
        ok: false,
        error: `模型已禁用: ${requestedModelId}`,
      }
    }

    return {
      ok: true,
      modelId: requestedModel.id,
    }
  }

  const preferredModel = findEnabledModel(channel, normalizeModelId(options?.preferredModelId))
  if (preferredModel) {
    return {
      ok: true,
      modelId: preferredModel.id,
    }
  }

  const firstEnabledModel = channel.models.find((model) => model.enabled)
  if (firstEnabledModel) {
    return {
      ok: true,
      modelId: firstEnabledModel.id,
    }
  }

  return {
    ok: false,
    error: `渠道 ${channel.name} 未配置可用模型`,
  }
}
