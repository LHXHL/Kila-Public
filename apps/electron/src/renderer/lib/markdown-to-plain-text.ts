/**
 * markdown-to-plain-text
 *
 * 把 markdown 渲染成可读纯文本：去掉 #、**、代码围栏、链接 URL 等语法符号，
 * 保留标题、段落、列表等结构。用于「复制纯文本」场景，粘贴到富文本编辑器
 * 或纯文本输入框时都不含 HTML 标签与 markdown 语法残留。
 *
 * 复用 react-markdown 同款 unified + remark-gfm 管线，保证表格 / 任务列表 /
 * 删除线等 GFM 语法解析与展示一致。processor 为模块级单例，避免每次复制重建管线。
 */
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import stripMarkdown, { type Options as StripMarkdownOptions } from 'strip-markdown'
import remarkGfm from 'remark-gfm'

// keep: ['code'] 保留代码块文本（否则 strip-markdown 默认会整体删除），
// 再由后处理去掉 ``` 围栏与语言标记，只保留代码内容。
const stripOptions: StripMarkdownOptions = { keep: ['code'] }

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(stripMarkdown, stripOptions)
  .use(remarkStringify)

/**
 * 将 markdown 转换为可读纯文本。
 *
 * @param md markdown 源字符串
 * @returns 去除语法符号后的纯文本；空串或仅空白返回空串
 */
export function markdownToPlainText(md: string): string {
  if (typeof md !== 'string' || !md.trim()) return ''
  return String(processor.processSync(md))
    // 去掉代码块围栏：```lang\n...\n``` -> 代码内容
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
