import { describe, expect, test } from 'bun:test'
import { patchMarkdownSection } from './working-memory-patch'

const WITH_SUBHEADING = [
  '## Focus Areas',
  '- 重构记忆子系统',
  '### 子任务',
  '- 清理 any',
  '',
  '## Notes',
  '- 其他',
].join('\n')

describe('working memory section patch 层级感知', () => {
  test('Given section 内含更深一级子标题，When 追加内容，Then 子标题内容仍留在该 section 内', () => {
    const next = patchMarkdownSection(WITH_SUBHEADING, '## Focus Areas', { append: '- 补充一条' })

    expect(next).toBe([
      '## Focus Areas',
      '- 重构记忆子系统',
      '### 子任务',
      '- 清理 any',
      '- 补充一条',
      '## Notes',
      '- 其他',
    ].join('\n'))
  })

  test('Given section 内含更深一级子标题，When 整块覆盖，Then 子标题一并被替换且后续同级 section 不受影响', () => {
    const next = patchMarkdownSection(WITH_SUBHEADING, '## Focus Areas', { content: '- 全新内容' })

    expect(next).toBe([
      '## Focus Areas',
      '- 全新内容',
      '## Notes',
      '- 其他',
    ].join('\n'))
  })

  test('Given 目标是三级标题，When 追加内容，Then 遇到同级或更高级标题才结束 section', () => {
    const source = ['## A', '### B', '- b1', '#### C', '- c1', '### D', '- d1'].join('\n')
    const next = patchMarkdownSection(source, '### B', { append: '- b2' })

    expect(next).toBe(['## A', '### B', '- b1', '#### C', '- c1', '- b2', '### D', '- d1'].join('\n'))
  })

  test('Given working memory 为空，When patch 某个 section，Then 直接生成该 section', () => {
    expect(patchMarkdownSection('', '## Focus Areas', { append: '- 第一条' }))
      .toBe('## Focus Areas\n- 第一条')
  })

  test('Given 目标 section 不存在，When patch，Then 在末尾追加新 section 而不是覆盖已有内容', () => {
    const next = patchMarkdownSection('## Notes\n- 其他', '## Focus Areas', { append: '- 新增' })
    expect(next).toBe('## Notes\n- 其他\n\n## Focus Areas\n- 新增')
  })

  test('Given heading 为空白，When patch，Then 明确报错而不是静默写坏 working memory', () => {
    expect(() => patchMarkdownSection('## Notes\n- 其他', '   ', { append: 'x' }))
      .toThrow('working memory patch heading is required')
  })
})
