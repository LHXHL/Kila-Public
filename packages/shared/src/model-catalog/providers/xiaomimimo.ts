import type { ModelAbilities, ModelCatalogEntry, ModelPricing } from '../types'

const CATALOG_UPDATED_AT = '2026-05-30'

const MIMO_AGENT_ABILITIES: ModelAbilities = {
  tools: 'supported',
  vision: 'unsupported',
  video: 'unsupported',
  reasoning: 'supported',
  fileInput: 'unknown',
  imageOutput: 'unsupported',
}

const MIMO_OMNI_ABILITIES: ModelAbilities = {
  ...MIMO_AGENT_ABILITIES,
  vision: 'supported',
  video: 'supported',
}

function cnyPricing(input: number, output: number, cacheRead?: number): ModelPricing {
  return {
    currency: 'CNY',
    inputPerMillion: input,
    outputPerMillion: output,
    cacheReadPerMillion: cacheRead,
  }
}

function mimoModel(input: Omit<ModelCatalogEntry, 'provider' | 'abilities' | 'iconKey' | 'source' | 'catalogUpdatedAt'> & {
  abilities?: ModelAbilities
}): ModelCatalogEntry {
  const aliases = [
    `minimax/${input.id}`,
    `xiaomi/${input.id}`,
    `xiaomimimo/${input.id}`,
    ...(input.aliases ?? []),
  ]

  return {
    provider: 'minimax',
    abilities: input.abilities ?? MIMO_AGENT_ABILITIES,
    iconKey: 'minimax',
    source: 'builtin',
    catalogUpdatedAt: CATALOG_UPDATED_AT,
    ...input,
    aliases,
  }
}

export const XIAOMI_MIMO_MODELS: ModelCatalogEntry[] = [
  mimoModel({
    id: 'mimo-v2.5-pro',
    displayName: 'MiMo-V2.5 Pro',
    contextWindowTokens: 1000000,
    maxOutputTokens: 131072,
    releasedAt: '2026-04-22',
    pricing: cnyPricing(7, 21, 1.4),
  }),
  mimoModel({
    id: 'mimo-v2.5',
    displayName: 'MiMo-V2.5',
    contextWindowTokens: 1000000,
    maxOutputTokens: 131072,
    releasedAt: '2026-04-22',
    abilities: MIMO_OMNI_ABILITIES,
    pricing: cnyPricing(2.8, 14, 0.56),
  }),
  mimoModel({
    id: 'mimo-v2-pro',
    displayName: 'MiMo-V2 Pro',
    aliases: ['mimo-v2-pro'],
    contextWindowTokens: 1000000,
    maxOutputTokens: 131072,
    releasedAt: '2026-03-18',
    pricing: cnyPricing(7, 21, 1.4),
  }),
  mimoModel({
    id: 'mimo-v2-omni',
    displayName: 'MiMo-V2 Omni',
    aliases: ['mimo-v2-omni'],
    contextWindowTokens: 262144,
    maxOutputTokens: 131072,
    releasedAt: '2026-03-18',
    abilities: MIMO_OMNI_ABILITIES,
    pricing: cnyPricing(2.8, 14, 0.56),
  }),
  mimoModel({
    id: 'mimo-v2-flash',
    displayName: 'MiMo-V2 Flash',
    contextWindowTokens: 262144,
    maxOutputTokens: 65536,
    releasedAt: '2026-03-03',
    pricing: cnyPricing(0.7, 2.1, 0.07),
  }),
]
