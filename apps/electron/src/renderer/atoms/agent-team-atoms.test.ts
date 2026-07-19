import { describe, expect, test } from 'bun:test'
import type { AgentMessage } from '@kila/shared'
import { buildTeamActivityEntries, extractTeamOverview, rebuildTeamDataFromMessages } from './agent-team-atoms'
import type { ToolActivity } from './agent-stream-atoms'

function activity(toolUseId: string, toolName: string, input: Record<string, unknown>, result?: string): ToolActivity {
  return { toolUseId, toolName, input, result, done: true }
}

describe('Pi 工具名与 Team UI 兼容', () => {
  test('Given Pi lowercase task/agent When 构建 Team 条目 Then 正常识别子代理', () => {
    const entries = buildTeamActivityEntries([
      activity('task-1', 'task', { description: '并行审计' }),
      { ...activity('read-1', 'read', { file_path: '/tmp/a.ts' }), parentToolUseId: 'task-1' },
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ toolName: 'Task', description: '并行审计' })
    expect(entries[0]?.childActivities).toHaveLength(1)
  })

  test('Given snake_case Team/Task 工具 When 提取 Overview Then 看板信息不丢失', () => {
    const overview = extractTeamOverview([
      activity('team', 'team_create', { team_name: '审计组', description: '全量检查' }),
      activity('create', 'task_create', { subject: '检查 Pi' }, 'Task #7 created'),
      activity('update', 'task_update', { taskId: '7', status: 'completed' }),
    ])

    expect(overview).toEqual({
      teamName: '审计组',
      teamDescription: '全量检查',
      tasks: [{
        taskNumber: '7',
        subject: '检查 Pi',
        description: undefined,
        activeForm: undefined,
        blockedBy: [],
        toolUseId: 'create',
        status: 'completed',
      }],
    })
  })

  test('Given 历史消息保存 lowercase tool events When 重建 Then Team 功能仍可恢复', () => {
    const messages: AgentMessage[] = [{
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      createdAt: 1,
      events: [
        { type: 'tool_start', toolUseId: 'task-1', toolName: 'task', input: { description: '恢复任务' } },
        { type: 'tool_result', toolUseId: 'task-1', toolName: 'task', result: 'done', isError: false },
      ],
    }]

    const rebuilt = rebuildTeamDataFromMessages(messages)
    expect(rebuilt?.toolActivities[0]?.toolName).toBe('Task')
    expect(rebuilt && buildTeamActivityEntries(rebuilt.toolActivities)).toHaveLength(1)
  })
})
