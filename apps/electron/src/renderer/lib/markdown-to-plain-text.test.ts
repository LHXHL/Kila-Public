import { describe, expect, test } from 'bun:test'
import { markdownToPlainText } from './markdown-to-plain-text'

describe('markdown 转纯文本', () => {
  test('Given 空字符串 When 转换 Then 返回空串', () => {
    expect(markdownToPlainText('')).toBe('')
    expect(markdownToPlainText('   \n  ')).toBe('')
  })

  test('Given 标题语法 When 转换 Then 去掉 # 前缀保留文字', () => {
    expect(markdownToPlainText('# 标题一')).toBe('标题一')
    expect(markdownToPlainText('## 二级标题')).toBe('二级标题')
  })

  test('Given 强调语法 When 转换 Then 去掉 ** 与 * 标记保留文字', () => {
    expect(markdownToPlainText('这是 **加粗** 与 *斜体*')).toBe('这是 加粗 与 斜体')
  })

  test('Given 代码围栏 When 转换 Then 去掉围栏保留代码内容', () => {
    const md = ['```js', 'const x = 1', '```'].join('\n')
    const out = markdownToPlainText(md)
    expect(out).toContain('const x = 1')
    expect(out).not.toContain('```')
  })

  test('Given 行内代码 When 转换 Then 去掉反引号保留内容', () => {
    expect(markdownToPlainText('调用 `foo()` 函数')).toBe('调用 foo() 函数')
  })

  test('Given 链接语法 When 转换 Then 保留显示文本去掉 URL', () => {
    const out = markdownToPlainText('[Kila 官网](https://kila.dev)')
    expect(out).toBe('Kila 官网')
  })

  test('Given 无序列表 When 转换 Then 保留列表项结构', () => {
    const md = '- 第一项\n- 第二项\n- 第三项'
    const out = markdownToPlainText(md)
    expect(out).toContain('第一项')
    expect(out).toContain('第二项')
    expect(out).toContain('第三项')
  })

  test('Given 段落与换行 When 转换 Then 多余空行折叠为最多两行', () => {
    const md = '段落一\n\n\n\n段落二'
    const out = markdownToPlainText(md)
    expect(out).toBe('段落一\n\n段落二')
  })

  test('Given 复合文档 When 转换 Then 全部语法符号被剥离', () => {
    const md = [
      '# 项目说明',
      '',
      '这是一个 **示例**，详见 [文档](https://example.com)。',
      '',
      '```',
      'npm install',
      '```',
    ].join('\n')
    const out = markdownToPlainText(md)
    expect(out).not.toContain('#')
    expect(out).not.toContain('**')
    expect(out).not.toContain('```')
    expect(out).not.toContain('https://example.com')
    expect(out).toContain('项目说明')
    expect(out).toContain('示例')
    expect(out).toContain('文档')
    expect(out).toContain('npm install')
  })
})
