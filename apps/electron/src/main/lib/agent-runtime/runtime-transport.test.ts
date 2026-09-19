import { describe, expect, test } from 'bun:test'
import { RuntimeSequenceTracker, RuntimeTransportSequenceState, assertRuntimeMessageSize } from './runtime-transport'

describe('Runtime transport sequence', () => {
  test('Given 严格递增序列 When 消费 Then 接受；重复包丢弃；跳号失步', () => {
    const tracker = new RuntimeSequenceTracker()
    expect(tracker.accept(1)).toBe('accepted')
    expect(tracker.accept(1)).toBe('duplicate')
    expect(tracker.accept(3)).toBe('desync')
    expect(tracker.nextSequence()).toBe(2)
  })

  test('Given command/control/event 三类序列 When 分别消费 Then 彼此独立', () => {
    const state = new RuntimeTransportSequenceState()
    expect(state.accept('command', 1)).toBe('accepted')
    expect(state.accept('control', 1)).toBe('accepted')
    expect(state.accept('event', 1)).toBe('accepted')
    expect(state.accept('command', 2)).toBe('accepted')
    expect(state.accept('control', 2)).toBe('accepted')
  })

  test('Given 超过 256KiB 的普通消息 When 校验 Then 返回 payload-too-large', () => {
    expect(() => assertRuntimeMessageSize({
      version: 1,
      channel: 'command',
      sequence: 1,
      type: 'test',
      payload: { text: 'x'.repeat(256 * 1024) },
    })).toThrow('runtime_protocol_payload_too_large')
  })
})

