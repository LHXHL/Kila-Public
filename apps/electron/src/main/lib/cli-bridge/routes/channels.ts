import type { ServerResponse } from 'node:http'
import { PROVIDER_LABELS, type CliBridgeChannelModelsResponse, type CliBridgeChannelResponse, type CliBridgeChannelsResponse, type CliBridgeProvidersResponse } from '@kila/shared'
import { sendError, sendJson } from '../http'
import { listChannels } from '../../channel-manager'

export function handleCliBridgeChannels(response: ServerResponse): void {
  const channels: CliBridgeChannelsResponse = {
    channels: listChannels().map((channel) => ({
      id: channel.id,
      name: channel.name,
      provider: channel.provider,
      enabled: channel.enabled,
      models: channel.models,
      createdAt: channel.createdAt,
      updatedAt: channel.updatedAt,
    })),
  }

  sendJson(response, 200, channels)
}

export function handleCliBridgeChannel(
  response: ServerResponse,
  channelId: string,
): void {
  const channel = listChannels().find((item) => item.id === channelId)
  if (!channel) {
    sendError(response, 404, `Channel 不存在: ${channelId}`)
    return
  }

  const payload: CliBridgeChannelResponse = {
    channel: {
      id: channel.id,
      name: channel.name,
      provider: channel.provider,
      enabled: channel.enabled,
      models: channel.models,
      createdAt: channel.createdAt,
      updatedAt: channel.updatedAt,
      baseUrl: channel.baseUrl,
      enabledModelCount: channel.models.filter((model) => model.enabled).length,
    },
  }

  sendJson(response, 200, payload)
}

export function handleCliBridgeChannelModels(
  response: ServerResponse,
  channelId: string,
): void {
  const channel = listChannels().find((item) => item.id === channelId)
  if (!channel) {
    sendError(response, 404, `Channel 不存在: ${channelId}`)
    return
  }

  const payload: CliBridgeChannelModelsResponse = {
    channelId: channel.id,
    channelName: channel.name,
    provider: channel.provider,
    models: channel.models,
  }

  sendJson(response, 200, payload)
}

export function handleCliBridgeProviders(response: ServerResponse): void {
  const channels = listChannels()
  const providers: CliBridgeProvidersResponse = {
    providers: Object.entries(PROVIDER_LABELS).map(([provider, label]) => {
      const providerChannels = channels.filter((channel) => channel.provider === provider)
      const models = providerChannels.flatMap((channel) => channel.models)
      return {
        provider: provider as keyof typeof PROVIDER_LABELS,
        label,
        channelCount: providerChannels.length,
        enabledChannelCount: providerChannels.filter((channel) => channel.enabled).length,
        modelCount: models.length,
        enabledModelCount: models.filter((model) => model.enabled).length,
      }
    }),
  }

  sendJson(response, 200, providers)
}
