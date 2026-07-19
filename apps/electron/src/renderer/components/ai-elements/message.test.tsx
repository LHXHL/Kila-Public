import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageResponse, UserMessageContent } from './message'

describe('UserMessageContent', () => {
  test('shrinks to the message length while keeping long JSON wrap-safe', () => {
    const html = renderToStaticMarkup(
      <UserMessageContent>
        {"{\"codex\":{\"theme\":{\"accent\":\"#339cff\",\"contrast\":45,\"fonts\":\"Inter\"}}}"}
      </UserMessageContent>
    )

    expect(html).toContain('class="relative inline-flex w-fit max-w-[min(100%,42rem)] min-w-0 flex-col rounded-xl')
    expect(html).toContain('min-w-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere]')
  })

  test('Given 用户消息包含裸 GitHub URL When 渲染 Then 显示图标与精简仓库名', () => {
    const html = renderToStaticMarkup(
      <UserMessageContent>
        {'查看 https://github.com/aithink001/Codex-Dream-Skin-Themes'}
      </UserMessageContent>
    )

    expect(html).toContain('lucide-github')
    expect(html).toContain('aithink001/Codex-Dream-Skin-Themes')
    expect(html).not.toContain('&gt;https://github.com/aithink001/Codex-Dream-Skin-Themes&lt;')
  })

  test('Given 用户消息包含项目文档链接 When 渲染 Then 生成可预览文档按钮', () => {
    const html = renderToStaticMarkup(
      <UserMessageContent basePath="/Users/test/project">
        {'已生成 [安全审计报告](./output/security-report.pdf)'}
      </UserMessageContent>
    )

    expect(html).toContain('<button')
    expect(html).toContain('title="/Users/test/project/output/security-report.pdf"')
    expect(html).toContain('安全审计报告')
  })
})


describe('MessageResponse 富链接', () => {
  test('Given GitHub Markdown 链接 When 渲染 Then 显示仓库图标和精简仓库名', () => {
    const html = renderToStaticMarkup(
      <MessageResponse>
        {'[https://github.com/aithink001/Codex-Dream-Skin-Themes](https://github.com/aithink001/Codex-Dream-Skin-Themes)'}
      </MessageResponse>
    )

    expect(html).toContain('lucide-github')
    expect(html).toContain('aithink001/Codex-Dream-Skin-Themes')
    expect(html).toContain('rounded-md')
  })

  test('Given 项目内输出文档链接 When 渲染 Then 生成可点击的文档按钮', () => {
    const html = renderToStaticMarkup(
      <MessageResponse basePath="/Users/test/project">
        {'[安全审计报告](./output/security-report.pdf)'}
      </MessageResponse>
    )

    expect(html).toContain('<button')
    expect(html).toContain('title="/Users/test/project/output/security-report.pdf"')
    expect(html).toContain('安全审计报告')
    expect(html).toContain('PDF')
  })

  test('Given Markdown 文件链接被换行打断 When 渲染 Then 仍显示文件链接图标', () => {
    const html = renderToStaticMarkup(
      <MessageResponse basePath="/Users/test/project">
        {'[analysis.md]\n(file:///Users/test/project/analysis.md)'}
      </MessageResponse>
    )

    expect(html).toContain('<button')
    expect(html).toContain('lucide-file-text')
    expect(html).toContain('title="/Users/test/project/analysis.md"')
  })

  test('Given Markdown 文件链接被包进代码围栏 When 渲染 Then 显示文件链接图标而不是代码块', () => {
    const html = renderToStaticMarkup(
      <MessageResponse basePath="/Users/test/project">
        {'```markdown\n[analysis.md](file:///Users/test/project/analysis.md)\n```'}
      </MessageResponse>
    )

    expect(html).toContain('<button')
    expect(html).toContain('lucide-file-text')
    expect(html).toContain('title="/Users/test/project/analysis.md"')
    expect(html).not.toContain('<pre')
  })

  test('Given 多种输出文件链接被包进 Markdown 代码围栏 When 渲染 Then 全部显示对应文件图标', () => {
    const markdown = [
      '```markdown',
      '[report.pdf](file:///Users/test/project/report.pdf)',
      '[sheet.xlsx](file:///Users/test/project/sheet.xlsx)',
      '[slides.pptx](file:///Users/test/project/slides.pptx)',
      '[preview.png](file:///Users/test/project/preview.png)',
      '[demo.mp4](file:///Users/test/project/demo.mp4)',
      '[source.ts](file:///Users/test/project/source.ts)',
      '```',
    ].join('\n')
    const html = renderToStaticMarkup(
      <MessageResponse basePath="/Users/test/project">{markdown}</MessageResponse>
    )

    expect(html).toContain('lucide-file-text')
    expect(html).toContain('lucide-file-spreadsheet')
    expect(html).toContain('lucide-presentation')
    expect(html).toContain('lucide-file-image')
    expect(html).toContain('lucide-file-video')
    expect(html).toContain('lucide-file-code2')
    expect(html).not.toContain('<pre')
  })

})
