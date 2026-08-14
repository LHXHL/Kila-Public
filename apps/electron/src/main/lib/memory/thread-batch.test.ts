import { describe, expect, test } from 'bun:test'
import type { MemoryDistillThreadMessage } from './types'
import { chunkThreadMessages } from './thread-batch'

function msg(content: string, role: 'user' | 'assistant' = 'user'): MemoryDistillThreadMessage {
  return { role, content }
}

describe('线程消息分批', () => {
  test('Given 空消息列表，When 分批，Then 返回空批次', () => {
    expect(chunkThreadMessages([])).toEqual([])
  })

  test('Given 消息数少于批次上限，When 分批，Then 单批且 endSeq 等于消息总数', () => {
    const messages = [msg('a'), msg('b'), msg('c')]
    const batches = chunkThreadMessages(messages)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toEqual({ endSeq: 3, messages })
  })

  test('Given 消息数超过批次上限，When 分批，Then 按上限切批且 endSeq 连续推进', () => {
    const messages = Array.from({ length: 25 }, (_, i) => msg(`m${i}`))
    const batches = chunkThreadMessages(messages)
    expect(batches).toHaveLength(3) // 10 + 10 + 5
    expect(batches.map((batch) => batch.endSeq)).toEqual([10, 20, 25])
    expect(batches.map((batch) => batch.messages.length)).toEqual([10, 10, 5])
  })

  test('Given 单条消息超过字符上限，When 分批，Then 该消息单独成批', () => {
    const big = msg('x'.repeat(200_000))
    const messages = [msg('a'), big, msg('b', 'assistant')]
    const batches = chunkThreadMessages(messages, { size: 10, maxChars: 100_000 })
    expect(batches).toHaveLength(3)
    expect(batches[0]!.messages).toEqual([msg('a')])
    expect(batches[1]!.messages).toEqual([big])
    expect(batches[2]!.messages).toEqual([msg('b', 'assistant')])
    expect(batches.map((batch) => batch.endSeq)).toEqual([1, 2, 3])
  })

  test('Given 消息累积超过字符上限，When 分批，Then 在超限前切批', () => {
    const messages = [
      msg('x'.repeat(60_000)),
      msg('y'.repeat(60_000)),
      msg('z'.repeat(60_000)),
    ]
    const batches = chunkThreadMessages(messages, { size: 10, maxChars: 100_000 })
    // 60k + 60k > 100k，三条各自成批
    expect(batches).toHaveLength(3)
    expect(batches.map((batch) => batch.endSeq)).toEqual([1, 2, 3])
  })

  test('Given 恰好等于批次上限，When 分批，Then 单批切出且 endSeq 正确', () => {
    const messages = Array.from({ length: 10 }, (_, i) => msg(`m${i}`))
    const batches = chunkThreadMessages(messages)
    expect(batches).toHaveLength(1)
    expect(batches[0]!.endSeq).toBe(10)
  })
})
