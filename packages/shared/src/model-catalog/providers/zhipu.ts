import type { ModelAbilities, ModelCatalogEntry, ModelPricing } from '../types'

const CATALOG_UPDATED_AT = '2026-05-30'

const GLM_AGENT_ABILITIES: ModelAbilities = {
  tools: 'supported',
  vision: 'unsupported',
  video: 'unsupported',
  reasoning: 'supported',
  fileInput: 'unknown',
  imageOutput: 'unsupported',
}

const GLM_VISION_ABILITIES: ModelAbilities = {
  ...GLM_AGENT_ABILITIES,
  vision: 'supported',
  video: 'supported',
}

const GLM_LEGACY_ABILITIES: ModelAbilities = {
  ...GLM_AGENT_ABILITIES,
  reasoning: 'unknown',
}

function cnyPricing(input: number, output: number, cacheRead?: number): ModelPricing {
  return {
    currency: 'CNY',
    inputPerMillion: input,
    outputPerMillion: output,
    cacheReadPerMillion: cacheRead,
  }
}

function zhipuModel(input: Omit<ModelCatalogEntry, 'provider' | 'abilities' | 'iconKey' | 'source' | 'catalogUpdatedAt'> & {
  abilities?: ModelAbilities
}): ModelCatalogEntry {
  const aliases = [
    `zhipu/${input.id}`,
    `bigmodel/${input.id}`,
    `z-ai/${input.id}`,
    `zai-org/${input.id}`,
    ...(input.aliases ?? []),
  ]

  return {
    provider: 'zhipu',
    abilities: input.abilities ?? GLM_AGENT_ABILITIES,
    iconKey: 'zhipu',
    source: 'builtin',
    catalogUpdatedAt: CATALOG_UPDATED_AT,
    ...input,
    aliases,
  }
}

