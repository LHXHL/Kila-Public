import { describe, expect, test } from 'bun:test'
import type { BridgeChannelStatus, TelegramBridgeConfig } from '@kila/shared'
import { TelegramAdapter } from './telegram-adapter'

const baseConfig: TelegramBridgeConfig = {
  enabled: true,
  botToken: 'test-token',
  allowedUserIds: ['1001'],
  maxInboundFileBytes: 10 * 1024 * 1024,
  defaultSession: {},
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function okGetMe(): Response {
  return jsonResponse({ ok: true, result: { username: 'kila_bot' } })
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('等待条件超时')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('TelegramAdapter 毒丸更新不再无限重放', () => {
  test('Given 单条更新处理失败 When 轮询继续 Then offset 仍然推进，不会重复投递同一条消息', async () => {
    const savedOffsets: number[] = []
    let getUpdatesCalls = 0
    let adapter: TelegramAdapter | null = null

    adapter = new TelegramAdapter({
      getConfig: () => baseConfig,
      setPollOffset: (offset) => {
        savedOffsets.push(offset)
      },
      fetchImpl: async (input) => {
        const url = String(input)
        if (url.includes('/getMe')) return okGetMe()

        if (url.includes('/answerCallbackQuery')) {
          // handleUpdate 内部失败：这是历史上导致游标卡住的失败点
          return jsonResponse({ ok: false, description: 'Bad Request' }, 400)
        }

        if (url.includes('/getUpdates')) {
          getUpdatesCalls += 1
          if (getUpdatesCalls === 1) {
            return jsonResponse({
              ok: true,
              result: [{
                update_id: 5,
                callback_query: {
                  id: 'q1',
                  data: 'imbridge|allow|tok|once',
                  message: { chat: { id: '1001' } },
                  from: { id: '1001' },
                },
              }],
            })
          }
          adapter?.stop()
          return jsonResponse({ ok: true, result: [] })
        }

        return jsonResponse({ ok: true, result: [] })
      },
    })

    await adapter.start()
    await waitFor(() => savedOffsets.length > 0)
    adapter.stop()

    expect(savedOffsets).toContain(6)
  })
})

describe('TelegramAdapter 长轮询失败不谎报 connected', () => {
  test('Given 轮询请求失败 When 进入退避等待 Then 状态保持 error，不会被改回 connected', async () => {
    const statuses: BridgeChannelStatus['status'][] = []
    let adapter: TelegramAdapter | null = null

    adapter = new TelegramAdapter({
      getConfig: () => baseConfig,
      fetchImpl: async (input) => {
        const url = String(input)
        if (url.includes('/getMe')) return okGetMe()
        return jsonResponse({ ok: false, description: 'Bad Gateway' }, 502)
      },
    })

    adapter.onStatusChanged((status) => statuses.push(status.status))
    await adapter.start()
    await waitFor(() => statuses.includes('error'))

    // 旧实现会在固定 1.5s 后立刻把状态改回 connected；现在必须一直保持 error
    await new Promise((resolve) => setTimeout(resolve, 300))
    const afterError = statuses.slice(statuses.indexOf('error'))
    adapter.stop()

    expect(afterError.every((status) => status !== 'connected')).toBe(true)
  })

  test('Given 401 凭证失效 When 轮询失败 Then 停止轮询而不是重试风暴', async () => {
    let getUpdatesCalls = 0
    const adapter = new TelegramAdapter({
      getConfig: () => baseConfig,
      fetchImpl: async (input) => {
        const url = String(input)
        if (url.includes('/getMe')) return okGetMe()
        getUpdatesCalls += 1
        return jsonResponse({ ok: false, description: 'Unauthorized' }, 401)
      },
    })

    await adapter.start()
    await waitFor(() => getUpdatesCalls > 0)
    await new Promise((resolve) => setTimeout(resolve, 250))
    adapter.stop()

    expect(getUpdatesCalls).toBe(1)
  })

  test('Given 失败后恢复 When 请求成功 Then 状态回到 connected', async () => {
    const statuses: BridgeChannelStatus['status'][] = []
    let getUpdatesCalls = 0
    let adapter: TelegramAdapter | null = null

    adapter = new TelegramAdapter({
      getConfig: () => baseConfig,
      fetchImpl: async (input) => {
        const url = String(input)
        if (url.includes('/getMe')) return okGetMe()

        getUpdatesCalls += 1
        if (getUpdatesCalls === 1) return jsonResponse({ ok: false, description: 'Bad Gateway' }, 502)
        if (getUpdatesCalls > 2) adapter?.stop()
        return jsonResponse({ ok: true, result: [] })
      },
    })

    adapter.onStatusChanged((status) => statuses.push(status.status))
    await adapter.start()
    await waitFor(() => statuses.includes('error'))
    await waitFor(() => statuses.lastIndexOf('connected') > statuses.indexOf('error'), 3_000)
    adapter.stop()

    expect(statuses.lastIndexOf('connected')).toBeGreaterThan(statuses.indexOf('error'))
  })
})

describe('TelegramAdapter 权限提示不提供「总是允许」', () => {
  test('Given 发送权限提示 When 渲染按钮 Then 只保留允许一次与拒绝', async () => {
    interface TelegramPromptBody {
      reply_markup?: {
        inline_keyboard?: Array<Array<{ text: string; callback_data: string }>>
      }
    }
    let sentBody: TelegramPromptBody = {}

    const adapter = new TelegramAdapter({
      getConfig: () => baseConfig,
      fetchImpl: async (_input, init) => {
        sentBody = JSON.parse(String(init?.body ?? '{}')) as TelegramPromptBody
        return jsonResponse({ ok: true, result: {} })
      },
    })

    await adapter.sendPermissionPrompt({
      channelType: 'telegram',
      endpointKey: 'telegram:1001',
      sessionId: 's1',
      requestId: 'r1',
      toolName: 'Bash',
      description: '执行命令',
      dangerLevel: 'dangerous',
      callbackToken: 'tok',
      expiresAt: Date.now() + 10_000,
      chatId: '1001',
      promptText: '权限请求',
    })

    const buttons = sentBody.reply_markup?.inline_keyboard?.[0] ?? []

    expect(buttons.map((button) => button.text)).toEqual(['允许一次', '拒绝'])
    expect(buttons.every((button) => !button.callback_data.endsWith('|always'))).toBe(true)
  })
})
