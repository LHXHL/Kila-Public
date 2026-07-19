import { describe, expect, test } from 'bun:test'
import { htmlToPlainText, plainTextToDocument } from './rich-text-input-plain-text'

describe('输入框纯文本与富链接序列化', () => {
  test('Given 裸 GitHub URL When 生成编辑器文档 Then 输出可样式化的安全链接', () => {
    const html = plainTextToDocument('查看 https://github.com/aithink001/Codex-Dream-Skin-Themes')

    expect(html).toContain('data-rich-link-kind="github"')
    expect(html).toContain('data-rich-link-href="https://github.com/aithink001/Codex-Dream-Skin-Themes"')
    expect(html).toContain('>aithink001/Codex-Dream-Skin-Themes</span>')
  })

  test('Given Markdown 文档链接 When 生成编辑器文档 Then 使用标题并保留原始地址', () => {
    const html = plainTextToDocument('[安全审计报告](./output/security-report.pdf)')

    expect(html).toContain('data-rich-link-kind="document"')
    expect(html).toContain('data-rich-link-label="安全审计报告"')
    expect(html).toContain('data-rich-link-source="[安全审计报告](./output/security-report.pdf)"')
    expect(html).toContain('>安全审计报告</span>')
  })

  test('Given 富链接编辑器 HTML When 转回 plain text Then 恢复原始 Markdown 文本', () => {
    const html = plainTextToDocument('已生成 [安全审计报告](./output/security-report.pdf)')

    expect(htmlToPlainText(html)).toBe('已生成 [安全审计报告](./output/security-report.pdf)')
  })
})
