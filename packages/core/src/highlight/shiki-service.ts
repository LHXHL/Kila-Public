/**
 * Shiki 语法高亮服务
 *
 * 提供懒加载的 Shiki 高亮器单例，支持按需加载语言。
 * 纯逻辑层，不依赖 React。
 *
 * 三套 API：
 * - highlightCode()      异步 HTML，首次初始化 + 按需加载语言
 * - highlightCodeSync()  同步 HTML，初始化完成后零延迟
 * - highlightToTokens()  同步 token 结构，适合逐行 React 渲染（流式最优）
 */

import { createHighlighter, bundledLanguages } from 'shiki'
import type { HighlighterGeneric, BundledLanguage, BundledTheme } from 'shiki'

/** Shiki 高亮器实例类型 */
type ShikiHighlighter = HighlighterGeneric<BundledLanguage, BundledTheme>

/** 默认预加载的语言列表 */
const DEFAULT_LANGS: BundledLanguage[] = ['javascript', 'typescript', 'json', 'shellscript']

/** 默认加载的主题 */
const DEFAULT_THEMES: BundledTheme[] = ['github-light', 'github-dark']
const DEFAULT_THEME: BundledTheme = 'github-light'

/** 常见语言别名映射 */
const LANGUAGE_ALIASES: Record<string, string> = {
  sh: 'shellscript',
  bash: 'shellscript',
  shell: 'shellscript',
  zsh: 'shellscript',
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  rb: 'ruby',
  yml: 'yaml',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  kt: 'kotlin',
  rs: 'rust',
  md: 'markdown',
  tf: 'terraform',
  dockerfile: 'docker',
  plaintext: 'text',
  txt: 'text',
  plain: 'text',
}

/** 高亮选项 */
export interface HighlightOptions {
  /** 代码内容 */
  code: string
  /** 语言标识（如 'typescript'、'py'、'bash'） */
  language: string
  /** Shiki 主题名，默认 'github-light' */
  theme?: string
}

/** 高亮结果（HTML 字符串） */
export interface HighlightResult {
  /** Shiki 渲染的 HTML 字符串 */
  html: string
  /** 实际使用的语言（经过别名解析和 fallback） */
  language: string
}

/** 单个高亮 token */
export interface HighlightToken {
  /** 文本内容 */
  content: string
  /** CSS 颜色值 */
  color?: string
}

/** 按行组织的 token 高亮结果（适合 React 逐行渲染） */
export interface HighlightTokensResult {
  /** 每行的 token 列表 */
  lines: HighlightToken[][]
  /** 代码区域背景色 */
  bgColor: string
  /** 代码区域前景色 */
  fgColor: string
  /** 实际使用的语言 */
  language: string
}

/** 单例高亮器 Promise */
let highlighterPromise: Promise<ShikiHighlighter> | null = null

/** 已 resolve 的高亮器实例缓存（同步访问用） */
let cachedHighlighter: ShikiHighlighter | null = null

/** 正在加载的语言 Promise，避免多个代码块重复触发同一种语言加载 */
const languageLoadPromises = new Map<string, Promise<string>>()

function resolveThemeFallbackColors(theme: string): Pick<HighlightTokensResult, 'bgColor' | 'fgColor'> {
  if (theme === 'github-dark') {
    return {
      bgColor: '#171412',
      fgColor: '#ebe5de',
    }
  }

  return {
    bgColor: '#f1ede7',
    fgColor: '#2b241f',
  }
}

/**
 * 获取或创建 Shiki 高亮器单例
 * 首次调用时懒加载，resolve 后缓存实例供同步使用
 */
function getHighlighter(): Promise<ShikiHighlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: DEFAULT_THEMES,
      langs: DEFAULT_LANGS,
    }).then((hl) => {
      cachedHighlighter = hl
      return hl
    })
  }
  return highlighterPromise
}

/**
 * 解析语言别名，返回有效的 Shiki 语言标识
 * 未知语言返回 'text'
 */
