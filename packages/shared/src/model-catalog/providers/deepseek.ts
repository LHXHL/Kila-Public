import type { ModelAbilities, ModelCatalogEntry } from '../types'

const DEEPSEEK_CHAT_ABILITIES: ModelAbilities = {
  tools: 'supported',
  vision: 'unsupported',
  video: 'unsupported',
  reasoning: 'unsupported',
  fileInput: 'unknown',
  imageOutput: 'unsupported',
}

const DEEPSEEK_REASONER_ABILITIES: ModelAbilities = {
  ...DEEPSEEK_CHAT_ABILITIES,
  reasoning: 'supported',
}

export const DEEPSEEK_MODELS: ModelCatalogEntry[] = [
  {
    provider: 'deepseek',
    id: 'deepseek-chat',
    displayName: 'DeepSeek Chat',
    aliases: ['deepseek-v3', 'deepseek-v3.2'],
    contextWindowTokens: 64000,
    abilities: DEEPSEEK_CHAT_ABILITIES,
    pricing: {
      inputPerMillionUsd: 0.27,
      outputPerMillionUsd: 1.1,
      cacheReadPerMillionUsd: 0.07,
    },
    iconKey: 'deepseek',
    source: 'builtin',
    catalogUpdatedAt: '2026-05-30',
  },
  {
    provider: 'deepseek',
    id: 'deepseek-reasoner',
    displayName: 'DeepSeek Reasoner',
    aliases: ['deepseek-r1'],
    contextWindowTokens: 64000,
    abilities: DEEPSEEK_REASONER_ABILITIES,
    pricing: {
      inputPerMillionUsd: 0.55,
      outputPerMillionUsd: 2.19,
      cacheReadPerMillionUsd: 0.14,
    },
    iconKey: 'deepseek',
    source: 'builtin',
    catalogUpdatedAt: '2026-05-30',
  },
]
