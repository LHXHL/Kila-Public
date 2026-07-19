import { describe, expect, test } from 'bun:test'
import {
  createRichLinkPresentation,
  resolveLocalLinkPath,
  transformMarkdownUrl,
} from './rich-link-presentation'

describe('富链接展示规则', () => {
  test('Given GitHub 仓库链接 When 生成展示信息 Then 使用仓库名与 GitHub 类型', () => {
    const result = createRichLinkPresentation(
      'https://github.com/aithink001/Codex-Dream-Skin-Themes',
      'https://github.com/aithink001/Codex-Dream-Skin-Themes',
    )

    expect(result.kind).toBe('github')
    expect(result.label).toBe('aithink001/Codex-Dream-Skin-Themes')
    expect(result.isExternal).toBe(true)
  })

  test('Given 在线 PDF 文档 When 生成展示信息 Then 使用文档类型并保留自定义标题', () => {
    const result = createRichLinkPresentation(
      'https://example.com/reports/security-review.pdf',
      '安全审计报告',
    )

    expect(result.kind).toBe('document')
    expect(result.label).toBe('安全审计报告')
    expect(result.meta).toBe('example.com')
  })

  test('Given Google Docs 链接 When 没有有意义的标题 Then 识别为在线文档', () => {
    const result = createRichLinkPresentation(
      'https://docs.google.com/document/d/abc123/edit',
      'https://docs.google.com/document/d/abc123/edit',
    )

    expect(result.kind).toBe('document')
    expect(result.label).toBe('Google Docs')
  })

  test('Given 相对输出文档链接 When 提供项目目录 Then 解析为项目内文件', () => {
    expect(resolveLocalLinkPath('./reports/result.docx', '/Users/test/project')).toBe(
      '/Users/test/project/reports/result.docx',
    )
  })

  test('Given file URI When 解析本地文档 Then 解码空格并得到绝对路径', () => {
    expect(resolveLocalLinkPath(
      'file:///Users/test/project/output/security%20report.pdf',
      '/Users/test/project',
    )).toBe('/Users/test/project/output/security report.pdf')
  })

  test('Given 危险协议 When Markdown 转换链接 Then 清空地址', () => {
    expect(transformMarkdownUrl('javascript:alert(1)', 'href')).toBe('')
    expect(transformMarkdownUrl('data:text/html,boom', 'href')).toBe('')
  })

  test('Given 本地 file URI When Markdown 转换链接 Then 仅对 href 保留', () => {
    const url = 'file:///Users/test/project/report.md'
    expect(transformMarkdownUrl(url, 'href')).toBe(url)
    expect(transformMarkdownUrl(url, 'src')).toBe('')
  })
})
