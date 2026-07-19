import type { ModelAbilities, ModelCatalogEntry, ModelPricing } from '../types'

const CATALOG_UPDATED_AT = '2026-05-30'

const MINIMAX_AGENT_ABILITIES: ModelAbilities = {
  tools: 'supported',
  vision: 'unsupported',
  video: 'unsupported',
  reasoning: 'supported',
  fileInput: 'unknown',
  imageOutput: 'unsupported',
}

const MINIMAX_VISION_ABILITIES: ModelAbilities = {
  ...MINIMAX_AGENT_ABILITIES,
  reasoning: 'unknown',
  vision: 'supported',
}

function cnyPricing(input: number, output: number, cacheRead?: number, cacheWrite?: number): ModelPricing {
  return {
    currency: 'CNY',
    inputPerMillion: input,
    outputPerMillion: output,
    cacheReadPerMillion: cacheRead,
    cacheWritePerMillion: cacheWrite,
  }
}

function minimaxModel(input: Omit<ModelCatalogEntry, 'provider' | 'abilities' | 'iconKey' | 'source' | 'catalogUpdatedAt'> & {
  abilities?: ModelAbilities
}): ModelCatalogEntry {
  const aliases = [
    `minimax/${input.id}`,
    ...(input.aliases ?? []),
  ]

  return {
    provider: 'minimax',
    abilities: input.abilities ?? MINIMAX_AGENT_ABILITIES,
    iconKey: 'minimax',
    source: 'builtin',
    catalogUpdatedAt: CATALOG_UPDATED_AT,
    ...input,
    aliases,
  }
}

export const MINIMAX_MODELS: ModelCatalogEntry[] = [
  minimaxModel({
    id: 'MiniMax-M2.7',
    displayName: 'MiniMax M2.7',
    aliases: ['minimax-m2.7'],
    contextWindowTokens: 204800,
    maxOutputTokens: 131072,
    releasedAt: '2026-03-18',
    pricing: cnyPricing(2.1, 8.4, 0.42, 2.625),
  }),
  minimaxModel({
    id: 'MiniMax-M2.7-highspeed',
    displayName: 'MiniMax M2.7 Highspeed',
    aliases: ['minimax-m2.7-highspeed'],
    contextWindowTokens: 204800,
    maxOutputTokens: 131072,
    releasedAt: '2026-03-18',
    pricing: cnyPricing(4.2, 16.8, 0.42, 2.625),
  }),
  minimaxModel({
    id: 'MiniMax-M2.5',
    displayName: 'MiniMax M2.5',
    aliases: ['minimax-m2.5'],
    contextWindowTokens: 204800,
    maxOutputTokens: 131072,
    releasedAt: '2026-02-12',
    pricing: cnyPricing(2.1, 8.4, 0.21, 2.625),
  }),
  minimaxModel({
    id: 'MiniMax-M2.5-highspeed',
    displayName: 'MiniMax M2.5 Highspeed',
    aliases: ['minimax-m2.5-highspeed'],
    contextWindowTokens: 204800,
    maxOutputTokens: 131072,
    releasedAt: '2026-02-12',
    pricing: cnyPricing(4.2, 16.8, 0.21, 2.625),
  }),
  minimaxModel({
    id: 'MiniMax-M2.1',
    displayName: 'MiniMax M2.1',
    aliases: ['minimax-m2.1'],
    contextWindowTokens: 204800,
    maxOutputTokens: 131072,
    releasedAt: '2025-12-23',
    pricing: cnyPricing(2.1, 8.4, 0.21, 2.625),
  }),
  minimaxModel({
    id: 'MiniMax-M2',
    displayName: 'MiniMax M2',
    aliases: ['minimax-m2'],
    contextWindowTokens: 204800,
    maxOutputTokens: 131072,
    releasedAt: '2025-10-27',
    pricing: cnyPricing(2.1, 8.4, 0.21, 2.625),
  }),
  minimaxModel({
    id: 'MiniMax-M1',
    displayName: 'MiniMax M1',
    aliases: ['minimax-m1'],
    contextWindowTokens: 1000192,
    maxOutputTokens: 40000,
    releasedAt: '2025-06-16',
    pricing: cnyPricing(1.2, 16),
  }),
  minimaxModel({
    id: 'MiniMax-Text-01',
    displayName: 'MiniMax Text 01',
    aliases: ['minimax-text-01'],
    contextWindowTokens: 1000192,
    maxOutputTokens: 40000,
    releasedAt: '2025-01-15',
    abilities: MINIMAX_VISION_ABILITIES,
    pricing: cnyPricing(1, 8),
  }),
]
