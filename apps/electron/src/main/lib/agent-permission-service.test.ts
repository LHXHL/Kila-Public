import { describe, expect, test } from 'bun:test'
import type { PermissionRequest } from '@kila/shared'
import {
  AgentPermissionService,
  type CanUseToolOptions,
  type PermissionResolution,
} from './agent-permission-service'

function options(): CanUseToolOptions {
  return {
    signal: new AbortController().signal,
    toolUseID: 'tool-use-id',
  }
}

describe('agent permission tool-name normalization', () => {
  test('Given Pi 小写只读工具，When smart 权限判断，Then 自动允许且不产生请求', async () => {
    const service = new AgentPermissionService()
    const requests: unknown[] = []
    const canUseTool = service.createCanUseTool('session-read', 'smart', (request) => requests.push(request))

    const result = await canUseTool('read', { path: '/tmp/file' }, options())

    expect(result.behavior).toBe('allow')
    expect(requests).toHaveLength(0)
  })

  test('Given Pi 小写 Bash 安全命令，When smart 权限判断，Then 自动允许', async () => {
    const service = new AgentPermissionService()
    const requests: unknown[] = []
    const canUseTool = service.createCanUseTool('session-bash', 'smart', (request) => requests.push(request))

    const result = await canUseTool('bash', { command: 'git status' }, options())

    expect(result.behavior).toBe('allow')
    expect(requests).toHaveLength(0)
  })
})

describe('agent permission request lifecycle', () => {
  test('Given 待确认请求，When 运行信号中止，Then 通知渲染层移除对应权限提示', async () => {
    const service = new AgentPermissionService()
    const controller = new AbortController()
    const requests: PermissionRequest[] = []
    const resolutions: PermissionResolution[] = []
    const canUseTool = service.createCanUseTool(
      'session-abort',
      'smart',
      (request) => requests.push(request),
      undefined,
      undefined,
      (resolution) => resolutions.push(resolution),
    )

    const resultPromise = canUseTool('write', { path: '/tmp/file', content: 'test' }, {
      signal: controller.signal,
      toolUseID: 'tool-use-abort',
    })
    controller.abort()

    await expect(resultPromise).resolves.toEqual({ behavior: 'deny', message: '操作已中止' })
    expect(requests).toHaveLength(1)
    expect(resolutions).toEqual([
      expect.objectContaining({
        requestId: requests[0]!.requestId,
        sessionId: 'session-abort',
        behavior: 'deny',
        resolution: 'session_end',
      }),
    ])
  })

  test('Given 权限请求刚发往渲染层，When 立即允许，Then 主进程已能找到并完成请求', async () => {
    const service = new AgentPermissionService()
    const controller = new AbortController()
    let immediateResolution: PermissionResolution | null = null
    const canUseTool = service.createCanUseTool(
      'session-immediate',
      'smart',
      (request) => {
        immediateResolution = service.respondToPermission(request.requestId, 'allow', false)
      },
    )

    const resultPromise = canUseTool('write', { path: '/tmp/file', content: 'test' }, {
      signal: controller.signal,
      toolUseID: 'tool-use-immediate',
    })

    if (!immediateResolution) controller.abort()
    expect(immediateResolution).toEqual(expect.objectContaining({
      sessionId: 'session-immediate',
      behavior: 'allow',
      resolution: 'user',
    }))
    await expect(resultPromise).resolves.toEqual({
      behavior: 'allow',
      updatedInput: { path: '/tmp/file', content: 'test' },
    })
  })
})

describe('agent permission renderer delivery', () => {
  test('Given 渲染层通知抛错，When 权限请求创建，Then 立即拒绝且不会遗留 pending', async () => {
    const service = new AgentPermissionService()
    const resolutions: PermissionResolution[] = []
    const canUseTool = service.createCanUseTool(
      'session-delivery-error',
      'smart',
      () => { throw new Error('窗口已销毁') },
      undefined,
      undefined,
      (resolution) => resolutions.push(resolution),
    )

    await expect(canUseTool('write', { path: '/tmp/file', content: 'test' }, options())).resolves.toEqual({
      behavior: 'deny',
      message: '无法显示权限请求：窗口已销毁',
    })
    expect(resolutions).toEqual([
      expect.objectContaining({
        sessionId: 'session-delivery-error',
        behavior: 'deny',
        resolution: 'session_end',
      }),
    ])
  })
})
