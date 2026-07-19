import { getSettings } from '../settings-service'

export interface MemoryRuntimeConfig {
  nowledgeEnabled: boolean
  nowledgeBaseUrl?: string
  nowledgeApiKey?: string
  nowledgeTimeoutMs: number
  sessionContextEnabled: boolean
}

export const NOWLEDGE_DEFAULT_BASE_URL = 'http://127.0.0.1:14242'

const DEFAULT_NOWLEDGE_TIMEOUT_MS = 8_000

function normalizePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : fallback
}

function normalizeOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined
}

export function isLocalNowledgeBaseUrl(value: string | undefined): boolean {
  const normalized = normalizeOptionalText(value)
  if (!normalized) return false

  try {
    const url = new URL(normalized)
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'
  } catch {
    return false
  }
}

export function isNowledgeConfigured(input: Pick<MemoryRuntimeConfig, 'nowledgeEnabled' | 'nowledgeBaseUrl' | 'nowledgeApiKey'>): boolean {
  if (!input.nowledgeEnabled) return false
  const baseUrl = normalizeOptionalText(input.nowledgeBaseUrl)
  return Boolean(baseUrl && isLocalNowledgeBaseUrl(baseUrl))
}

export function getMemoryRuntimeConfig(): MemoryRuntimeConfig {
  const settings = getSettings()
  const envBaseUrl = process.env.KILA_NOWLEDGE_BASE_URL?.trim()
  const envApiKey = process.env.KILA_NOWLEDGE_API_KEY?.trim()
  const envTimeout = process.env.KILA_NOWLEDGE_TIMEOUT_MS

  return {
    nowledgeEnabled: settings.memoryNowledgeEnabled ?? false,
    nowledgeBaseUrl: normalizeOptionalText(envBaseUrl || settings.memoryNowledgeBaseUrl),
    nowledgeApiKey: normalizeOptionalText(envApiKey || settings.memoryNowledgeApiKey),
    nowledgeTimeoutMs: normalizePositiveInt(
      envTimeout ? Number(envTimeout) : settings.memoryNowledgeTimeoutMs,
      DEFAULT_NOWLEDGE_TIMEOUT_MS,
    ),
    sessionContextEnabled: settings.memorySessionContextEnabled ?? true,
  }
}
