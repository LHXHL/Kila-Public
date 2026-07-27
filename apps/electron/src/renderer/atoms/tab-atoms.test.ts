import { describe, expect, test } from 'bun:test'
import { focusTab, type SplitLayoutState } from './tab-atoms'

const twoPaneLayout: SplitLayoutState = {
  mode: 'horizontal-2',
  panels: [
    { index: 0, activeTabId: 'session-a' },
    { index: 1, activeTabId: null },
  ],
  focusedPanelIndex: 1,
}

describe('分屏标签定位', () => {
  test('Given 空 Pane 已聚焦 When 选择另一个 Pane 的标签 Then 移动标签且不重复渲染', () => {
    const result = focusTab(twoPaneLayout, 'session-a')

    expect(result.focusedPanelIndex).toBe(1)
    expect(result.panels.map((panel) => panel.activeTabId)).toEqual([null, 'session-a'])
  })

  test('Given 两个 Pane 均有会话 When 选择已显示标签 Then 只切换焦点', () => {
    const layout: SplitLayoutState = {
      ...twoPaneLayout,
      panels: [
        { index: 0, activeTabId: 'session-a' },
        { index: 1, activeTabId: 'session-b' },
      ],
    }

    const result = focusTab(layout, 'session-a')
    expect(result.focusedPanelIndex).toBe(0)
    expect(result.panels).toEqual(layout.panels)
  })
})
