import { describe, expect, test } from 'bun:test'
import { isSubagentToolName, normalizeAgentToolName } from './tool-name'

describe('Agent 工具名归一化', () => {
  test('Given Pi snake_case 工具名 When 归一化 Then 返回 Kila canonical 名称', () => {
    expect(normalizeAgentToolName('todo_write')).toBe('TodoWrite')
    expect(normalizeAgentToolName('task_create')).toBe('TaskCreate')
    expect(normalizeAgentToolName('kill_shell')).toBe('KillShell')
  })

  test('Given 未知 MCP 工具名 When 归一化 Then 保留原始名称', () => {
    expect(normalizeAgentToolName('custom.server/tool_name')).toBe('custom.server/tool_name')
  })

  test('Given lowercase 子代理工具 When 判断 Then 不会被误嵌套到其他 Task', () => {
    expect(isSubagentToolName('task')).toBe(true)
    expect(isSubagentToolName('agent')).toBe(true)
    expect(isSubagentToolName('read')).toBe(false)
  })
})
