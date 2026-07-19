import { describe, expect, test } from 'bun:test'
import { buildQuickTaskTitle, normalizeQuickTaskInput } from '../lib/quick-task-input'

describe('Quick Task 输入', () => {
  test('清理首尾空白', () => {
    expect(normalizeQuickTaskInput({ prompt: '  修复测试  ' })).toEqual({
      prompt: '修复测试',
      projectPath: undefined,
      attachments: undefined,
    })
  })

  test('拒绝空任务', () => {
    expect(() => normalizeQuickTaskInput({ prompt: '   ' })).toThrow('请输入任务内容')
  })

  test('标题压缩换行并截断', () => {
    expect(buildQuickTaskTitle('第一行\n   第二行', 8)).toBe('第一行 第二行')
    expect(buildQuickTaskTitle('这是一个需要被截断的快速任务标题', 8)).toBe('这是一个需要被…')
  })
})
