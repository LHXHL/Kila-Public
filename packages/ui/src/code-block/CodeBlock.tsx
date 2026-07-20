/**
 * CodeBlock - 代码块组件
 *
 * 提供语法高亮（Shiki）、语言标签和复制按钮。
 * 用于 react-markdown 的 pre 元素自定义渲染。
 *
 * 流式渲染策略（类 Cherry Studio 方案）：
 * 1. 使用 highlightToTokens 获取结构化 token，逐行渲染为 React 元素
 * 2. 稳定的行级 key → React reconciliation 只更新变化/新增的行
 * 3. 节流 80ms → 避免每个 token 都触发高亮计算
 * 4. 首次挂载异步初始化 → 后续全部同步
 *
 * 结构：
 * ┌─────────────────────────────────────────┐
 * │ [language]                     [📋 复制] │  ← 头部栏
 * ├─────────────────────────────────────────┤
 * │  const foo = 'bar'                      │  ← 高亮代码区（逐行渲染）
 * │  console.log(foo)                       │
 * └─────────────────────────────────────────┘
 */

import * as React from 'react'
import { highlightCode, highlightToTokens } from '@kila/core'
import type { HighlightToken, HighlightTokensResult } from '@kila/core'
import hljs from 'highlight.js/lib/common'

/** react-markdown 传入的 <code> 元素 props */
interface CodeElementProps {
  className?: string
  children?: React.ReactNode
}

interface CodeBlockProps {
  /** react-markdown 传入的 <pre> 子元素（内含 <code>） */
  children: React.ReactNode
}

/** 节流间隔（ms）：流式输出时限制高亮更新频率 */
const THROTTLE_MS = 80
type CodeThemeName = 'github-light' | 'github-dark'

// ===== 工具函数 =====

/** 递归提取 ReactNode 中的纯文本 */
function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (!node) return ''
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (React.isValidElement(node)) {
    return extractText((node.props as CodeElementProps).children)
  }
  return ''
}

/** 从 children 中提取语言名和代码文本 */
function extractCodeInfo(children: React.ReactNode): { language: string; code: string } {
  // react-markdown v10 会将 code 组件覆盖应用到代码块内，
  // 所以 pre 收到的子元素可能是函数组件而非原生 <code>。
  const codeElement = React.Children.toArray(children).find(
    (child): child is React.ReactElement => {
      if (!React.isValidElement(child)) return false
      const t = (child as React.ReactElement).type
      return t === 'code' || typeof t === 'function' || typeof t === 'object'
    }
  ) as React.ReactElement | undefined

  if (!codeElement) {
    return { language: '', code: extractText(children) }
  }

  const props = codeElement.props as CodeElementProps
  const langMatch = props.className?.match(/language-(\S+)/)

  return {
    language: langMatch?.[1] ?? '',
    code: extractText(props.children),
  }
}

const FALLBACK_LANGUAGE = 'plaintext'
const AUTO_COLLAPSE_LINE_THRESHOLD = 30
const COLLAPSED_VISIBLE_LINE_COUNT = 10
const LAZY_HIGHLIGHT_LINE_THRESHOLD = 200
const EXPANDED_INITIAL_LINE_COUNT = 400
const EXPANDED_LINE_BATCH_SIZE = 400
const AUTO_DETECT_MAX_CHARS = 20_000
const AUTO_DETECT_LANGUAGES = [
  'bash',
  'c',
  'cpp',
  'csharp',
  'css',
  'go',
  'java',
  'javascript',
  'json',
  'kotlin',
  'markdown',
  'php',
  'python',
  'ruby',
  'rust',
  'shell',
  'sql',
  'swift',
  'typescript',
  'xml',
  'yaml',
]

const LANGUAGE_ALIASES: Record<string, string> = {
  sh: 'shellscript', bash: 'shellscript', shell: 'shellscript', zsh: 'shellscript',
  js: 'javascript', ts: 'typescript', py: 'python', rb: 'ruby', yml: 'yaml',
  md: 'markdown', rs: 'rust', 'c++': 'cpp', cs: 'csharp', txt: 'text', plaintext: 'text',
}

