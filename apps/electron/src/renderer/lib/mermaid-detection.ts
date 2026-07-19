/**
 * Mermaid 代码块智能检测
 *
 * 不仅匹配 language-mermaid / language-mmd 类名，
 * 还通过代码内容（首行关键字）自动识别未标注语言的 Mermaid 图定义。
 *
 * 关键词分两层：
 * - 低风险词（sequenceDiagram、classDiagram 等）：直接匹配，几乎无误判
 * - 歧义词（block、pie、gantt、packet）：要求独占首行或紧接 mermaid 子语法
 * - graph / flowchart：要求后跟方向关键字（TB/TD/BT/RL/LR）
 */

// ===== 低风险关键字：不常见于普通代码，可直接匹配 =====
const SAFE_START_KEYWORDS = [
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'journey',
  'gitGraph',
  'mindmap',
  'timeline',
  'quadrantChart',
  'xychart-beta',
  'block-beta',
  'packet-beta',
  'architecture',
  'architecture-beta',
  'sankey',
  'sankey-beta',
  'requirementDiagram',
  'kanban',
  'radar-beta',
  'treeView-beta',
  'treemap',
  'venn-beta',
  'ishikawa-beta',
  'wardley-beta',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment',
] as const

// ===== 歧义关键字：常见英文/代码词，需要额外上下文 =====
// block、pie、gantt、packet 作为独立关键字时太容易误判：
//   "block of code"、"pie chart data"、"gantt chart"…
// 策略：仅当它们独占首行（后面无其他词）或紧接 mermaid 子语法时才匹配。
const AMBIGUOUS_STRICT_PATTERN = /^(?:block|pie|gantt|packet)\s*$/i
// mermaid 语法中这些关键字后面可能跟特定内容：
//   pie → "pie title ..."
//   gantt → "gantt\n    dateFormat ..."
//   block → "block:name" 或 "block:ID"
//   packet → 较罕见
// 但在实际使用中，这些关键字独占首行是最常见的用法。
// 当后面跟英文单词时（如 "block of"、"pie chart"）排除。

const SAFE_START_PATTERN = new RegExp(
  `^(?:${SAFE_START_KEYWORDS.map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'i',
)
// graph / flowchart / flowchart-elk 后必须跟方向（TB/TD/BT/RL/LR），是 mermaid 强制语法
const MERMAID_DIRECTED_PATTERN = /^(?:flowchart-elk|flowchart|graph)\s+(?:TB|TD|BT|RL|LR)\b/i
const LANGUAGE_CLASS_PATTERN = /(?:^|\s)language-\S+/i
const MERMAID_LANGUAGE_CLASS_PATTERN = /(?:^|\s)language-(?:mermaid|mmd)(?:\s|$)/i
const MERMAID_DIRECTIVE_PATTERN = /^%%\{[\s\S]*\}%%$/
const MERMAID_COMMENT_PATTERN = /^%%(?!\{)/

/** 判断 language 名是否为 mermaid/mmd */
export function isMermaidLanguage(language: string): boolean {
  return /^(?:mermaid|mmd)$/i.test(language.trim())
}

/** 通过首行关键字判断代码内容是否像 Mermaid 定义 */
export function looksLikeMermaidDefinition(code: string): boolean {
  for (const line of code.trimStart().split(/\r?\n/)) {
    const candidate = line.trim()
    if (!candidate || MERMAID_DIRECTIVE_PATTERN.test(candidate) || MERMAID_COMMENT_PATTERN.test(candidate)) continue
    return (
      MERMAID_DIRECTED_PATTERN.test(candidate) ||
      SAFE_START_PATTERN.test(candidate) ||
      AMBIGUOUS_STRICT_PATTERN.test(candidate)
    )
  }
  return false
}

/** 是否需要进一步检查代码内容（已知 language-xxx 非 mermaid 时跳过） */
export function shouldInspectMermaidCodeBlock(className: string | undefined): boolean {
  if (className && MERMAID_LANGUAGE_CLASS_PATTERN.test(className)) return true
  if (className && LANGUAGE_CLASS_PATTERN.test(className)) return false
  return true
}

/** 综合判定：类名 + 代码内容 → 是否应渲染为 Mermaid 图 */
export function shouldRenderMermaidCodeBlock(className: string | undefined, code: string): boolean {
  if (className && MERMAID_LANGUAGE_CLASS_PATTERN.test(className)) return true
  if (className && LANGUAGE_CLASS_PATTERN.test(className)) return false
  return looksLikeMermaidDefinition(code)
}