export const ZHIPU_MODELS: ModelCatalogEntry[] = [
  zhipuModel({
    id: 'glm-5.1',
    displayName: 'GLM-5.1',
    contextWindowTokens: 200000,
    maxOutputTokens: 131072,
    releasedAt: '2026-03-27',
    pricing: cnyPricing(6, 24, 1.3),
  }),
  zhipuModel({
    id: 'glm-5-turbo',
    displayName: 'GLM-5-Turbo',
    contextWindowTokens: 200000,
    maxOutputTokens: 131072,
    releasedAt: '2026-03-15',
    pricing: cnyPricing(5, 22, 1.2),
  }),
  zhipuModel({
    id: 'glm-5',
    displayName: 'GLM-5',
    contextWindowTokens: 200000,
    maxOutputTokens: 131072,
    releasedAt: '2026-02-12',
    pricing: cnyPricing(4, 18, 1),
  }),
  zhipuModel({
    id: 'glm-5v-turbo',
    displayName: 'GLM-5V-Turbo',
    contextWindowTokens: 200000,
    maxOutputTokens: 131072,
    releasedAt: '2026-04-02',
    abilities: GLM_VISION_ABILITIES,
    pricing: cnyPricing(5, 22, 1.2),
  }),
  zhipuModel({
    id: 'glm-4.7',
    displayName: 'GLM-4.7',
    contextWindowTokens: 200000,
    maxOutputTokens: 131072,
    releasedAt: '2025-12-22',
    pricing: cnyPricing(2, 8, 0.4),
  }),
  zhipuModel({
    id: 'glm-4.7-flash',
    displayName: 'GLM-4.7-Flash',
    contextWindowTokens: 200000,
    maxOutputTokens: 131072,
    releasedAt: '2026-01-19',
    pricing: cnyPricing(0, 0, 0),
  }),
  zhipuModel({
    id: 'glm-4.7-flashx',
    displayName: 'GLM-4.7-FlashX',
    contextWindowTokens: 200000,
    maxOutputTokens: 131072,
    releasedAt: '2026-01-19',
    pricing: cnyPricing(0.5, 3, 0.1),
  }),
  zhipuModel({
    id: 'glm-4.6',
    displayName: 'GLM-4.6',
    contextWindowTokens: 200000,
    maxOutputTokens: 131072,
    releasedAt: '2025-09-08',
    pricing: cnyPricing(2, 8, 0.4),
  }),
  zhipuModel({
    id: 'glm-4.6v',
    displayName: 'GLM-4.6V',
    contextWindowTokens: 131072,
    maxOutputTokens: 32768,
    releasedAt: '2025-12-08',
    abilities: GLM_VISION_ABILITIES,
    pricing: cnyPricing(1, 3, 0.2),
  }),
  zhipuModel({
    id: 'glm-4.6v-flash',
    displayName: 'GLM-4.6V-Flash',
    contextWindowTokens: 131072,
    maxOutputTokens: 32768,
    releasedAt: '2025-12-08',
    abilities: GLM_VISION_ABILITIES,
    pricing: cnyPricing(0, 0, 0),
  }),
  zhipuModel({
    id: 'glm-4.6v-flashx',
    displayName: 'GLM-4.6V-FlashX',
    contextWindowTokens: 131072,
    maxOutputTokens: 32768,
    releasedAt: '2025-12-08',
    abilities: GLM_VISION_ABILITIES,
    pricing: cnyPricing(0.15, 1.5, 0.03),
  }),
  zhipuModel({
    id: 'glm-4.5',
    displayName: 'GLM-4.5',
    contextWindowTokens: 128000,
    maxOutputTokens: 32768,
    pricing: cnyPricing(4, 16, 0.8),
  }),
  zhipuModel({
    id: 'glm-4.5-x',
    displayName: 'GLM-4.5-X',
    contextWindowTokens: 128000,
    maxOutputTokens: 32768,
    pricing: cnyPricing(16, 64, 3.2),
  }),
  zhipuModel({
    id: 'glm-4.5-air',
    displayName: 'GLM-4.5-Air',
    contextWindowTokens: 128000,
    maxOutputTokens: 32768,
    pricing: cnyPricing(1.2, 8, 0.24),
  }),
  zhipuModel({
    id: 'glm-4.5-airx',
    displayName: 'GLM-4.5-AirX',
    contextWindowTokens: 128000,
    maxOutputTokens: 32768,
    pricing: cnyPricing(8, 32, 1.6),
  }),
  zhipuModel({
    id: 'glm-4.5-flash',
    displayName: 'GLM-4.5-Flash',
    contextWindowTokens: 128000,
    maxOutputTokens: 32768,
    pricing: cnyPricing(0, 0, 0),
  }),
  zhipuModel({
    id: 'glm-4.5v',
    displayName: 'GLM-4.5V',
    contextWindowTokens: 65536,
    maxOutputTokens: 16384,
    abilities: GLM_VISION_ABILITIES,
    pricing: cnyPricing(2, 6, 0.4),
  }),
  zhipuModel({
    id: 'glm-z1-air',
    displayName: 'GLM-Z1-Air',
    contextWindowTokens: 128000,
    maxOutputTokens: 32768,
    abilities: GLM_LEGACY_ABILITIES,
    pricing: cnyPricing(0.5, 0.5),
  }),
  zhipuModel({
    id: 'glm-z1-airx',
    displayName: 'GLM-Z1-AirX',
    contextWindowTokens: 32768,
    maxOutputTokens: 30000,
    abilities: GLM_LEGACY_ABILITIES,
    pricing: cnyPricing(5, 5),
  }),
  zhipuModel({
    id: 'glm-z1-flash',
    displayName: 'GLM-Z1-Flash',
    contextWindowTokens: 128000,
    maxOutputTokens: 32768,
    abilities: GLM_LEGACY_ABILITIES,
    pricing: cnyPricing(0, 0),
  }),
  zhipuModel({
    id: 'glm-z1-flashx',
    displayName: 'GLM-Z1-FlashX',
    contextWindowTokens: 128000,
    maxOutputTokens: 32768,
    abilities: GLM_LEGACY_ABILITIES,
    pricing: cnyPricing(0.1, 0.1),
  }),
  zhipuModel({
    id: 'glm-4-plus',
    displayName: 'GLM-4-Plus',
    contextWindowTokens: 131072,
    maxOutputTokens: 4095,
    abilities: GLM_LEGACY_ABILITIES,
    pricing: cnyPricing(5, 5),
  }),
  zhipuModel({
    id: 'glm-4-air',
    displayName: 'GLM-4-Air',
    contextWindowTokens: 8192,
    maxOutputTokens: 4095,
    abilities: GLM_LEGACY_ABILITIES,
    pricing: cnyPricing(1, 1),
  }),
  zhipuModel({
    id: 'glm-4-airx',
    displayName: 'GLM-4-AirX',
    contextWindowTokens: 8192,
    maxOutputTokens: 4095,
    abilities: GLM_LEGACY_ABILITIES,
    pricing: cnyPricing(10, 10),
  }),
  zhipuModel({
    id: 'glm-4-flash',
    displayName: 'GLM-4-Flash',
    contextWindowTokens: 128000,
    abilities: GLM_LEGACY_ABILITIES,
    pricing: cnyPricing(0, 0),
  }),
  zhipuModel({
    id: 'glm-4v-flash',
    displayName: 'GLM-4V-Flash',
    contextWindowTokens: 4096,
    maxOutputTokens: 1024,
    abilities: GLM_VISION_ABILITIES,
    pricing: cnyPricing(0, 0),
  }),
]
