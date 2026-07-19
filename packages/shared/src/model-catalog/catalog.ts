import { BUILTIN_MODEL_CATALOG } from './providers'
import type { ModelCatalogEntry } from './types'

function normalizeModelKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^models\//, '')
    .replace(/[\s_]+/g, '-')
}

function expandModelKeyVariants(value: string): string[] {
  const normalized = normalizeModelKey(value)
  const variants = new Set<string>([normalized])
  const slashParts = normalized.split('/').filter(Boolean)
  const lastPart = slashParts.at(-1)

  if (lastPart) {
    variants.add(lastPart)
  }

  for (const variant of [...variants]) {
    const colonIndex = variant.indexOf(':')
    if (colonIndex > 0) {
      variants.add(variant.slice(0, colonIndex))
    }
  }

  return [...variants]
}

function modelKeys(entry: ModelCatalogEntry): string[] {
  return [entry.id, entry.displayName, ...(entry.aliases ?? [])].flatMap(expandModelKeyVariants)
}

function providerMatches(entry: ModelCatalogEntry, provider: string): boolean {
  const normalizedProvider = provider.trim().toLowerCase()
  if (!normalizedProvider || normalizedProvider === 'custom') return true
  return entry.provider === normalizedProvider
}

export function getAllModels(): ModelCatalogEntry[] {
  return [...BUILTIN_MODEL_CATALOG]
}

export function matchModelById(
  modelId: string,
  options?: { provider?: string; modelName?: string },
): ModelCatalogEntry | undefined {
  const targetKeys = [
    modelId,
    options?.modelName,
  ].filter((value): value is string => Boolean(value?.trim())).flatMap(expandModelKeyVariants)

  return BUILTIN_MODEL_CATALOG.find((entry) => {
    if (options?.provider && !providerMatches(entry, options.provider)) return false
    const keys = modelKeys(entry)
    return targetKeys.some((target) => keys.includes(target))
  })
}

export function lookupModel(
  provider: string,
  modelId: string,
  modelName?: string,
): ModelCatalogEntry | undefined {
  return matchModelById(modelId, { provider, modelName })
    ?? matchModelById(modelId, { modelName })
}