const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  shellscript: 'Shell', javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python',
  markdown: 'Markdown', json: 'JSON', yaml: 'YAML', html: 'HTML', css: 'CSS',
  jsx: 'JSX', tsx: 'TSX', cpp: 'C++', csharp: 'C#', go: 'Go', rust: 'Rust', java: 'Java', kotlin: 'Kotlin', swift: 'Swift', ruby: 'Ruby', php: 'PHP', sql: 'SQL', xml: 'XML', c: 'C', text: 'Plaintext',
}

export function normalizeCodeBlockLanguage(language: string): string {
  if (!language) return FALLBACK_LANGUAGE
  const input = language.toLowerCase().trim()
  return LANGUAGE_ALIASES[input] ?? (input.replace(/[^a-z0-9_+.-]/g, '') || FALLBACK_LANGUAGE)
}

export function getCodeBlockDisplayName(language: string): string {
  const normalized = normalizeCodeBlockLanguage(language)
  return LANGUAGE_DISPLAY_NAMES[normalized] ?? (normalized.toUpperCase() || 'Plaintext')
}

export function detectCodeBlockLanguage(code: string): string {
  const trimmed = code.trim()
  if (trimmed.length < 24) return FALLBACK_LANGUAGE

  const result = hljs.highlightAuto(trimmed.slice(0, AUTO_DETECT_MAX_CHARS), AUTO_DETECT_LANGUAGES)
  const language = result.language
  if (!language || result.relevance < 5) return FALLBACK_LANGUAGE

  // 不做 second-best margin 检查：与 Proma 对齐，
  // 宁可显示"最佳猜测"的高亮也不让所有代码块 fallback 到 plaintext

  return normalizeCodeBlockLanguage(language)
}

function getCodeTheme(): CodeThemeName {
  return document.documentElement.classList.contains('dark') ? 'github-dark' : 'github-light'
}

const tokenCache = new Map<string, HighlightTokensResult>()
const MAX_TOKEN_CACHE_ENTRIES = 80

function cacheTokenResult(key: string, result: HighlightTokensResult): void {
  if (tokenCache.has(key)) tokenCache.delete(key)
  tokenCache.set(key, result)
  if (tokenCache.size <= MAX_TOKEN_CACHE_ENTRIES) return
  const oldestKey = tokenCache.keys().next().value
  if (oldestKey) tokenCache.delete(oldestKey)
}

function getTokenCacheKey(code: string, language: string, theme: string): string {
  return `${theme}:${language}:${code.length}:${code.slice(0, 96)}:${code.slice(-96)}`
}

// ===== SVG 图标路径常量 =====

const ICON_ATTRS = {
  width: 14, height: 14, viewBox: '0 0 24 24',
  fill: 'none', stroke: 'currentColor', strokeWidth: 2,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
}

const copyIconPath = (
  <>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </>
)

const checkIconPath = <polyline points="20 6 9 17 4 12" />
const chevronDownPath = <polyline points="6 9 12 15 18 9" />
const chevronRightPath = <polyline points="9 18 15 12 9 6" />

export function shouldAutoCollapseCodeBlock(lineCount: number): boolean {
  return lineCount > AUTO_COLLAPSE_LINE_THRESHOLD
}

export function getCollapsedCodeBlockVisibleLineCount(lineCount: number): number {
  if (!shouldAutoCollapseCodeBlock(lineCount)) return lineCount
  return Math.min(COLLAPSED_VISIBLE_LINE_COUNT, lineCount)
}


export function getExpandedCodeBlockVisibleLineCount(lineCount: number, requestedLineCount: number): number {
  return Math.min(lineCount, Math.max(EXPANDED_INITIAL_LINE_COUNT, requestedLineCount))
}

export function shouldShowCodeBlockLineNumbers(lineCount: number): boolean {
  return shouldAutoCollapseCodeBlock(lineCount)
}

