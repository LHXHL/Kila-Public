import { describe, expect, test } from 'bun:test'
import type { AskUserRequest } from '@kila/shared'
import {
  AgentAskUserService,
  type AskUserResolution,
} from './agent-ask-user-service'

function askInput(): Record<string, unknown> {
  return {
    questions: [{
      question: '选择一种方式',
      header: '执行方式',
      options: [
        { label: '安全模式', description: '每次写入前确认' },
        { label: '自动模式' },
      ],
      multiSelect: false,
    }],
  }
}

describe('Agent AskUser 请求生命周期', () => {
  test('Given 请求刚发送到渲染层，When 同步立即回答，Then pending 已注册并正确注入 answers', async () => {
    const service = new AgentAskUserService()
    const controller = new AbortController()
    let request: AskUserRequest | undefined
    const responded = { sessionId: null as string | null }

    const resultPromise = service.handleAskUserQuestion(
      'session-immediate',
      askInput(),
      controller.signal,
      (nextRequest) => {
        request = nextRequest
        responded.sessionId = service.respondToAskUser(nextRequest.requestId, {
          '选择一种方式': '安全模式',
        })
      },
    )

    expect(responded.sessionId).toBe('session-immediate')
    expect(request?.createdAt).toBeNumber()
    expect(request?.expiresAt).toBeGreaterThan(request?.createdAt ?? 0)
    await expect(resultPromise).resolves.toEqual({
      behavior: 'allow',
      updatedInput: {
        ...askInput(),
        answers: { '选择一种方式': '安全模式' },
      },
    })
  })

  test('Given AskUser 正在等待，When AbortSignal 中止，Then 只结算一次并移除 pending', async () => {
    const service = new AgentAskUserService()
    const controller = new AbortController()
    const resolutions: AskUserResolution[] = []
    let requestId = ''

    const resultPromise = service.handleAskUserQuestion(
      'session-abort',
      askInput(),
      controller.signal,
      (request) => { requestId = request.requestId },
      (resolution) => resolutions.push(resolution),
    )
    controller.abort()

    await expect(resultPromise).resolves.toEqual({ behavior: 'deny', message: '操作已中止' })
    expect(service.respondToAskUser(requestId, {})).toBeNull()
    expect(resolutions).toEqual([
      expect.objectContaining({
        requestId,
        sessionId: 'session-abort',
        resolution: 'session_end',
      }),
    ])
  })

  test('Given 同一会话存在多个问题，When 清理会话，Then 全部拒绝且各自只广播一次', async () => {
    const service = new AgentAskUserService()
    const resolutions: AskUserResolution[] = []
    const first = service.handleAskUserQuestion(
      'session-clear',
      askInput(),
      new AbortController().signal,
      () => {},
      (resolution) => resolutions.push(resolution),
    )
    const second = service.handleAskUserQuestion(
      'session-clear',
      askInput(),
      new AbortController().signal,
      () => {},
      (resolution) => resolutions.push(resolution),
    )

    service.clearSessionPending('session-clear')

    await expect(first).resolves.toEqual({ behavior: 'deny', message: '会话已结束' })
    await expect(second).resolves.toEqual({ behavior: 'deny', message: '会话已结束' })
    expect(resolutions).toHaveLength(2)
    expect(resolutions.every((item) => item.resolution === 'session_end')).toBe(true)
  })

  test('Given 渲染通知发送失败，When 创建请求，Then 立即拒绝且不遗留 90 秒 pending', async () => {
    const service = new AgentAskUserService()
    const resolutions: AskUserResolution[] = []

    const result = await service.handleAskUserQuestion(
      'session-delivery-error',
      askInput(),
      new AbortController().signal,
      () => { throw new Error('窗口已销毁') },
      (resolution) => resolutions.push(resolution),
    )

    expect(result).toEqual({ behavior: 'deny', message: '无法显示交互问题：窗口已销毁' })
    expect(resolutions).toEqual([
      expect.objectContaining({
        sessionId: 'session-delivery-error',
        resolution: 'session_end',
      }),
    ])
  })

  test('Given 很短的请求超时，When 用户未回答，Then 自动拒绝并上报 timeout', async () => {
    const service = new AgentAskUserService(5)
    const resolutions: AskUserResolution[] = []

    const result = await service.handleAskUserQuestion(
      'session-timeout',
      askInput(),
      new AbortController().signal,
      () => {},
      (resolution) => resolutions.push(resolution),
    )

    expect(result).toEqual({ behavior: 'deny', message: '等待用户回答超时，已自动取消' })
    expect(resolutions).toEqual([
      expect.objectContaining({
        sessionId: 'session-timeout',
        resolution: 'timeout',
      }),
    ])
  })
})
