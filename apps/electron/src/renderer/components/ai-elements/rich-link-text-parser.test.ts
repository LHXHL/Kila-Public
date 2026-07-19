import { describe, expect, test } from 'bun:test'
import { normalizeMessageRichLinks, parseRichTextTokens } from './rich-link-text-parser'

describe('纯文本富链接分词', () => {
  test('Given 裸 GitHub URL When 分词 Then 生成链接 token 并排除句末标点', () => {
    expect(parseRichTextTokens('参考 https://github.com/aithink001/Codex-Dream-Skin-Themes。')).toEqual([
      { kind: 'text', value: '参考 ' },
      {
        kind: 'link',
        value: 'https://github.com/aithink001/Codex-Dream-Skin-Themes',
        href: 'https://github.com/aithink001/Codex-Dream-Skin-Themes',
        label: 'https://github.com/aithink001/Codex-Dream-Skin-Themes',
      },
      { kind: 'text', value: '。' },
    ])
  })

  test('Given Markdown 文档链接 When 分词 Then 保留标题和项目相对地址', () => {
    expect(parseRichTextTokens('已生成 [安全审计报告](./output/security-report.pdf)')).toEqual([
      { kind: 'text', value: '已生成 ' },
      {
        kind: 'link',
        value: '[安全审计报告](./output/security-report.pdf)',
        href: './output/security-report.pdf',
        label: '安全审计报告',
      },
    ])
  })

  test('Given Mention 中包含路径 When 分词 Then 不把文件引用拆成链接', () => {
    expect(parseRichTextTokens('@file:docs/report.md https://example.com')).toEqual([
      { kind: 'text', value: '@file:docs/report.md ' },
      {
        kind: 'link',
        value: 'https://example.com',
        href: 'https://example.com',
        label: 'https://example.com',
      },
    ])
  })

  test('Given 危险 Markdown 协议 When 分词 Then 保持为普通文本', () => {
    expect(parseRichTextTokens('[点击](javascript:alert(1))')).toEqual([
      { kind: 'text', value: '[点击](javascript:alert(1))' },
    ])
  })

  test('Given Markdown 链接的地址被换行分隔 When 规范化 Then 恢复为标准链接', () => {
    expect(normalizeMessageRichLinks(
      '[分析报告.md]\n(file:///Users/test/project/analysis.md)',
    )).toBe('[分析报告.md](file:///Users/test/project/analysis.md)')
  })

  test('Given 纯文件链接被包进 Markdown 代码围栏 When 规范化 Then 解包供富链接渲染', () => {
    expect(normalizeMessageRichLinks(
      '```markdown\n[分析报告.md](file:///Users/test/project/analysis.md)\n```',
    )).toBe('[分析报告.md](file:///Users/test/project/analysis.md)')
  })

  test('Given Markdown 代码围栏包含说明文本 When 规范化 Then 保留真实代码示例', () => {
    const source = '```markdown\n下载：[分析报告.md]\n(file:///Users/test/project/analysis.md)\n```'
    expect(normalizeMessageRichLinks(source)).toBe(source)
  })

  test('Given Markdown 代码围栏包含危险链接 When 规范化 Then 不解包', () => {
    const source = '```markdown\n[点击](javascript:alert(1))\n```'
    expect(normalizeMessageRichLinks(source)).toBe(source)
  })

})
