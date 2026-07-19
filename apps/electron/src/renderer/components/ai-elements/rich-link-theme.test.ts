import { describe, expect, test } from 'bun:test'

const readSource = (relativePath: string) =>
  Bun.file(new URL(relativePath, import.meta.url)).text()

describe('富链接主题颜色', () => {
  test('Given Kila 主题变化 When 渲染消息与输入框链接 Then 两者共享品牌强调色 token', async () => {
    const [globalStyles, chipSource, inputSource] = await Promise.all([
      readSource('../../styles/globals.css'),
      readSource('./rich-link-chip.tsx'),
      readSource('./rich-text-input.tsx'),
    ])

    expect(globalStyles).toContain('--kila-link-chip-background: var(--brand-soft);')
    expect(globalStyles).toContain('--kila-link-chip-foreground: var(--brand-soft-foreground);')
    expect(globalStyles).toContain('--kila-link-chip-hover: var(--brand-soft-hover);')

    expect(chipSource).toContain('var(--kila-link-chip-background)')
    expect(chipSource).toContain('var(--kila-link-chip-foreground)')
    expect(chipSource).toContain('var(--kila-link-chip-hover)')
    expect(chipSource).not.toContain('var(--status-')

    const composerStyles = inputSource.slice(
      inputSource.indexOf('.composer-rich-link-chip {'),
      inputSource.indexOf('.mention-chip {'),
    )
    expect(composerStyles).toContain('var(--kila-link-chip-background)')
    expect(composerStyles).toContain('var(--kila-link-chip-foreground)')
    expect(composerStyles).toContain('var(--kila-link-chip-hover)')
    expect(composerStyles).not.toContain('var(--status-')
  })
})
