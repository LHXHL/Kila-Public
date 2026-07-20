import { describe, expect, test } from 'bun:test'
import { hasRuntimeSelectionChanged, switchesActiveRuntimeSelection } from './agent-runtime-selection'

describe('Agent 运行中渠道与模型保护', () => {
  test('Given 相同渠道和模型 When steer Then 允许复用当前 runtime', () => {
    expect(hasRuntimeSelectionChanged(
      { channelId: 'channel-a', modelId: 'model-a' },
      { channelId: 'channel-a', modelId: 'model-a' },
    )).toBe(false)
  })

  test('Given 运行中切换模型 When steer Then 拒绝发送到旧 runtime', () => {
    expect(hasRuntimeSelectionChanged(
      { channelId: 'channel-a', modelId: 'model-a' },
      { channelId: 'channel-a', modelId: 'model-b' },
    )).toBe(true)
  })

  test('Given 运行中切换渠道 When follow-up Then 拒绝发送到旧 runtime', () => {
    expect(hasRuntimeSelectionChanged(
      { channelId: 'channel-a', modelId: 'model-a' },
      { channelId: 'channel-b', modelId: 'model-a' },
    )).toBe(true)
  })
  test('Given 运行中消息未显式选择渠道模型 When 检查 Session 输入 Then 沿用当前 runtime', () => {
    expect(switchesActiveRuntimeSelection(
      { channelId: 'channel-a', modelId: 'model-a' },
      {},
    )).toBe(false)
  })

  test('Given 运行中消息显式切换模型 When 检查 Session 输入 Then 在持久化前拒绝', () => {
    expect(switchesActiveRuntimeSelection(
      { channelId: 'channel-a', modelId: 'model-a' },
      { modelId: 'model-b' },
    )).toBe(true)
  })

})
