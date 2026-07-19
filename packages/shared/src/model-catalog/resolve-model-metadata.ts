import type { ModelCapabilitiesOverride, ModelMetadataOverride, ProviderType } from '../types/channel'
import type {
  AbilityStatus,
  ModelAbilities,
  ModelMetadata,
  ModelPricing,
  ResolvedModelMetadata,
} from './types'
import type { ExtraCapabilities } from './extra-capabilities'
import type { ProviderDbModel } from './provider-db'
import { cloneExtraCapabilities } from './extra-capabilities'
import { lookupModel } from './catalog'

export interface ResolveModelMetadataInput {
  channelProvider: string
  channelBaseUrl: string
  modelId: string
  modelName?: string
  metadataOverride?: ModelMetadataOverride
  /** @deprecated 兼容旧 ChannelModel.capabilities */
  capabilitiesOverride?: ModelCapabilitiesOverride
  /**
   * Provider DB 命中的模型记录（由调用方注入）。
   *
   * 设置后优先级最高：DB > builtin > provider rule > fallback。
   * extra_capabilities.reasoning 画像也从此字段透传到 ResolvedModelMetadata。
   */
  providerDbEntry?: ProviderDbModel
}

const OPENAI_COMPATIBLE_PROVIDERS = new Set<ProviderType | string>([
  'openai',
  'deepseek',
  'moonshot',
  'zhipu',
  'minimax',
  'doubao',
  'qwen',
  'custom',
])

const UNKNOWN_ABILITIES: ModelAbilities = {
  tools: 'unknown',
  vision: 'unknown',
  video: 'unknown',
  reasoning: 'unknown',
  fileInput: 'unknown',
  imageOutput: 'unknown',
}

function statusFromBoolean(value: boolean | undefined): AbilityStatus | undefined {
  if (value === undefined) return undefined
  return value ? 'supported' : 'unsupported'
}

export function capabilitiesToMetadataOverride(
  capabilities?: ModelCapabilitiesOverride,
): ModelMetadataOverride | undefined {
  if (!capabilities) return undefined

  const abilities: Partial<ModelAbilities> = {
    vision: statusFromBoolean(capabilities.supportsVision),
    reasoning: statusFromBoolean(capabilities.supportsThinking),
    tools: statusFromBoolean(capabilities.supportsTools),
  }
  const compactAbilities = Object.fromEntries(
    Object.entries(abilities).filter(([, value]) => value !== undefined),
  ) as Partial<ModelAbilities>

  if (Object.keys(compactAbilities).length === 0) return undefined
  return { abilities: compactAbilities }
}

