import { describe, expect, test } from 'bun:test'
import { wrapLarkWsClient } from './lark-ws-client'
import type { LarkWsClientLike } from './lark-sdk-types'

function createFakeWsClient() {
  const calls = { start: 0, close: 0, dispatchers: [] as unknown[] }
  const ws: LarkWsClientLike = {
    start: async (params) => {
      calls.start += 1
      calls.dispatchers.push(params.eventDispatcher)
    },
    close: () => {
      calls.close += 1
    },
  }
  return { ws, calls }
}

describe('wrapLarkWsClient', () => {
  test('Given lark WSClient When 调用 stop Then 走 close() 真正断开长连接', () => {
    // 回归：历史实现是 (ws as any).stop?.()，而 WSClient 只有 close()，
    // 于是断开长连接变成永不执行的空操作。
    const { ws, calls } = createFakeWsClient()

    wrapLarkWsClient(ws, {}).stop?.()

    expect(calls.close).toBe(1)
  })

  test('Given eventDispatcher When 调用 start Then 原样透传给 WSClient', async () => {
    const { ws, calls } = createFakeWsClient()
    const eventDispatcher = { marker: 'dispatcher' }

    await wrapLarkWsClient(ws, eventDispatcher).start()

    expect(calls.start).toBe(1)
    expect(calls.dispatchers[0]).toBe(eventDispatcher)
  })
})