export function shouldLazyHighlightCodeBlock(lineCount: number): boolean {
  return lineCount > LAZY_HIGHLIGHT_LINE_THRESHOLD
}

// ===== 逐行渲染子组件 =====

interface CodeLineProps {
  tokens: HighlightToken[]
  /** 该行的原始文本（token 未覆盖部分作为 fallback） */
  rawLine: string
  /** 是否是流式过程中新出现的行（带淡入动画） */
  isNew?: boolean
}

/** 单行代码渲染（memo 避免已稳定行重复渲染） */
const CodeLine = React.memo(function CodeLine({ tokens, rawLine, isNew }: CodeLineProps): React.ReactElement {
  // token 覆盖的字符数
  const tokenLen = tokens.reduce((sum, t) => sum + t.content.length, 0)

  return (
    <span className={isNew ? 'line code-line-new' : 'line'}>
      {tokens.map((token, i) => (
        <span key={i} style={token.color ? { color: token.color } : undefined}>
          {token.content}
        </span>
      ))}
      {/* 流式输出时可能有 token 尚未覆盖的尾部文本 */}
      {tokenLen < rawLine.length && (
        <span>{rawLine.slice(tokenLen)}</span>
      )}
    </span>
  )
})

// ===== 主组件 =====

/**
 * CodeBlock 代码块组件
 *
 * 渲染策略：
 * - 逐行渲染：highlightToTokens → 每行独立 React 元素 + 稳定 key
 * - 节流 80ms：流式输出时控制重计算频率
 * - 异步兜底：首次挂载高亮器未就绪时，异步初始化后触发一次更新
 */
