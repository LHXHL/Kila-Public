import type { Api, Model } from '@earendil-works/pi-ai'
import type { BuiltinProvider } from '@earendil-works/pi-ai/providers/all'
import type { Channel } from '@kila/shared'
import { loadExternalEsm } from './external-esm-loader'

type PiAiCompatModule = typeof import('@earendil-works/pi-ai/compat')

export interface ModelCost {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface TokenUsageCostInput {
  channelProvider?: string
  channelBaseUrl?: string
  modelId: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
}

const ZERO_MODEL_COST: ModelCost = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
}

let piAiCompatModulePromise: Promise<PiAiCompatModule> | undefined

function loadPiAiCompat(): Promise<PiAiCompatModule> {
  piAiCompatModulePromise ??= loadExternalEsm<PiAiCompatModule>('@earendil-works/pi-ai/compat')
  return piAiCompatModulePromise
}

function hasNonZeroCost(cost: ModelCost | undefined): cost is ModelCost {
  return Boolean(cost && (cost.input > 0 || cost.output > 0 || cost.cacheRead > 0 || cost.cacheWrite > 0))
}

function normalizeModelKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^models\//, '')
    .replace(/[_\s]+/g, '-')
}

function isOpenRouterBaseUrl(baseUrl?: string): boolean {
  return Boolean(baseUrl && /openrouter\.ai/i.test(baseUrl))
}

function isZaiBaseUrl(baseUrl?: string): boolean {
  return Boolean(baseUrl && /(z\.ai|bigmodel\.cn|zhipuai\.cn)/i.test(baseUrl))
}

function isMiniMaxBaseUrl(baseUrl?: string): boolean {
  return Boolean(baseUrl && /minimax/i.test(baseUrl))
}

function isMoonshotBaseUrl(baseUrl?: string): boolean {
  return Boolean(baseUrl && /moonshot|kimi/i.test(baseUrl))
}

function inferProviderCandidates(channelProvider?: string, baseUrl?: string, modelId?: string): string[] {
  const candidates: string[] = []
  const normalizedProvider = channelProvider?.trim()
  const normalizedModel = normalizeModelKey(modelId ?? '')

  if (isOpenRouterBaseUrl(baseUrl)) candidates.push('openrouter')
  if (isZaiBaseUrl(baseUrl)) candidates.push('zai', 'openrouter', 'vercel-ai-gateway')
  if (isMiniMaxBaseUrl(baseUrl)) candidates.push('minimax-cn', 'minimax', 'openrouter', 'vercel-ai-gateway')
  if (isMoonshotBaseUrl(baseUrl)) candidates.push('kimi-coding', 'openrouter', 'vercel-ai-gateway')

  switch (normalizedProvider) {
    case 'anthropic':
    case 'openai':
    case 'google':
      candidates.push(normalizedProvider)
      break
    case 'zhipu':
      candidates.push('zai', 'openrouter', 'vercel-ai-gateway')
      break
    case 'minimax':
      candidates.push('minimax-cn', 'minimax', 'openrouter', 'vercel-ai-gateway')
      break
    case 'moonshot':
      candidates.push('kimi-coding', 'openrouter', 'vercel-ai-gateway')
      break
    case 'deepseek':
    case 'doubao':
    case 'qwen':
    case 'custom':
      candidates.push('openrouter', 'vercel-ai-gateway')
      break
  }

  if (normalizedModel.startsWith('glm-')) {
    candidates.push('zai', 'openrouter', 'vercel-ai-gateway')
  }
  if (normalizedModel.includes('minimax') || normalizedModel.includes('mimo')) {
    candidates.push('minimax-cn', 'minimax', 'openrouter', 'vercel-ai-gateway', 'opencode-go', 'huggingface')
  }
  if (normalizedModel.includes('kimi') || normalizedModel.includes('moonshot')) {
    candidates.push('kimi-coding', 'openrouter', 'vercel-ai-gateway')
  }
  if (normalizedModel.includes('deepseek')) {
    candidates.push('openrouter', 'vercel-ai-gateway')
  }

  return Array.from(new Set(candidates))
}

