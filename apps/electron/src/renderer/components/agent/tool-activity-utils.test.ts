import { describe, expect, test } from 'bun:test'
import type { ToolActivity } from '@/atoms/agent-atoms'
import {
  compactAdjacentToolActivities,
  formatElapsed,
  getInputSummary,
  getRenderedToolResult,
  isCompactActivityGroup,
  normalizeToolName,
} from './tool-activity-utils'

function activity(id: string, toolName: string, input: Record<string, unknown> = {}): ToolActivity {
  return { toolUseId: id, toolName, input, done: true }
}

describe('工具活动兼容与压缩', () => {
  test('Given Pi snake_case 工具名 When 归一化 Then 使用现有展示语义', () => {
    expect(normalizeToolName('todo_write')).toBe('TodoWrite')
    expect(normalizeToolName('task_create')).toBe('TaskCreate')
    expect(normalizeToolName('web_search')).toBe('WebSearch')
    expect(getInputSummary('notebook_edit', { notebook_path: '/tmp/demo.ipynb' })).toBe('demo.ipynb')
  })

  test('Given 三个连续同类工具 When 压缩 Then 保留全部可展开子项', () => {
    const result = compactAdjacentToolActivities([
      activity('1', 'read', { file_path: '/a.ts' }),
      activity('2', 'Read', { file_path: '/b.ts' }),
      activity('3', 'read', { file_path: '/c.ts' }),
    ])

    expect(result).toHaveLength(1)
    expect(isCompactActivityGroup(result[0]!)).toBe(true)
    if (!isCompactActivityGroup(result[0]!)) throw new Error('应形成紧凑分组')
    expect(result[0].activities.map((item) => item.toolUseId)).toEqual(['1', '2', '3'])
  })

  test('Given snake_case TodoWrite When 压缩 Then 不隐藏专属任务列表', () => {
    const result = compactAdjacentToolActivities([
      activity('1', 'todo_write', { todos: [] }),
      activity('2', 'todo_write', { todos: [] }),
      activity('3', 'todo_write', { todos: [] }),
    ])

    expect(result).toHaveLength(3)
  })

  test('Given 超大工具结果 When 预览与展开 Then DOM 文本始终受限且保留完整复制语义', () => {
    const result = 'x'.repeat(150_000)

    const preview = getRenderedToolResult(result, false)
    const expanded = getRenderedToolResult(result, true)

    expect(preview.truncated).toBe(true)
    expect(preview.text.length).toBeLessThan(2_100)
    expect(expanded.truncated).toBe(true)
    expect(expanded.text.length).toBeLessThan(100_100)
  })

  test('Given 非法耗时 When 格式化 Then 不显示 NaN 或 Infinity', () => {
    expect(formatElapsed(Number.NaN)).toBe('—')
    expect(formatElapsed(Number.POSITIVE_INFINITY)).toBe('—')
    expect(formatElapsed(-1)).toBe('—')
  })
})
