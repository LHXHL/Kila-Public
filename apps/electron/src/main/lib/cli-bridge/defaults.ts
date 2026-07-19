import type {
  CliBridgeDefaultSelectionStatus,
  CliBridgeStatusResponse,
  SessionMeta,
} from '@kila/shared'
import { CLI_BRIDGE_VERSION } from '@kila/shared'
import { getChannelById } from '../channel-manager'
import { getSettings } from '../settings-service'

interface ResolveCliRunSelectionInput {
  session?: Pick<SessionMeta, 'channelId' | 'modelId'>
  channelId?: string
  modelId?: string
}

export type CliRunSelectionResolution =
  | {
      ok: true
      channelId: string
      modelId: string
    }
  | {
      ok: false
      error: string
    }

function normalizeConfiguredValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function resolveDefaultSelectionStatus(): CliBridgeDefaultSelectionStatus {
  const settings = getSettings()
  const channel = settings.agentChannelId
    ? getChannelById(settings.agentChannelId)
    : undefined
  const model = channel?.models.find((entry) => entry.id === settings.agentModelId)

  return {
    channelId: settings.agentChannelId,
    channelName: channel?.name,
    channelExists: Boolean(channel),
    channelEnabled: channel?.enabled,
    modelId: settings.agentModelId,
    modelExists: Boolean(model),
    modelEnabled: model?.enabled,
  }
}

export function resolveCliRunSelection(
  input: ResolveCliRunSelectionInput,
): CliRunSelectionResolution {
  const settings = getSettings()
  const channelId = normalizeConfiguredValue(input.channelId)
    ?? normalizeConfiguredValue(input.session?.channelId)
    ?? normalizeConfiguredValue(settings.agentChannelId)
  const modelId = normalizeConfiguredValue(input.modelId)
    ?? normalizeConfiguredValue(input.session?.modelId)
    ?? normalizeConfiguredValue(settings.agentModelId)

  if (!channelId) {
    return {
      ok: false,
      error: '请先选择 Agent 模型渠道',
    }
  }

  const channel = getChannelById(channelId)
  if (!channel) {
    return {
      ok: false,
      error: `Agent 模型渠道不存在: ${channelId}`,
    }
  }

  if (!channel.enabled) {
    return {
      ok: false,
      error: `Agent 模型渠道已禁用: ${channelId}`,
    }
  }

  if (!modelId) {
    return {
      ok: false,
      error: `请先为渠道 ${channel.name} 选择模型`,
    }
  }

  const model = channel.models.find((entry) => entry.id === modelId)
  if (!model) {
    return {
      ok: false,
      error: `模型 ${modelId} 不属于渠道 ${channel.name}`,
    }
  }

  if (!model.enabled) {
    return {
      ok: false,
      error: `模型已禁用: ${modelId}`,
    }
  }

  return {
    ok: true,
    channelId: channel.id,
    modelId: model.id,
  }
}

export function buildCliBridgeStatusResponse(
  appVersion: string,
): CliBridgeStatusResponse {
  return {
    ok: true,
    pid: process.pid,
    appVersion,
    bridgeVersion: CLI_BRIDGE_VERSION,
    defaults: resolveDefaultSelectionStatus(),
  }
}
