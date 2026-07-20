import * as React from 'react'
import { highlightCode, highlightToTokens } from '@kila/core'
import type { HighlightTokensResult } from '@kila/core'

type CodeThemeName = 'github-light' | 'github-dark'

interface TokenState {
  key: string
  result: HighlightTokensResult | null
}

const tokenCache = new Map<string, HighlightTokensResult>()
const MAX_HIGHLIGHT_CHARACTERS = 200_000
const MAX_TOKEN_CACHE_ENTRIES = 40

function cacheTokenResult(key: string, result: HighlightTokensResult): void {
  if (tokenCache.has(key)) tokenCache.delete(key)
  tokenCache.set(key, result)
  if (tokenCache.size <= MAX_TOKEN_CACHE_ENTRIES) return
  const oldestKey = tokenCache.keys().next().value
  if (oldestKey) tokenCache.delete(oldestKey)
}

function getCodeTheme(): CodeThemeName {
  if (typeof document === 'undefined') return 'github-light'
  return document.documentElement.classList.contains('dark') ? 'github-dark' : 'github-light'
}

function hashCode(code: string): string {
  let hash = 2166136261
  for (let index = 0; index < code.length; index += 1) {
    hash ^= code.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function getCacheKey(code: string, language: string, theme: CodeThemeName): string {
  return `${theme}:${language}:${code.length}:${hashCode(code)}`
}

function getInitialTokenState(code: string, language: string, theme: CodeThemeName): TokenState {
  const key = getCacheKey(code, language, theme)
  if (code.length > MAX_HIGHLIGHT_CHARACTERS) return { key, result: null }

  const cached = tokenCache.get(key)
  if (cached) return { key, result: cached }
  const result = highlightToTokens({ code, language, theme })
  if (result) cacheTokenResult(key, result)
  return { key, result }
}

/** 工作台代码视图共用的 Shiki token 加载与主题同步。 */
export function useCodeTokens(code: string, language: string): HighlightTokensResult | null {
  const [theme, setTheme] = React.useState<CodeThemeName>(getCodeTheme)
  const [tokenState, setTokenState] = React.useState<TokenState>(() => getInitialTokenState(code, language, theme))
  const currentKey = getCacheKey(code, language, theme)

  React.useEffect(() => {
    const observer = new MutationObserver(() => setTheme(getCodeTheme()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  React.useEffect(() => {
    let cancelled = false
    if (code.length > MAX_HIGHLIGHT_CHARACTERS) {
      setTokenState({ key: currentKey, result: null })
      return
    }

    const cached = tokenCache.get(currentKey)
    if (cached) {
      setTokenState({ key: currentKey, result: cached })
      return
    }

    const syncResult = highlightToTokens({ code, language, theme })
    if (syncResult) {
      cacheTokenResult(currentKey, syncResult)
      setTokenState({ key: currentKey, result: syncResult })
      return
    }

    setTokenState({ key: currentKey, result: null })
    highlightCode({ code, language, theme })
      .then(() => {
        if (cancelled) return
        const result = highlightToTokens({ code, language, theme })
        if (!result) return
        cacheTokenResult(currentKey, result)
        setTokenState({ key: currentKey, result })
      })
      .catch((error) => console.error('[CodeWorkbench] 代码高亮失败:', error))

    return () => { cancelled = true }
  }, [code, currentKey, language, theme])

  return tokenState.key === currentKey ? tokenState.result : null
}
