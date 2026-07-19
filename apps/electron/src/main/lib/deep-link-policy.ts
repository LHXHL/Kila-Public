import type { ApiType } from '@kila/shared'

const ALLOWED_API_TYPES = new Set<ApiType>([
  'anthropic',
  'openai',
  'openai-responses',
  'google',
  'ollama',
  'custom',
])
const SAFE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]*$/
const MAX_DEEP_LINK_LENGTH = 16_384
const MAX_MODELS = 100

export interface ProviderInstallDeepLink {
  kind: 'provider-install'
  provider: string
  name: string
  baseUrl: string
  apiKey: string
  apiType?: ApiType
  models: string[]
}

export type KilaDeepLink =
  | { kind: 'session'; sessionId: string }
  | { kind: 'settings'; requestedTab: string }
  | ProviderInstallDeepLink

function readBoundedParam(params: URLSearchParams, key: string, maxLength: number): string | null {
  const value = params.get(key)?.trim() ?? ''
  if (value.length > maxLength) return null
  return value
}

function parseHttpUrl(value: string): string | null {
  if (!value) return ''
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (parsed.username || parsed.password) return null
    return parsed.toString()
  } catch {
    return null
  }
}

export function parseKilaDeepLink(rawUrl: string): KilaDeepLink | null {
  if (!rawUrl || rawUrl.length > MAX_DEEP_LINK_LENGTH) return null

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== 'kila:' || parsed.username || parsed.password) return null

  let firstPathSegment = ''
  try {
    firstPathSegment = decodeURIComponent(parsed.pathname.replace(/^\/+/, '').split('/')[0] ?? '')
  } catch {
    return null
  }

  if (parsed.hostname === 'session') {
    if (!firstPathSegment || firstPathSegment.length > 128 || !SAFE_ID_PATTERN.test(firstPathSegment)) return null
    return { kind: 'session', sessionId: firstPathSegment }
  }

  if (parsed.hostname === 'settings') {
    if (firstPathSegment.length > 64 || (firstPathSegment && !SAFE_ID_PATTERN.test(firstPathSegment))) return null
    return { kind: 'settings', requestedTab: firstPathSegment }
  }

  if (parsed.hostname !== 'provider' || firstPathSegment !== 'install') return null

  const provider = readBoundedParam(parsed.searchParams, 'provider', 128)
  const nameParam = readBoundedParam(parsed.searchParams, 'name', 256)
  const baseUrlParam = readBoundedParam(parsed.searchParams, 'baseUrl', 2_048)
  const apiKey = readBoundedParam(parsed.searchParams, 'apiKey', 8_192)
  const apiTypeRaw = readBoundedParam(parsed.searchParams, 'apiType', 64)
  const modelsRaw = readBoundedParam(parsed.searchParams, 'models', 8_192)
  if (provider === null || nameParam === null || baseUrlParam === null || apiKey === null || apiTypeRaw === null || modelsRaw === null) {
    return null
  }
  if (!provider || !SAFE_ID_PATTERN.test(provider)) return null

  const baseUrl = parseHttpUrl(baseUrlParam)
  if (baseUrl === null) return null

  const apiType = apiTypeRaw && ALLOWED_API_TYPES.has(apiTypeRaw as ApiType)
    ? apiTypeRaw as ApiType
    : undefined
  const models = modelsRaw
    ? [...new Set(modelsRaw.split(',').map((model) => model.trim()).filter(Boolean))]
    : []
  if (models.length > MAX_MODELS || models.some((model) => model.length > 256 || !SAFE_ID_PATTERN.test(model))) return null

  return {
    kind: 'provider-install',
    provider,
    name: nameParam || provider,
    baseUrl,
    apiKey,
    apiType,
    models,
  }
}
