export interface RichTextTokenBase {
  value: string
}

export interface RichTextPlainToken extends RichTextTokenBase {
  kind: 'text'
}

export interface RichTextLinkToken extends RichTextTokenBase {
  kind: 'link'
  href: string
  label: string
}

export type RichTextToken = RichTextPlainToken | RichTextLinkToken

const MARKDOWN_LINK_RE = /\[([^\]\n]+)\][ \t\r\n]*\(([^\s)]+)\)/g
const FENCED_CODE_BLOCK_RE = /(^|\n)([ \t]*(`{3,}|~{3,})([^\n]*)\r?\n([\s\S]*?)\r?\n[ \t]*\3)(?=\n|$)/g
const MARKDOWN_FENCE_LANGUAGES = new Set(['markdown', 'md', 'mdown', 'mkdown'])
const BARE_LINK_RE = /(?:https?:\/\/|file:\/\/|sandbox:)[^\s<>"'`]+/gi
const TRAILING_PUNCTUATION_RE = /[.,!?;:，。！？；：、]+$/
const LOCAL_FILE_LINK_RE = /^(?:(?:\.\.?[\\/])|[\\/]|[A-Za-z]:[\\/]).+\.[A-Za-z0-9]{1,12}(?:[?#].*)?$/

function isSafeRichLinkHref(href: string): boolean {
  const value = href.trim()
  if (/^https?:\/\//i.test(value)) return true
  if (/^(?:file:\/\/|sandbox:)/i.test(value)) return true
  return LOCAL_FILE_LINK_RE.test(value)
}

function trimBareLink(value: string): { href: string; trailing: string } {
  let href = value
  let trailing = ''

  const punctuation = href.match(TRAILING_PUNCTUATION_RE)?.[0] ?? ''
  if (punctuation) {
    href = href.slice(0, -punctuation.length)
    trailing = punctuation
  }

  const pairs: Array<[string, string]> = [['(', ')'], ['[', ']'], ['{', '}']]
  let changed = true
  while (changed && href) {
    changed = false
    for (const [open, close] of pairs) {
      if (!href.endsWith(close)) continue
      const openCount = href.split(open).length - 1
      const closeCount = href.split(close).length - 1
      if (closeCount > openCount) {
        href = href.slice(0, -1)
        trailing = `${close}${trailing}`
        changed = true
      }
    }
  }

  return { href, trailing }
}

function pushText(tokens: RichTextToken[], value: string): void {
  if (!value) return
  const previous = tokens.at(-1)
  if (previous?.kind === 'text') {
    previous.value += value
    return
  }
  tokens.push({ kind: 'text', value })
}

/**
 * 解析用户可见纯文本中的明确链接，不启用完整 Markdown，避免改变原有消息语义。
 */
export function parseRichTextTokens(text: string): RichTextToken[] {
  const candidates: Array<{ start: number; end: number; href: string; label: string; value: string }> = []

  MARKDOWN_LINK_RE.lastIndex = 0
  let markdownMatch: RegExpExecArray | null
  while ((markdownMatch = MARKDOWN_LINK_RE.exec(text)) !== null) {
    const label = markdownMatch[1] ?? ''
    const href = markdownMatch[2] ?? ''
    if (!isSafeRichLinkHref(href)) continue
    candidates.push({
      start: markdownMatch.index,
      end: markdownMatch.index + markdownMatch[0].length,
      href,
      label,
      value: markdownMatch[0],
    })
  }

  BARE_LINK_RE.lastIndex = 0
  let bareMatch: RegExpExecArray | null
  while ((bareMatch = BARE_LINK_RE.exec(text)) !== null) {
    const start = bareMatch.index
    const rawValue = bareMatch[0]
    const overlapsMarkdown = candidates.some((candidate) => start >= candidate.start && start < candidate.end)
    if (overlapsMarkdown) continue

    const { href, trailing } = trimBareLink(rawValue)
    if (!href || !isSafeRichLinkHref(href)) continue
    candidates.push({
      start,
      end: start + href.length,
      href,
      label: href,
      value: href,
    })

    if (trailing) {
      BARE_LINK_RE.lastIndex -= trailing.length
    }
  }

  candidates.sort((left, right) => left.start - right.start || right.end - left.end)

  const tokens: RichTextToken[] = []
  let cursor = 0
  for (const candidate of candidates) {
    if (candidate.start < cursor) continue
    pushText(tokens, text.slice(cursor, candidate.start))
    tokens.push({
      kind: 'link',
      value: candidate.value,
      href: candidate.href,
      label: candidate.label,
    })
    cursor = candidate.end
  }
  pushText(tokens, text.slice(cursor))

  return tokens.length > 0 ? tokens : [{ kind: 'text', value: text }]
}


/** 将消息中被错误包进 Markdown 代码围栏的纯链接恢复为可渲染 Markdown。 */
export function normalizeMessageRichLinks(text: string): string {
  const normalizeSplitLinks = (value: string): string => {
    MARKDOWN_LINK_RE.lastIndex = 0
    return value.replace(MARKDOWN_LINK_RE, (source, label: string, href: string) => {
      if (!isSafeRichLinkHref(href)) return source
      return `[${label}](${href})`
    })
  }

  const result: string[] = []
  let cursor = 0
  FENCED_CODE_BLOCK_RE.lastIndex = 0
  let fenceMatch: RegExpExecArray | null

  while ((fenceMatch = FENCED_CODE_BLOCK_RE.exec(text)) !== null) {
    const prefix = fenceMatch[1] ?? ''
    const fullBlock = fenceMatch[2] ?? ''
    const language = (fenceMatch[4] ?? '').trim().toLowerCase()
    const fencedContent = fenceMatch[5] ?? ''
    const outsideEnd = fenceMatch.index + prefix.length

    result.push(normalizeSplitLinks(text.slice(cursor, outsideEnd)))

    if (MARKDOWN_FENCE_LANGUAGES.has(language)) {
      const normalizedContent = normalizeSplitLinks(fencedContent).trim()
      const tokens = parseRichTextTokens(normalizedContent)
      const containsLink = tokens.some((token) => token.kind === 'link')
      const containsNonWhitespaceText = tokens.some(
        (token) => token.kind === 'text' && token.value.trim().length > 0,
      )

      // 只解包“纯链接”代码围栏，真实 Markdown 示例保持原样。
      result.push(containsLink && !containsNonWhitespaceText ? normalizedContent : fullBlock)
    } else {
      result.push(fullBlock)
    }

    cursor = fenceMatch.index + fenceMatch[0].length
  }

  result.push(normalizeSplitLinks(text.slice(cursor)))
  return result.join('')
}
