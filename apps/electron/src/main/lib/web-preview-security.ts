import type { WebPreferences } from 'electron'

export const WEB_PREVIEW_PARTITION = 'kila-web-preview'
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

export function isAllowedWebPreviewUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    return ALLOWED_PROTOCOLS.has(parsed.protocol) && !parsed.username && !parsed.password
  } catch {
    return false
  }
}

export function isAllowedWebPreviewAttachment(partition: string | undefined, src: string | undefined): boolean {
  if (partition !== WEB_PREVIEW_PARTITION) return false
  if (!src || src === 'about:blank') return true
  return isAllowedWebPreviewUrl(src)
}

export function hardenWebPreviewPreferences(webPreferences: WebPreferences): void {
  delete webPreferences.preload
  webPreferences.nodeIntegration = false
  webPreferences.nodeIntegrationInSubFrames = false
  webPreferences.contextIsolation = true
  webPreferences.sandbox = true
  webPreferences.webSecurity = true
  webPreferences.allowRunningInsecureContent = false
  webPreferences.experimentalFeatures = false
  webPreferences.safeDialogs = true
}
