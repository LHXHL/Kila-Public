import { describe, expect, test } from 'bun:test'
import { FeishuAdapter } from './feishu-adapter'
import type { BridgeAdapterEvent } from './base-adapter'
import type { FeishuBridgeConfig } from '@kila/shared'

const baseConfig: FeishuBridgeConfig = {
  enabled: true,
  appId: 'cli_test',
  appSecret: 'secret',
  allowP2P: true,
  allowGroup: true,
  requireMention: true,
  defaultSession: {},
  bots: [],
}

function createClient() {
  return {
    request: async () => ({ bot: { open_id: 'ou_bot', app_name: 'Kila Bot' } }),
    im: {
      message: {
        create: async () => ({ data: { message_id: 'om_sent' } }),
        reply: async () => ({ data: { message_id: 'om_reply' } }),
        get: async () => ({ data: { items: [] } }),
      },
      chat: {
        create: async () => ({ data: { chat_id: 'oc_chat' } }),
        update: async () => ({ code: 0 }),
      },
    },
  }
}

describe('FeishuAdapter 事件解析', () => {
  test('Given SDK Channel 顶层 raw 事件 When 处理消息 Then 发出桥接入站消息', async () => {
    const adapter = new FeishuAdapter({
      botId: 'bot-1',
      getConfig: () => baseConfig,
      createClient,
      createWsClient: () => ({
        start: async () => {},
        stop: () => {},
      }),
    })

    const events: BridgeAdapterEvent[] = []
    adapter.onEvent((event) => events.push(event))

    await adapter.handleEventPayload({
      event_id: 'evt_1',
      sender: {
        sender_id: { open_id: 'ou_user' },
        sender_type: 'user',
      },
      message: {
        message_id: 'om_1',
        chat_id: 'oc_p2p',
        chat_type: 'p2p',
        message_type: 'text',
        content: JSON.stringify({ text: '你好' }),
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 700))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'message',
      message: {
        channelType: 'feishu',
        endpointKey: 'feishu:bot-1:oc_p2p',
        chatId: 'oc_p2p',
        botId: 'bot-1',
        userId: 'ou_user',
        messageId: 'om_1',
      },
    })
    expect(events[0]?.type === 'message' ? events[0].message.text : '').toContain('你好')
  })
})
