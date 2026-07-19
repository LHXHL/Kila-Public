import { describe, expect, test } from 'bun:test'
import { createEmptyWorkbenchState, openWorkbenchFile, openWorkbenchWidget } from './session-file-workbench-state'

describe('会话文件工作台最近记录', () => {
  test('Given 连续打开六个文件 When 更新工作台 Then 去重并只保留最近五个', () => {
    const state = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'c.ts']
      .reduce(openWorkbenchFile, createEmptyWorkbenchState())

    expect(state.recentFiles).toEqual(['c.ts', 'f.ts', 'e.ts', 'd.ts', 'b.ts'])
    expect(state.activeItem).toMatchObject({ kind: 'file', path: 'c.ts' })
  })

  test('Given 已有最近文件 When 打开 Widget Then 最近文件记录保持不变', () => {
    const withFile = openWorkbenchFile(createEmptyWorkbenchState(), 'report.md')
    const withWidget = openWorkbenchWidget(withFile, 'widget-1', '报告图表')

    expect(withWidget.recentFiles).toEqual(['report.md'])
  })
})
