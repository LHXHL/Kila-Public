import { describe, expect, test } from 'bun:test'
import type { AskUserRequest, PermissionRequest } from '@kila/shared'
import { countPendingRequests } from './agent-permission-atoms'

describe('全局待处理请求计数', () => {
  test('Given 权限和提问分布在多个会话 When 汇总 Then 两类请求全部计入', () => {
    const permissions = new Map<string, readonly PermissionRequest[]>([
      ['session-a', [{} as PermissionRequest]],
    ])
    const questions = new Map<string, readonly AskUserRequest[]>([
      ['session-a', [{} as AskUserRequest]],
      ['session-b', [{} as AskUserRequest]],
    ])
    expect(countPendingRequests(permissions, questions)).toBe(3)
  })
})
