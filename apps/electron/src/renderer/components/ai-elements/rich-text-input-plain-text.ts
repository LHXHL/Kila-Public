function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, '\'')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function normalizePlainText(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

function readAttr(attrs: string, name: string): string | null {
  const match = attrs.match(new RegExp(`${name}=(["'])(.*?)\\1`, 'i'))
  return match?.[2] ?? null
}

export function plainTextToHtml(text: string): string {
  const normalized = normalizePlainText(text)
  if (!normalized) return ''

  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

export function htmlToPlainText(html: string): string {
  if (!html || html === '<p></p>') return ''

  const withMentions = html.replace(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi, (_full, attrs, children) => {
    if (!/data-type=(["'])mention\1/i.test(attrs)) {
      return children
    }

    const id = readAttr(attrs, 'data-id') ?? children
    const suggestionChar = readAttr(attrs, 'data-mention-suggestion-char') ?? '@'

    if (suggestionChar === '/') return `/skill:${id}`
    if (suggestionChar === '#') return `#mcp:${id}`
    return `@file:${id}`
  })

  const withLineBreaks = withMentions
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|blockquote|pre|h[1-6]|ul|ol)>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')

  return decodeHtmlEntities(
    withLineBreaks
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  )
}

export function plainTextToDocument(text: string): string {
  return plainTextToHtml(normalizePlainText(text))
}