function modelIdCandidates(modelId: string): string[] {
  const normalized = normalizeModelKey(modelId)
  const candidates = new Set<string>([
    modelId,
    modelId.trim(),
    normalized,
  ])

  if (normalized.startsWith('glm-')) {
    candidates.add(`z-ai/${normalized}`)
    candidates.add(`zai/${normalized}`)
  }
  if (normalized.includes('minimax')) {
    candidates.add(`minimax/${normalized}`)
  }
  if (normalized.includes('mimo')) {
    candidates.add(`xiaomi/${normalized}`)
    candidates.add(normalized.replace('v2.5', 'v2-pro'))
    candidates.add(`xiaomi/${normalized.replace('v2.5', 'v2-pro')}`)
  }
  if (normalized.includes('kimi')) {
    candidates.add(`moonshotai/${normalized}`)
  }
  if (normalized.includes('deepseek')) {
    candidates.add(`deepseek/${normalized}`)
  }

  return Array.from(candidates).filter(Boolean)
}

function fallbackCostForModel(modelId: string): ModelCost | undefined {
  const normalized = normalizeModelKey(modelId)
  const explicit: Record<string, ModelCost> = {
    'glm-5': { input: 0.6, output: 1.9, cacheRead: 0.119, cacheWrite: 0 },
    'glm-5-turbo': { input: 1.2, output: 4, cacheRead: 0.24, cacheWrite: 0 },
    'glm-5.1': { input: 0.95, output: 3.15, cacheRead: 0.475, cacheWrite: 0 },
    'minimax-m2.5': { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0.375 },
    'mimo-v2.5': { input: 1, output: 3, cacheRead: 0.2, cacheWrite: 0 },
  }
  return explicit[normalized]
}

function calculateCostUsd(cost: ModelCost, usage: Omit<TokenUsageCostInput, 'channelProvider' | 'channelBaseUrl' | 'modelId'>): number {
  return (
    (cost.input / 1_000_000) * usage.inputTokens
    + (cost.output / 1_000_000) * usage.outputTokens
    + (cost.cacheRead / 1_000_000) * (usage.cacheReadTokens ?? 0)
    + (cost.cacheWrite / 1_000_000) * (usage.cacheCreationTokens ?? 0)
  )
}

function getSyncModelCost(input: Pick<TokenUsageCostInput, 'modelId'>): ModelCost {
  return fallbackCostForModel(input.modelId) ?? ZERO_MODEL_COST
}

export function estimateTokenUsageCostUsd(input: TokenUsageCostInput): number {
  const cost = getSyncModelCost(input)
  if (!hasNonZeroCost(cost)) return 0
  return calculateCostUsd(cost, input)
}

export async function resolveModelCost(channel: Pick<Channel, 'provider' | 'baseUrl'>, modelId: string): Promise<ModelCost> {
  const piAi = await loadPiAiCompat()
  const providers = inferProviderCandidates(channel.provider, channel.baseUrl, modelId)
  const ids = modelIdCandidates(modelId)

  for (const provider of providers) {
    for (const id of ids) {
      const model = piAi.getModel(provider as BuiltinProvider, id as never) as Model<Api> | undefined
      if (hasNonZeroCost(model?.cost)) return model.cost
    }
  }

  for (const provider of providers) {
    const knownModels = piAi.getModels(provider as BuiltinProvider) as Model<Api>[]
    for (const candidateId of ids.map(normalizeModelKey)) {
      const model = knownModels.find((entry) => normalizeModelKey(entry.id) === candidateId)
      if (hasNonZeroCost(model?.cost)) return model.cost
    }
  }

  const fallback = fallbackCostForModel(modelId)
  if (fallback) return fallback

  return ZERO_MODEL_COST
}
