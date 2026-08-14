export type AbilityStatus = 'supported' | 'unsupported' | 'unknown'

import type { ExtraCapabilities } from './extra-capabilities'

export interface ModelAbilities {
  tools: AbilityStatus
  vision: AbilityStatus
  video: AbilityStatus
  reasoning: AbilityStatus
  fileInput: AbilityStatus
  imageOutput: AbilityStatus
}

export interface ModelPricing {
  currency?: 'USD' | 'CNY'
  inputPerMillionUsd?: number
  outputPerMillionUsd?: number
  cacheReadPerMillionUsd?: number
  cacheWritePerMillionUsd?: number
  inputPerMillion?: number
  outputPerMillion?: number
  cacheReadPerMillion?: number
  cacheWritePerMillion?: number
}

export interface ModelMetadata {
  provider: string
  id: string
  displayName: string
  aliases?: string[]
  releasedAt?: string
  deprecated?: boolean
  contextWindowTokens?: number
  maxOutputTokens?: number
  abilities: ModelAbilities
  pricing?: ModelPricing
  iconKey?: string
  source: 'builtin' | 'manual'
  catalogUpdatedAt?: string
  /** 来自 Provider DB 的细粒度能力画像（reasoning effort/budget/level/visibility 等） */
  extraCapabilities?: ExtraCapabilities
}

export interface ModelCatalogEntry extends ModelMetadata {
  source: 'builtin'
}

export type MetadataResolutionSource = 'manual' | 'inference' | 'builtin' | 'provider-rule' | 'fallback' | 'none'

export interface ResolvedModelMetadata extends ModelMetadata {
  resolutionSources: {
    contextWindow: Exclude<MetadataResolutionSource, 'none'>
    abilities: Exclude<MetadataResolutionSource, 'none'>
    pricing: Extract<MetadataResolutionSource, 'manual' | 'builtin' | 'none'>
  }
}
