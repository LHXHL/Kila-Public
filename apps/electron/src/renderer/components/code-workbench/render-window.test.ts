import { describe, expect, test } from 'bun:test'
import { getCodeViewerVisibleLineCount } from './CodeViewer'
import { getDiffViewerVisibleLineCount } from './DiffViewer'

describe('代码工作台大文件渲染窗口', () => {
  test('Given 万行代码文件 When 初次打开 Then 只挂载首批 800 行', () => {
    expect(getCodeViewerVisibleLineCount(10_000, 800)).toBe(800)
    expect(getCodeViewerVisibleLineCount(10_000, 1_600)).toBe(1_600)
  })

  test('Given 大型 Diff When 初次打开 Then 只挂载首批 800 行', () => {
    expect(getDiffViewerVisibleLineCount(12_000, 800)).toBe(800)
    expect(getDiffViewerVisibleLineCount(12_000, 2_400)).toBe(2_400)
  })

  test('Given 小文件 When 打开 Then 不制造额外空白行', () => {
    expect(getCodeViewerVisibleLineCount(120, 800)).toBe(120)
    expect(getDiffViewerVisibleLineCount(60, 800)).toBe(60)
  })
})