export function mergeModelMetadataOverride(
  newer?: ModelMetadataOverride,
  legacy?: ModelMetadataOverride,
): ModelMetadataOverride | undefined {
  if (!newer && !legacy) return undefined

  const merged: ModelMetadataOverride = {
    ...legacy,
    ...newer,
    abilities: {
      ...(legacy?.abilities ?? {}),
      ...(newer?.abilities ?? {}),
    },
    pricing: {
      ...(legacy?.pricing ?? {}),
      ...(newer?.pricing ?? {}),
    },
  }

  if (Object.keys(merged.abilities ?? {}).length === 0) {
    delete merged.abilities
  }
  if (Object.keys(merged.pricing ?? {}).length === 0) {
    delete merged.pricing
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

export function normalizeModelMetadataOverride(
  metadataOverride?: ModelMetadataOverride,
  capabilitiesOverride?: ModelCapabilitiesOverride,
): ModelMetadataOverride | undefined {
  return mergeModelMetadataOverride(
    metadataOverride,
    capabilitiesToMetadataOverride(capabilitiesOverride),
  )
}

function normalizedModelName(input: ResolveModelMetadataInput): string {
  return `${input.modelId} ${input.modelName ?? ''}`.trim().toLowerCase()
}

export type CapabilityProvider = 'anthropic' | 'google' | 'openai'

export function mapChannelProviderToPiProvider(channelProvider: string): CapabilityProvider | null {
  if (channelProvider === 'anthropic') return 'anthropic'
  if (channelProvider === 'google') return 'google'
  if (OPENAI_COMPATIBLE_PROVIDERS.has(channelProvider)) return 'openai'
  return null
}

function providerRuleMetadata(input: ResolveModelMetadataInput): Partial<ModelMetadata> {
  const modelName = normalizedModelName(input)

  if (modelName.includes('claude')) {
    return {
      provider: 'anthropic',
      contextWindowTokens: 200000,
      abilities: {
        tools: 'supported',
        reasoning: /claude[- ](opus|sonnet|haiku).*[- ]4|4[.-]/.test(modelName) ? 'supported' : 'unsupported',
        vision: 'supported',
        video: 'unsupported',
        fileInput: 'supported',
        imageOutput: 'unsupported',
      },
    }
  }

  if (modelName.includes('gemini')) {
    return {
      provider: 'google',
      contextWindowTokens: modelName.includes('1.5') || modelName.includes('2.5') ? 1000000 : 128000,
      abilities: {
        tools: 'supported',
        reasoning: /gemini[- ](2\.5|3)|thinking/.test(modelName) ? 'supported' : 'unsupported',
        vision: 'supported',
        video: 'supported',
        fileInput: 'supported',
        imageOutput: 'unknown',
      },
    }
  }

  if (modelName.includes('gpt-5')) {
    return {
      provider: 'openai',
      contextWindowTokens: 400000,
      abilities: {
        tools: 'supported',
        reasoning: 'supported',
        vision: 'supported',
        video: 'unsupported',
        fileInput: 'supported',
        imageOutput: 'unsupported',
      },
    }
  }

  if (modelName.includes('gpt-image')) {
    return {
      provider: 'openai',
      contextWindowTokens: 128000,
      abilities: {
        tools: 'unsupported',
        reasoning: 'unsupported',
        vision: 'supported',
        video: 'unsupported',
        fileInput: 'supported',
        imageOutput: 'supported',
      },
    }
  }

  if (/\bo[134]\b|o[134][.-]/.test(modelName)) {
    return {
      provider: 'openai',
      contextWindowTokens: 200000,
      abilities: {
        tools: 'supported',
        reasoning: 'supported',
        vision: modelName.includes('o1-preview') ? 'unsupported' : 'supported',
        video: 'unsupported',
        fileInput: 'supported',
        imageOutput: 'unsupported',
      },
    }
  }

  if (modelName.includes('gpt-4.1')) {
    return {
      provider: 'openai',
      contextWindowTokens: 1047576,
      abilities: {
        tools: 'supported',
        reasoning: 'unsupported',
        vision: 'supported',
        video: 'unsupported',
        fileInput: 'supported',
        imageOutput: 'unsupported',
      },
    }
  }

  if (modelName.includes('gpt-4o')) {
    return {
      provider: 'openai',
      contextWindowTokens: 128000,
      abilities: {
        tools: 'supported',
        reasoning: 'unsupported',
        vision: 'supported',
        video: 'unsupported',
        fileInput: 'supported',
        imageOutput: 'unsupported',
      },
    }
  }

  if (modelName.includes('gpt-4') || modelName.includes('gpt-3.5')) {
    return {
      provider: 'openai',
      contextWindowTokens: modelName.includes('32k') ? 32768 : 128000,
      abilities: {
        tools: 'supported',
        reasoning: 'unsupported',
        vision: modelName.includes('vision') || modelName.includes('turbo') ? 'supported' : 'unsupported',
        video: 'unsupported',
        fileInput: 'supported',
        imageOutput: 'unsupported',
      },
    }
  }

  if (modelName.includes('glm-')) {
    const isVision = /glm-[\w.-]*v|cog/.test(modelName)
    const isModernAgent = /glm-(5|4[.](5|6|7))/.test(modelName)
    return {
      provider: 'zhipu',
      contextWindowTokens: isVision ? 131072 : isModernAgent ? 200000 : 128000,
      abilities: {
        tools: 'supported',
        reasoning: isModernAgent ? 'supported' : 'unknown',
        vision: isVision ? 'supported' : 'unsupported',
        video: isVision ? 'supported' : 'unsupported',
        fileInput: 'unknown',
        imageOutput: 'unsupported',
      },
    }
  }

  if (modelName.includes('mimo-')) {
    const isOmni = modelName.includes('omni') || modelName.includes('v2.5')
    return {
      provider: 'minimax',
      contextWindowTokens: modelName.includes('v2.5') || modelName.includes('v2-pro') ? 1000000 : 262144,
      abilities: {
        tools: 'supported',
        reasoning: 'supported',
        vision: isOmni ? 'supported' : 'unsupported',
        video: isOmni ? 'supported' : 'unsupported',
        fileInput: 'unknown',
        imageOutput: 'unsupported',
      },
    }
  }

  if (modelName.includes('minimax-')) {
    return {
      provider: 'minimax',
      contextWindowTokens: modelName.includes('m1') || modelName.includes('text-01') ? 1000192 : 204800,
      abilities: {
        tools: 'supported',
        reasoning: 'supported',
        vision: modelName.includes('text-01') ? 'supported' : 'unsupported',
        video: 'unsupported',
        fileInput: 'unknown',
        imageOutput: 'unsupported',
      },
    }
  }

  return {}
}

function mergeAbilities(base: ModelAbilities, override?: Partial<ModelAbilities>): ModelAbilities {
  return {
    ...base,
    ...(override ?? {}),
  }
}

function mergePricing(base: ModelPricing | undefined, override: Partial<ModelPricing> | undefined): ModelPricing | undefined {
  if (!base && !override) return undefined
  const merged = {
    ...(base ?? {}),
    ...(override ?? {}),
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

function hasAbilityOverride(override?: ModelMetadataOverride): boolean {
  return Object.keys(override?.abilities ?? {}).length > 0
}

function hasPricingOverride(override?: ModelMetadataOverride): boolean {
  return Object.keys(override?.pricing ?? {}).length > 0
}

/**
 * 把 Provider DB 的模型记录转换为 ModelMetadata 片段。
 *
 * 用于 resolveModelMetadata 注入：当 channel 引用了 capabilityProviderId 时，
 * 调用方先查 Provider DB，命中后调用此函数转成 metadata 注入。
 */
export function providerDbModelToMetadata(
  providerId: string,
  model: ProviderDbModel,
): ModelMetadata {
  const reasoning = model.reasoning
  const abilities: ModelAbilities = {
    tools: model.tool_call ? 'supported' : 'unknown',
    vision:
      model.modalities?.input?.some((m) => m === 'image' || m === 'image/png' || m === 'image/jpeg')
        ? 'supported'
        : 'unknown',
    video:
      model.modalities?.input?.some((m) => m === 'video')
        ? 'supported'
        : 'unknown',
    reasoning:
      reasoning?.supported === true
        ? 'supported'
        : reasoning?.supported === false
          ? 'unsupported'
          : 'unknown',
    fileInput: model.attachment ? 'supported' : 'unknown',
    imageOutput:
      model.modalities?.output?.some((m) => m === 'image')
        ? 'supported'
        : 'unknown',
  }

  const pricing: ModelPricing | undefined = model.cost
    ? {
        inputPerMillionUsd: model.cost.input,
        outputPerMillionUsd: model.cost.output,
        cacheReadPerMillionUsd: model.cost.cache_read,
        cacheWritePerMillionUsd: model.cost.cache_write,
      }
    : undefined

  const extraCapabilities: ExtraCapabilities | undefined = model.extra_capabilities
    ? cloneExtraCapabilities(model.extra_capabilities)
    : undefined

  return {
    provider: providerId,
    id: model.id,
    displayName: model.display_name ?? model.name ?? model.id,
    releasedAt: model.release_date,
    contextWindowTokens: model.limit?.context,
    maxOutputTokens: model.limit?.output,
    abilities,
    pricing,
    source: 'builtin',
    catalogUpdatedAt: model.last_updated,
    extraCapabilities,
  }
}

export function resolveModelMetadata(input: ResolveModelMetadataInput): ResolvedModelMetadata {
  const metadataOverride = normalizeModelMetadataOverride(input.metadataOverride, input.capabilitiesOverride)
  const builtin = lookupModel(input.channelProvider, input.modelId, input.modelName)
  const providerRule = providerRuleMetadata(input)

  // Provider DB 优先级最高，builtin 次之，最后回退到 provider 规则
  const dbEntry = input.providerDbEntry
    ? providerDbModelToMetadata(input.channelProvider, input.providerDbEntry)
    : undefined

  const base: ModelMetadata = dbEntry ?? builtin ?? {
    provider: providerRule.provider ?? input.channelProvider,
    id: input.modelId,
    displayName: input.modelName ?? input.modelId,
    contextWindowTokens: providerRule.contextWindowTokens,
    abilities: providerRule.abilities ?? UNKNOWN_ABILITIES,
    source: 'builtin',
  }

  const contextSource = metadataOverride?.contextWindowTokens !== undefined
    ? 'manual'
    : base.contextWindowTokens !== undefined
      ? dbEntry
        ? 'builtin'
        : builtin
          ? 'builtin'
          : 'provider-rule'
      : 'fallback'

  const abilitiesSource = hasAbilityOverride(metadataOverride)
    ? 'manual'
    : dbEntry
      ? 'builtin'
      : builtin
        ? 'builtin'
        : providerRule.abilities
          ? 'provider-rule'
          : 'fallback'

  const pricingSource = hasPricingOverride(metadataOverride)
    ? 'manual'
    : dbEntry?.pricing
      ? 'builtin'
      : builtin?.pricing
        ? 'builtin'
        : 'none'

  return {
    ...base,
    contextWindowTokens: metadataOverride?.contextWindowTokens ?? base.contextWindowTokens,
    maxOutputTokens: metadataOverride?.maxOutputTokens ?? base.maxOutputTokens,
    abilities: mergeAbilities(base.abilities, metadataOverride?.abilities),
    pricing: mergePricing(base.pricing, metadataOverride?.pricing),
    source: metadataOverride ? 'manual' : base.source,
    resolutionSources: {
      contextWindow: contextSource,
      abilities: abilitiesSource,
      pricing: pricingSource,
    },
  }
}