export function CodeBlock({ children }: CodeBlockProps): React.ReactElement {
  const { language, code } = React.useMemo(() => extractCodeInfo(children), [children])
  const [copied, setCopied] = React.useState(false)
  const wrapperRef = React.useRef<HTMLDivElement | null>(null)

  const trimmedCode = code.replace(/\n$/, '')
  const langOrText = React.useMemo(
    () => language ? normalizeCodeBlockLanguage(language) : detectCodeBlockLanguage(trimmedCode),
    [language, trimmedCode],
  )
  const rawLines = React.useMemo(() => trimmedCode.split('\n'), [trimmedCode])
  const shouldAutoCollapse = shouldAutoCollapseCodeBlock(rawLines.length)
  const showLineNumbers = shouldShowCodeBlockLineNumbers(rawLines.length)
  const shouldLazyHighlight = shouldLazyHighlightCodeBlock(rawLines.length)
  const [highlightRequested, setHighlightRequested] = React.useState(() => !shouldLazyHighlight)
  const [expanded, setExpanded] = React.useState(() => !shouldAutoCollapse)
  const [lineWindow, setLineWindow] = React.useState(() => ({
    source: trimmedCode,
    requestedLineCount: EXPANDED_INITIAL_LINE_COUNT,
  }))
  const loadMoreRef = React.useRef<HTMLDivElement | null>(null)
  const [themeName, setThemeName] = React.useState<CodeThemeName>(() => getCodeTheme())
  const requestedLineCount = lineWindow.source === trimmedCode
    ? lineWindow.requestedLineCount
    : EXPANDED_INITIAL_LINE_COUNT
  const visibleLineCount = expanded
    ? getExpandedCodeBlockVisibleLineCount(rawLines.length, requestedLineCount)
    : getCollapsedCodeBlockVisibleLineCount(rawLines.length)
  const hiddenLineCount = Math.max(rawLines.length - visibleLineCount, 0)
  const visibleLines = React.useMemo(
    () => rawLines.slice(0, visibleLineCount),
    [rawLines, visibleLineCount],
  )
  const visibleCode = React.useMemo(() => visibleLines.join('\n'), [visibleLines])

  React.useEffect(() => {
    const target = loadMoreRef.current
    if (!expanded || !target || hiddenLineCount === 0) return

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      setLineWindow((current) => ({
        source: trimmedCode,
        requestedLineCount: (current.source === trimmedCode
          ? current.requestedLineCount
          : EXPANDED_INITIAL_LINE_COUNT) + EXPANDED_LINE_BATCH_SIZE,
      }))
    }, { rootMargin: '640px 0px' })

    observer.observe(target)
    return () => observer.disconnect()
  }, [expanded, hiddenLineCount, trimmedCode])

  // 行级淡入：跟踪「已稳定的行数」，超过此数的行标记为 isNew
  const stableLineCountRef = React.useRef(0)
  // 当行数增长后，延迟将新行标记为已稳定（动画播放完毕）
  React.useEffect(() => {
    if (visibleLines.length > stableLineCountRef.current) {
      const timer = setTimeout(() => {
        stableLineCountRef.current = visibleLines.length
      }, 200) // 与 CSS 动画时长一致
      return () => clearTimeout(timer)
    }
  }, [visibleLines.length])

  React.useEffect(() => {
    const observer = new MutationObserver(() => {
      setThemeName(getCodeTheme())
    })

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  React.useEffect(() => {
    if (!shouldLazyHighlight) {
      setHighlightRequested(true)
      return
    }

    setHighlightRequested(false)
    const target = wrapperRef.current
    if (!target) return

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      setHighlightRequested(true)
      observer.disconnect()
    }, { rootMargin: '360px 0px' })

    observer.observe(target)
    return () => observer.disconnect()
  }, [shouldLazyHighlight])

  // ---- 节流 token 高亮 ----
  const [tokenResult, setTokenResult] = React.useState<HighlightTokensResult | null>(
    () => {
      if (shouldLazyHighlightCodeBlock(trimmedCode.split('\n').length)) return null
      const cacheKey = getTokenCacheKey(visibleCode, langOrText, themeName)
      const cached = tokenCache.get(cacheKey)
      if (cached) return cached
      const result = highlightToTokens({ code: visibleCode, language: langOrText, theme: themeName })
      if (result) cacheTokenResult(cacheKey, result)
      return result
    }
  )
  const pendingCodeRef = React.useRef(visibleCode)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastUpdateRef = React.useRef(Date.now())

  pendingCodeRef.current = visibleCode

  React.useEffect(() => {
    if (!highlightRequested) {
      setTokenResult(null)
      return
    }

    const now = Date.now()
    const elapsed = now - lastUpdateRef.current
    const cacheKey = getTokenCacheKey(visibleCode, langOrText, themeName)

    const doHighlight = () => {
      const currentCode = pendingCodeRef.current
      const nextCacheKey = getTokenCacheKey(currentCode, langOrText, themeName)
      const cached = tokenCache.get(nextCacheKey)
      if (cached) {
        lastUpdateRef.current = Date.now()
        setTokenResult(cached)
        return
      }
      const result = highlightToTokens({ code: currentCode, language: langOrText, theme: themeName })
      if (result) {
        cacheTokenResult(nextCacheKey, result)
        lastUpdateRef.current = Date.now()
        setTokenResult(result)
      }
    }

    // 同步路径可用时
    const cached = tokenCache.get(cacheKey)
    if (cached) {
      setTokenResult(cached)
      return
    }
    const syncResult = highlightToTokens({ code: visibleCode, language: langOrText, theme: themeName })
    if (syncResult) {
      cacheTokenResult(cacheKey, syncResult)
      if (elapsed >= THROTTLE_MS) {
        // 距上次更新已超过节流间隔，立即执行
        lastUpdateRef.current = now
        setTokenResult(syncResult)
      } else if (!timerRef.current) {
        // 安排延迟执行，确保最终状态正确
        timerRef.current = setTimeout(() => {
          timerRef.current = null
          doHighlight()
        }, THROTTLE_MS - elapsed)
      }
      return
    }

    // 异步兜底：高亮器尚未初始化，或当前语言尚未按需加载
    let cancelled = false
    highlightCode({ code: visibleCode, language: langOrText, theme: themeName })
      .then(() => {
        // 初始化完成，用同步路径获取最新结果
        if (!cancelled) doHighlight()
      })
      .catch((error) => console.error('[CodeBlock] 高亮失败:', error))

    return () => { cancelled = true }
  }, [highlightRequested, visibleCode, langOrText, themeName])

  // 清理节流定时器
  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  // 复制到剪贴板
  const fallbackCopy = React.useCallback((text: string): boolean => {
    if (typeof document === 'undefined') return false

    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'fixed'
    textarea.style.top = '0'
    textarea.style.left = '-9999px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    textarea.setSelectionRange(0, text.length)

    try {
      return document.execCommand('copy')
    } finally {
      document.body.removeChild(textarea)
    }
  }, [])

  const handleCopy = React.useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(trimmedCode)
      } else if (!fallbackCopy(trimmedCode)) {
        throw new Error('Clipboard API unavailable')
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      if (fallbackCopy(trimmedCode)) {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
        return
      }
      console.error('[CodeBlock] 复制失败:', error)
    }
  }, [fallbackCopy, trimmedCode])

  return (
    <div ref={wrapperRef} className="code-block-wrapper group/code my-2 w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-border/50">
      {/* 头部栏：语言标签 + 复制按钮 */}
      <div className="flex items-center justify-between h-[34px] px-2 py-1 bg-muted/60 text-muted-foreground text-xs">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 font-medium text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
          aria-expanded={expanded}
          title={expanded ? '收起代码块' : '展开代码块'}
        >
          <svg {...ICON_ATTRS}>{expanded ? chevronDownPath : chevronRightPath}</svg>
          <span className="select-none truncate">{getCodeBlockDisplayName(langOrText)}</span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <span className="px-1 text-[11px] text-muted-foreground/75 tabular-nums">
            {rawLines.length} 行{shouldLazyHighlight && !tokenResult ? ' · 懒加载' : ''}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-foreground/10 transition-colors text-muted-foreground hover:text-foreground"
          >
            <svg {...ICON_ATTRS}>{copied ? checkIconPath : copyIconPath}</svg>
            <span>{copied ? '已复制' : '复制'}</span>
          </button>
        </div>
      </div>

      {/* 代码区域：逐行渲染 */}
      {(expanded || shouldAutoCollapse) && (
        <pre
          className="shiki m-0 max-w-full overflow-x-auto whitespace-pre-wrap break-words p-0 text-[13px] leading-[1.6]"
          style={{
            backgroundColor: 'hsl(var(--code-surface))',
            color: tokenResult?.fgColor ?? 'hsl(var(--foreground))',
            borderRadius: '0 0 8px 8px',
          }}
        >
          <code className="block px-0 py-3">
            {visibleLines.map((rawLine, i) => (
              <span
                key={i}
                className={showLineNumbers ? 'grid grid-cols-[3.25rem_minmax(0,1fr)] gap-3 px-0' : 'block px-4'}
              >
                {showLineNumbers && (
                  <span
                    aria-hidden="true"
                    className="select-none border-r border-border/50 pr-3 text-right text-muted-foreground/45 tabular-nums"
                  >
                    {i + 1}
                  </span>
                )}
                <span className="min-w-0">
                  <CodeLine
                    tokens={tokenResult?.lines[i] ?? []}
                    rawLine={rawLine}
                    isNew={i >= stableLineCountRef.current}
                  />
                </span>
              </span>
            ))}
          </code>
        </pre>
      )}

      {hiddenLineCount > 0 && (
        expanded ? (
          <div ref={loadMoreRef} className="h-px w-full" aria-hidden="true" />
        ) : (
          <div className="border-t border-border/50 bg-muted/35 px-3 py-2">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            >
              <svg {...ICON_ATTRS}>{chevronDownPath}</svg>
              <span>{`展开代码（共 ${rawLines.length} 行）`}</span>
            </button>
          </div>
        )
      )}
    </div>
  )
}
