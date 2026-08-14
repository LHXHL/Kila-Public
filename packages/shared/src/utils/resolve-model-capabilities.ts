import {
  mapChannelProviderToPiProvider,
  resolveModelMetadata,
  type ResolveModelMetadataInput,
} from '../model-catalog'

export type CapabilitySource = 'explicit' | 'builtin' | 'provider-rule' | 'fallback'
export type CapabilityProvider = 'anthropic' | 'google' | 'openai'

export interface ResolveModelCapabilitiesInput extends ResolveModelMetadataInput {}

export interface ModelCapabilities {
  supportsTools: boolean
  supportsThinking: boolean
  supportsVision: boolean
  contextWindow?: number
  source: CapabilitySource
}

function statusToBoolean(status: 'supported' | 'unsupported' | 'unknown'): boolean {
  return status === 'supported'
}

export function resolveModelCapabilities(input: ResolveModelCapabilitiesInput): ModelCapabilities {
  const metadata = resolveModelMetadata(input)
  // abilities 来源只可能是 explicit/builtin/provider-rule/fallback；'inference' 仅属
  // context 窗口的来源枚举，这里显式收窄，避免类型联合外泄。
  const source = metadata.resolutionSources.abilities === 'manual'
    ? 'explicit'
    : metadata.resolutionSources.abilities === 'inference'
      ? 'fallback'
      : metadata.resolutionSources.abilities

  return {
    supportsTools: statusToBoolean(metadata.abilities.tools),
    supportsThinking: statusToBoolean(metadata.abilities.reasoning),
    supportsVision: statusToBoolean(metadata.abilities.vision),
    contextWindow: metadata.contextWindowTokens,
    source,
  }
}

export { mapChannelProviderToPiProvider }
