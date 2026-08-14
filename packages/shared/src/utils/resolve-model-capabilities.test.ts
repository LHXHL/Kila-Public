import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as sharedUtils from './index'

type ResolveModelCapabilities = (input: {
  channelProvider: string
  channelBaseUrl: string
  modelId: string
  modelName?: string
  metadataOverride?: {
    contextWindowTokens?: number
    abilities?: {
      tools?: 'supported' | 'unsupported' | 'unknown'
      reasoning?: 'supported' | 'unsupported' | 'unknown'
      vision?: 'supported' | 'unsupported' | 'unknown'
    }
    pricing?: {
      currency?: 'USD' | 'CNY'
      inputPerMillion?: number
      outputPerMillion?: number
    }
  }
  capabilitiesOverride?: {
    supportsTools?: boolean
    supportsThinking?: boolean
    supportsVision?: boolean
  }
}) => {
  supportsTools: boolean
  supportsThinking: boolean
  supportsVision: boolean
  contextWindow?: number
  source: 'explicit' | 'builtin' | 'provider-rule' | 'fallback'
}

type ResolveModelMetadata = (input: {
  channelProvider: string
  channelBaseUrl: string
  modelId: string
  modelName?: string
  metadataOverride?: {
    contextWindowTokens?: number
    abilities?: {
      tools?: 'supported' | 'unsupported' | 'unknown'
      reasoning?: 'supported' | 'unsupported' | 'unknown'
      vision?: 'supported' | 'unsupported' | 'unknown'
    }
  }
  capabilitiesOverride?: {
    supportsTools?: boolean
    supportsThinking?: boolean
    supportsVision?: boolean
  }
}) => {
  contextWindowTokens?: number
  pricing?: {
    currency?: 'USD' | 'CNY'
    inputPerMillion?: number
    outputPerMillion?: number
  }
  abilities: {
    tools: 'supported' | 'unsupported' | 'unknown'
    reasoning: 'supported' | 'unsupported' | 'unknown'
    vision: 'supported' | 'unsupported' | 'unknown'
  }
  resolutionSources: {
    contextWindow: 'manual' | 'builtin' | 'provider-rule' | 'fallback'
    abilities: 'manual' | 'builtin' | 'provider-rule' | 'fallback'
    pricing: 'manual' | 'builtin' | 'none'
  }
}

const resolveModelCapabilities = (sharedUtils as typeof sharedUtils & {
  resolveModelCapabilities?: ResolveModelCapabilities
}).resolveModelCapabilities
const resolveModelMetadata = (sharedUtils as typeof sharedUtils & {
  resolveModelMetadata?: ResolveModelMetadata
}).resolveModelMetadata

