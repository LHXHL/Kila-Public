import type { ModelAbilities, ModelCatalogEntry } from '../types'

const GEMINI_ABILITIES: ModelAbilities = {
  tools: 'supported',
  vision: 'supported',
  video: 'supported',
  reasoning: 'supported',
  fileInput: 'supported',
  imageOutput: 'unknown',
}

export const GOOGLE_MODELS: ModelCatalogEntry[] = [
  {
    provider: 'google',
    id: 'gemini-2.5-pro',
    displayName: 'Gemini 2.5 Pro',
    contextWindowTokens: 1048576,
    maxOutputTokens: 65536,
    abilities: GEMINI_ABILITIES,
    pricing: {
      inputPerMillionUsd: 1.25,
      outputPerMillionUsd: 10,
    },
    iconKey: 'gemini',
    source: 'builtin',
    catalogUpdatedAt: '2026-05-30',
  },
  {
    provider: 'google',
    id: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    contextWindowTokens: 1048576,
    maxOutputTokens: 65536,
    abilities: GEMINI_ABILITIES,
    pricing: {
      inputPerMillionUsd: 0.3,
      outputPerMillionUsd: 2.5,
    },
    iconKey: 'gemini',
    source: 'builtin',
    catalogUpdatedAt: '2026-05-30',
  },
  {
    provider: 'google',
    id: 'gemini-1.5-pro',
    displayName: 'Gemini 1.5 Pro',
    deprecated: true,
    contextWindowTokens: 1048576,
    maxOutputTokens: 8192,
    abilities: {
      ...GEMINI_ABILITIES,
      reasoning: 'unsupported',
    },
    iconKey: 'gemini',
    source: 'builtin',
    catalogUpdatedAt: '2026-05-30',
  },
]
