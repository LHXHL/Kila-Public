import { describe, expect, test } from 'bun:test'
import { focusTab, reorderTabs, restorePersistedTabState, type SplitLayoutState, type TabItem } from './tab-atoms'

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

describe('标签重排', () => {
  test('Given 三个标签 When 将末尾标签左移 Then 保持其余标签相对顺序', () => {
    const tabs: TabItem[] = ['a', 'b', 'c'].map((id) => ({
      id,
      type: 'agent',
      sessionId: id,
      title: id,
    }))

    expect(reorderTabs(tabs, 2, 1).map((tab) => tab.id)).toEqual(['a', 'c', 'b'])
  })
})

describe('标签工作台恢复', () => {
  test('Given 持久化状态包含重复和已删除会话 When 恢复 Then 去重并只保留有效会话', () => {
    const restored = restorePersistedTabState({
      tabs: [
        { id: 'legacy-a', type: 'agent', sessionId: 'a', title: 'A' },
        { id: 'duplicate-a', type: 'agent', sessionId: 'a', title: '重复 A' },
        { id: 'deleted', type: 'agent', sessionId: 'deleted', title: '已删除' },
      ],
      splitLayout: {
        mode: 'horizontal-2',
        panels: [
          { index: 0, activeTabId: 'legacy-a' },
          { index: 1, activeTabId: 'duplicate-a' },
        ],
        focusedPanelIndex: 9,
      },
    }, new Set(['a']))

    expect(restored?.tabs).toEqual([{ id: 'a', type: 'agent', sessionId: 'a', title: 'A' }])
    expect(restored?.splitLayout.focusedPanelIndex).toBe(1)
    expect(restored?.splitLayout.panels.map((panel) => panel.activeTabId)).toEqual([null, 'a'])
  })
})