function resolveLanguage(lang: string): string {
  const normalized = lang.toLowerCase().trim()
  const resolved = LANGUAGE_ALIASES[normalized] ?? normalized

  if (resolved === 'text') return 'text'
  if (resolved in bundledLanguages) return resolved
  return 'text'
}

/**
 * 解析同步路径可用的语言。
 * 未知语言回退到 text；已知但尚未加载的语言返回 null，交给异步路径按需加载。
 */
function resolveLoadedLanguage(highlighter: ShikiHighlighter, lang: string): string | null {
  const resolved = resolveLanguage(lang)
  if (resolved === 'text') return 'text'
  return highlighter.getLoadedLanguages().includes(resolved) ? resolved : null
}

/**
 * 解析语言别名并按需加载，返回可直接使用的语言标识
 * 未知语言自动 fallback 到 'text'
 */
async function resolveAndLoadLanguage(highlighter: ShikiHighlighter, lang: string): Promise<string> {
  const resolved = resolveLanguage(lang)

  if (resolved === 'text') return 'text'
  if (highlighter.getLoadedLanguages().includes(resolved)) return resolved

  const pendingLoad = languageLoadPromises.get(resolved)
  if (pendingLoad) return pendingLoad

  const loadPromise = highlighter
    .loadLanguage(resolved as BundledLanguage)
    .then(() => resolved)
    .catch(() => {
      console.warn(`[shiki-service] 加载语言 "${resolved}" 失败，回退到 text`)
      return 'text'
    })

  languageLoadPromises.set(resolved, loadPromise)
  try {
    return await loadPromise
  } finally {
    if (languageLoadPromises.get(resolved) === loadPromise) {
      languageLoadPromises.delete(resolved)
    }
  }
}

/**
 * 异步高亮代码，返回 HTML 字符串（首次初始化 + 按需加载语言时使用）
 */
export async function highlightCode(options: HighlightOptions): Promise<HighlightResult> {
  const { code, language, theme = DEFAULT_THEME } = options

  const highlighter = await getHighlighter()
  const resolvedLang = await resolveAndLoadLanguage(highlighter, language)

  const html = highlighter.codeToHtml(code, {
    lang: resolvedLang as BundledLanguage,
    theme: theme as BundledTheme,
  })

  return { html, language: resolvedLang }
}

/**
 * 同步高亮代码，返回 HTML 字符串
 * 返回 null 表示高亮器尚未初始化，或目标语言仍需异步加载
 */
export function highlightCodeSync(options: HighlightOptions): HighlightResult | null {
  if (!cachedHighlighter) return null

  const { code, language, theme = DEFAULT_THEME } = options
  const lang = resolveLoadedLanguage(cachedHighlighter, language)
  if (!lang) return null

  const html = cachedHighlighter.codeToHtml(code, {
    lang: lang as BundledLanguage,
    theme: theme as BundledTheme,
  })

  return { html, language: lang }
}

/**
 * 同步高亮代码，返回按行 token 结构（适合 React 逐行渲染，流式最优）
 *
 * 相比 highlightCodeSync 返回 HTML 字符串：
 * - 返回结构化 token 数据，由调用方渲染为 React 元素
 * - 配合稳定 key 实现增量 DOM 更新，流式输出只更新变化的行
 * - 返回 null 表示高亮器尚未初始化，或目标语言仍需异步加载
 */
export function highlightToTokens(options: HighlightOptions): HighlightTokensResult | null {
  if (!cachedHighlighter) return null

  const { code, language, theme = DEFAULT_THEME } = options
  const lang = resolveLoadedLanguage(cachedHighlighter, language)
  if (!lang) return null
  const fallbackColors = resolveThemeFallbackColors(theme)

  const result = cachedHighlighter.codeToTokens(code, {
    lang: lang as BundledLanguage,
    theme: theme as BundledTheme,
  })

  return {
    lines: result.tokens.map((line) =>
      line.map((token) => ({ content: token.content, color: token.color }))
    ),
    bgColor: result.bg ?? fallbackColors.bgColor,
    fgColor: result.fg ?? fallbackColors.fgColor,
    language: lang,
  }
}
