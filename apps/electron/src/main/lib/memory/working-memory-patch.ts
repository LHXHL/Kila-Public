/**
 * Working Memory 的 Markdown section patch（层级感知）
 *
 * section 的结束边界必须只认「同级或更高级」的 heading：
 * `## Section` 下面的 `### 子标题` 属于该 section 的正文，不能当作结束标记，
 * 否则 append 会把子标题之后的内容甩到 section 外面。
 *
 * 单独成模块是为了让 Provider 与 ProviderManager 共用同一份实现，
 * 避免出现「两份 patch、生效的是行为较差的那份」。
 */

export interface MarkdownSectionPatchInput {
  /** 整块覆盖 section 正文 */
  content?: string
  /** 在 section 正文末尾追加 */
  append?: string
}

/** 从 heading 文本推断层级；没有 `#` 前缀时按二级处理 */
function resolveHeadingLevel(heading: string): number {
  return heading.match(/^(#{1,6})\s/)?.[1]?.length ?? 2
}

function resolveNextBody(existingBody: string, input: MarkdownSectionPatchInput): string {
  return typeof input.append === 'string'
    ? [existingBody, input.append.trim()].filter(Boolean).join('\n')
    : (input.content ?? '').trim()
}

/**
 * 按 heading 定位 section 并 patch 其正文。
 *
 * - 内容为空：直接生成 `heading + 正文`
 * - heading 不存在：追加一个新 section
 * - heading 存在：只替换/追加该 section 的正文，子标题内容保持在 section 内
 */
export function patchMarkdownSection(
  currentContent: string,
  heading: string,
  input: MarkdownSectionPatchInput,
): string {
  const trimmedHeading = heading.trim()
  if (!trimmedHeading) throw new Error('working memory patch heading is required')

  const nextText = (input.append ?? input.content ?? '').trim()
  if (!currentContent.trim()) {
    return `${trimmedHeading}\n${nextText}`.trim()
  }

  const lines = currentContent.split('\n')
  const headingLc = trimmedHeading.toLowerCase()
  const targetLevel = resolveHeadingLevel(trimmedHeading)
  const startIndex = lines.findIndex((line) => line.trim().toLowerCase() === headingLc)
  if (startIndex < 0) {
    return `${currentContent.trimEnd()}\n\n${trimmedHeading}\n${nextText}`.trim()
  }

  let endIndex = lines.length
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const match = lines[index]!.match(/^(#{1,6})\s/)
    // 只有同级或更高级的 heading 才是 section 结束边界
    if (match && match[1]!.length <= targetLevel) {
      endIndex = index
      break
    }
  }

  const existingBody = lines.slice(startIndex + 1, endIndex).join('\n').trimEnd()
  return [
    ...lines.slice(0, startIndex),
    lines[startIndex]!,
    resolveNextBody(existingBody, input),
    ...lines.slice(endIndex),
  ].join('\n').trim()
}
