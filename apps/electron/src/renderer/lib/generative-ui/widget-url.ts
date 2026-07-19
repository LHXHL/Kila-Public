import { WIDGET_CDN_WHITELIST } from './constants'

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])
const CDN_HOSTS = new Set<string>(WIDGET_CDN_WHITELIST)
const ABSOLUTE_URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi

export function normalizeWidgetExternalUrl(value: unknown): string | null {
  const rawUrl = typeof value === 'string' ? value.trim() : ''
  if (!rawUrl) return null

  try {
    const url = new URL(rawUrl)
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(url.protocol)) return null
    return url.toString()
  } catch {
    return null
  }
}

export function containsAllowedWidgetCdnUrl(widgetCode: string): boolean {
  const candidates = widgetCode.match(ABSOLUTE_URL_PATTERN) ?? []
  return candidates.some((candidate) => {
    try {
      return CDN_HOSTS.has(new URL(candidate).hostname)
    } catch {
      return false
    }
  })
}
