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
  const source = metadata.resolutionSources.abilities === 'manual'
    ? 'explicit'
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
