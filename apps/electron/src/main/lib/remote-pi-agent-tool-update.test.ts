import { describe, expect, test } from 'bun:test'
import { RuntimeToolUpdateAggregator } from './remote-pi-agent-tool-update'

describe('RuntimeToolUpdateAggregator', () => {
  test('Given 短时间内多条小增量 When flush Then 合并为一条并保持顺序', async () => {
    const updates: string[] = []
    const aggregator = new RuntimeToolUpdateAggregator(async (text) => {
      updates.push(text)
    })

    await aggregator.push('first')
    await aggregator.push('second')
    await aggregator.close()

    expect(updates).toEqual(['firstsecond'])
  })

  test('Given 累计增量达到 32KiB When push Then 立即 flush', async () => {
    const updates: string[] = []
    const aggregator = new RuntimeToolUpdateAggregator(async (text) => {
      updates.push(text)
    })

    await aggregator.push('x'.repeat(32 * 1024))

    expect(updates).toEqual(['x'.repeat(32 * 1024)])
  })

  test('Given ACK 发送失败 When 后续继续 push Then 保留失败并拒绝新增量', async () => {
    const aggregator = new RuntimeToolUpdateAggregator(async () => {
      throw new Error('ack failed')
    })

    await expect(aggregator.push('x'.repeat(32 * 1024))).rejects.toThrow('ack failed')
    await expect(aggregator.push('later')).rejects.toThrow('ack failed')
  })
})
