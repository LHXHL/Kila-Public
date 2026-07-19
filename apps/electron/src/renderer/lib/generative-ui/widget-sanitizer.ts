const DANGEROUS_TAGS_RE = /<(iframe|object|embed|meta|link|base|form)[\s>][\s\S]*?<\/\1>/gi
const DANGEROUS_VOID_TAGS_RE = /<(iframe|object|embed|meta|link|base)\b[^>]*\/?>/gi

export function sanitizeForStreaming(html: string): string {
  return html
    .replace(DANGEROUS_TAGS_RE, '')
    .replace(DANGEROUS_VOID_TAGS_RE, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']*)/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(
      /\s+(href|src|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']*))/gi,
      (match, _attr: string, dq?: string, sq?: string, uq?: string) => {
        const value = (dq ?? sq ?? uq ?? '').trim()
        if (/^\s*(javascript|data)\s*:/i.test(value)) {
          return ''
        }
        return match
      },
    )
}

export function sanitizeForIframe(html: string): string {
  return html
    .replace(DANGEROUS_TAGS_RE, '')
    .replace(DANGEROUS_VOID_TAGS_RE, '')
}