describe('resolveModelCapabilities', () => {
  test('resolves GPT-5.2 capabilities from browser-safe provider rules', () => {
    expect(typeof resolveModelCapabilities).toBe('function')
    if (typeof resolveModelCapabilities !== 'function') return

    expect(resolveModelCapabilities({
      channelProvider: 'openai',
      channelBaseUrl: 'https://api.openai.com/v1',
      modelId: 'gpt-5.2',
      modelName: 'GPT-5.2',
    })).toEqual({
      supportsTools: true,
      supportsThinking: true,
      supportsVision: true,
      contextWindow: 200000,
      source: 'builtin',
    })
  })

  test('hides unsupported thinking while preserving tool and vision for GPT-4o-mini', () => {
    expect(typeof resolveModelCapabilities).toBe('function')
    if (typeof resolveModelCapabilities !== 'function') return

    expect(resolveModelCapabilities({
      channelProvider: 'openai',
      channelBaseUrl: 'https://api.openai.com/v1',
      modelId: 'gpt-4o-mini',
      modelName: 'GPT-4o mini',
    })).toEqual({
      supportsTools: true,
      supportsThinking: false,
      supportsVision: true,
      contextWindow: 200000,
      source: 'builtin',
    })
  })

  test('infers the default window for unknown custom models', () => {
    expect(typeof resolveModelCapabilities).toBe('function')
    if (typeof resolveModelCapabilities !== 'function') return

    expect(resolveModelCapabilities({
      channelProvider: 'custom',
      channelBaseUrl: 'https://custom.example.com/v1',
      modelId: 'mystery-model',
      modelName: 'Mystery Model',
    })).toEqual({
      supportsTools: false,
      supportsThinking: false,
      supportsVision: false,
      contextWindow: 200000,
      source: 'fallback',
    })
  })

  test('resolves manual metadata override before builtin catalog', () => {
    expect(typeof resolveModelMetadata).toBe('function')
    if (typeof resolveModelMetadata !== 'function') return

    const metadata = resolveModelMetadata({
      channelProvider: 'openai',
      channelBaseUrl: 'https://api.openai.com/v1',
      modelId: 'gpt-4o',
      metadataOverride: {
        contextWindowTokens: 256000,
        abilities: {
          vision: 'unsupported',
        },
      },
    })

    expect(metadata.contextWindowTokens).toBe(256000)
    expect(metadata.abilities.vision).toBe('unsupported')
    expect(metadata.abilities.tools).toBe('supported')
    expect(metadata.resolutionSources.contextWindow).toBe('manual')
    expect(metadata.resolutionSources.abilities).toBe('manual')
  })

  test('maps legacy capability overrides into metadata abilities', () => {
    expect(typeof resolveModelMetadata).toBe('function')
    if (typeof resolveModelMetadata !== 'function') return

    const metadata = resolveModelMetadata({
      channelProvider: 'custom',
      channelBaseUrl: 'https://custom.example.com/v1',
      modelId: 'mystery-model',
      capabilitiesOverride: {
        supportsTools: true,
        supportsThinking: false,
        supportsVision: true,
      },
    })

    expect(metadata.abilities.tools).toBe('supported')
    expect(metadata.abilities.reasoning).toBe('unsupported')
    expect(metadata.abilities.vision).toBe('supported')
    expect(metadata.resolutionSources.abilities).toBe('manual')
  })

  test('resolves Zhipu GLM metadata from builtin model bank data', () => {
    expect(typeof resolveModelMetadata).toBe('function')
    if (typeof resolveModelMetadata !== 'function') return

    const metadata = resolveModelMetadata({
      channelProvider: 'zhipu',
      channelBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      modelId: 'glm-4.5',
    })

    expect(metadata.contextWindowTokens).toBe(200000)
    expect(metadata.abilities.tools).toBe('supported')
    expect(metadata.abilities.reasoning).toBe('supported')
    expect(metadata.pricing?.currency).toBe('CNY')
    expect(metadata.pricing?.inputPerMillion).toBe(4)
    expect(metadata.pricing?.outputPerMillion).toBe(16)
    expect(metadata.resolutionSources.contextWindow).toBe('inference')
    expect(metadata.resolutionSources.pricing).toBe('builtin')
  })

  test('resolves prefixed GLM model ids from aggregator routes', () => {
    expect(typeof resolveModelMetadata).toBe('function')
    if (typeof resolveModelMetadata !== 'function') return

    const metadata = resolveModelMetadata({
      channelProvider: 'custom',
      channelBaseUrl: 'https://openrouter.ai/api/v1',
      modelId: 'zai-org/GLM-4.5-Air',
    })

    expect(metadata.id).toBe('glm-4.5-air')
    expect(metadata.contextWindowTokens).toBe(200000)
    expect(metadata.pricing?.currency).toBe('CNY')
    expect(metadata.pricing?.inputPerMillion).toBe(1.2)
    expect(metadata.pricing?.outputPerMillion).toBe(8)
    expect(metadata.resolutionSources.contextWindow).toBe('inference')
    expect(metadata.resolutionSources.pricing).toBe('builtin')
  })

  test('resolves Xiaomi MiMo metadata from builtin model bank data', () => {
    expect(typeof resolveModelMetadata).toBe('function')
    if (typeof resolveModelMetadata !== 'function') return

    const metadata = resolveModelMetadata({
      channelProvider: 'minimax',
      channelBaseUrl: 'https://api.minimax.chat/v1',
      modelId: 'mimo-v2.5-pro',
    })

    expect(metadata.contextWindowTokens).toBe(1000000)
    expect(metadata.abilities.tools).toBe('supported')
    expect(metadata.abilities.reasoning).toBe('supported')
    expect(metadata.pricing?.currency).toBe('CNY')
    expect(metadata.pricing?.inputPerMillion).toBe(7)
    expect(metadata.pricing?.outputPerMillion).toBe(21)
  })

  test('resolves prefixed MiMo model ids from aggregator routes', () => {
    expect(typeof resolveModelMetadata).toBe('function')
    if (typeof resolveModelMetadata !== 'function') return

    const metadata = resolveModelMetadata({
      channelProvider: 'custom',
      channelBaseUrl: 'https://openrouter.ai/api/v1',
      modelId: 'minimax/mimo-v2.5-pro',
    })

    expect(metadata.id).toBe('mimo-v2.5-pro')
    expect(metadata.contextWindowTokens).toBe(1000000)
    expect(metadata.pricing?.currency).toBe('CNY')
    expect(metadata.pricing?.inputPerMillion).toBe(7)
    expect(metadata.pricing?.outputPerMillion).toBe(21)
    expect(metadata.resolutionSources.contextWindow).toBe('inference')
    expect(metadata.resolutionSources.pricing).toBe('builtin')
  })

  test('stays browser-safe by not importing the Pi runtime package', () => {
    const source = readFileSync(
      resolve(import.meta.dir, 'resolve-model-capabilities.ts'),
      'utf8',
    )

    expect(source).not.toContain('@earendil-works/pi-ai')
  })

})
