import { describe, expect, test } from 'bun:test'
import { parseUnifiedDiffLines } from './diff-lines'

describe('统一 Diff 行解析', () => {
  test('Given 带文件元信息的 hunk，When 解析，Then 元信息不会被误判为增删行', () => {
    const lines = parseUnifiedDiffLines([
      'diff --git a/demo.ts b/demo.ts',
      'index 1111111..2222222 100644',
      '--- a/demo.ts',
      '+++ b/demo.ts',
      '@@ -2,3 +2,4 @@',
      ' const stable = true',
      '-const oldValue = 1',
      '+const newValue = 2',
      '+console.log(newValue)',
      ' return stable',
      '',
    ].join('\n'))

    expect(lines.slice(0, 4).map((line) => line.kind)).toEqual(['meta', 'meta', 'meta', 'meta'])
    expect(lines.slice(4).map((line) => [line.kind, line.oldLineNumber, line.newLineNumber])).toEqual([
      ['header', null, null],
      ['context', 2, 2],
      ['deletion', 3, null],
      ['addition', null, 3],
      ['addition', null, 4],
      ['context', 4, 5],
    ])
  })

  test('Given 单行范围和无换行提示，When 解析，Then 行号继续正确且提示保持为元信息', () => {
    const lines = parseUnifiedDiffLines([
      '@@ -7 +7 @@ function demo() {',
      '-  return false',
      '\\ No newline at end of file',
      '+  return true',
      '\\ No newline at end of file',
    ].join('\n'))

    expect(lines).toEqual([
      { kind: 'header', content: '@@ -7 +7 @@ function demo() {', oldLineNumber: null, newLineNumber: null },
      { kind: 'deletion', content: '  return false', oldLineNumber: 7, newLineNumber: null },
      { kind: 'meta', content: '\\ No newline at end of file', oldLineNumber: null, newLineNumber: null },
      { kind: 'addition', content: '  return true', oldLineNumber: null, newLineNumber: 7 },
      { kind: 'meta', content: '\\ No newline at end of file', oldLineNumber: null, newLineNumber: null },
    ])
  })

  test('Given 空白上下文行，When 解析，Then 保留空内容并同时推进新旧行号', () => {
    const lines = parseUnifiedDiffLines('@@ -1,2 +1,2 @@\n \n unchanged\n')

    expect(lines[1]).toEqual({
      kind: 'context',
      content: '',
      oldLineNumber: 1,
      newLineNumber: 1,
    })
    expect(lines[2]).toMatchObject({ oldLineNumber: 2, newLineNumber: 2 })
  })
})
