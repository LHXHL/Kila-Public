export type SessionWebPreviewServerStatus = 'idle' | 'starting' | 'running' | 'error'

export interface SessionWebPreviewState {
  draftUrl: string
  currentUrl: string | null
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
  serverStatus: SessionWebPreviewServerStatus
  serverBaseUrl: string | null
  lastPreviewedFilePath: string | null
  lastError: string | null
}

export const WEB_PREVIEW_PARTITION = 'kila-web-preview'

export function createEmptySessionWebPreviewState(): SessionWebPreviewState {
  return {
    draftUrl: '',
    currentUrl: null,
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    serverStatus: 'idle',
    serverBaseUrl: null,
    lastPreviewedFilePath: null,
    lastError: null,
  }
}

export function isHtmlFilePath(filePath: string): boolean {
  const normalized = filePath.trim().toLowerCase()
  return normalized.endsWith('.html') || normalized.endsWith('.htm')
}

export function normalizeWebPreviewUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const withProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  try {
    const parsed = new URL(withProtocol)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed.toString()
  } catch {
    return null
  }
}
