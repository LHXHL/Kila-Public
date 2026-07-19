import { createRichLinkPresentation } from './rich-link-presentation'
import { parseRichTextTokens } from './rich-link-text-parser'

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

function escapeHtmlAttribute(text: string): string {
  return escapeHtml(text)
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderInlineRichText(text: string): string {
  return parseRichTextTokens(text).map((token) => {
    if (token.kind === 'text') return escapeHtml(token.value)

    const presentation = createRichLinkPresentation(token.href, token.label)
    return [
      '<span',
      ' data-type=\"rich-link\"',
      ` data-rich-link-href=\"${escapeHtmlAttribute(token.href)}\"`,
      ` data-rich-link-label=\"${escapeHtmlAttribute(presentation.label)}\"`,
      ` data-rich-link-source=\"${escapeHtmlAttribute(token.value)}\"`,
      ` data-rich-link-kind=\"${presentation.kind}\"`,
      ' class=\"composer-rich-link-chip\"',
      ` title=\"${escapeHtmlAttribute(token.href)}\"`,
      `>${escapeHtml(presentation.label)}</span>`,
    ].join('')
  }).join('')
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
    .map((paragraph) => `<p>${paragraph.split('\n').map(renderInlineRichText).join('<br>')}</p>`)
    .join('')
}

export function htmlToPlainText(html: string): string {
  if (!html || html === '<p></p>') return ''

  const withMentions = html.replace(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi, (_full, attrs, children) => {
    const richLinkSource = readAttr(attrs, 'data-rich-link-source')
    if (/data-type=(["'])rich-link\1/i.test(attrs) && richLinkSource) {
      return richLinkSource
    }

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
