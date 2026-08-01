import { describe, expect, test } from 'bun:test'
import { compactAgentEventsForPersistence } from './agent-events-compact'
import type { AgentEvent } from '../types'

describe('compactAgentEventsForPersistence', () => {
  describe('thinking_delta 合并', () => {
    test('Given 同段连续 thinking_delta 碎片, When 压缩, Then 合并为一条带完整 text', () => {
      // Given: 同一段（contentIndex=0）的三条碎片
      const events: AgentEvent[] = [
        { type: 'thinking_start', contentIndex: 0, timestamp: 1000, turnId: 't1' },
        { type: 'thinking_delta', contentIndex: 0, text: '好的', timestamp: 1001, turnId: 't1' },
        { type: 'thinking_delta', contentIndex: 0, text: '，用户', timestamp: 1002, turnId: 't1' },
        { type: 'thinking_delta', contentIndex: 0, text: '说', timestamp: 1003, turnId: 't1' },
        { type: 'thinking_end', contentIndex: 0, text: '', timestamp: 1004, turnId: 't1' },
      ]

      // When
      const result = compactAgentEventsForPersistence(events)

      // Then: 5 条 -> 3 条（start + 1 条聚合 delta + end）
      expect(result).toHaveLength(3)
      const deltas = result.filter((e) => e.type === 'thinking_delta')
      expect(deltas).toHaveLength(1)
      expect(deltas[0]).toMatchObject({
        type: 'thinking_delta',
        text: '好的，用户说',
        contentIndex: 0,
        turnId: 't1',
      })
    })

    test('Given 不同 contentIndex 的 thinking_delta, When 压缩, Then 各自独立不合并', () => {
      // Given: 两段思考（contentIndex 0 与 1）交替到达
      const events: AgentEvent[] = [
        { type: 'thinking_delta', contentIndex: 0, text: '段0-A', turnId: 't1' },
        { type: 'thinking_delta', contentIndex: 1, text: '段1-A', turnId: 't1' },
        { type: 'thinking_delta', contentIndex: 0, text: '段0-B', turnId: 't1' },
      ]

      // When
      const result = compactAgentEventsForPersistence(events)

      // Then: contentIndex=1 夹在中间，段0 的两条不相邻，各自保留
      const deltas = result.filter((e) => e.type === 'thinking_delta')
      expect(deltas).toHaveLength(3)
      expect(deltas.map((e) => (e as { contentIndex: number }).contentIndex)).toEqual([0, 1, 0])
    })

    test('Given 不同 turnId 的 thinking_delta, When 压缩, Then 按 turn 分段不合并', () => {
      // Given: 同 contentIndex 但分属不同 turn
      const events: AgentEvent[] = [
        { type: 'thinking_delta', contentIndex: 0, text: 'turn1', turnId: 't1' },
        { type: 'thinking_delta', contentIndex: 0, text: 'turn2', turnId: 't2' },
      ]

      // When
      const result = compactAgentEventsForPersistence(events)

      // Then: turnId 不同，视为不同段
      const deltas = result.filter((e) => e.type === 'thinking_delta')
      expect(deltas).toHaveLength(2)
    })

    test('Given thinking 段中间夹杂了 text_delta, When 压缩, Then thinking_delta 在夹杂点断开不合并', () => {
      // Given: 思考碎片之间插入了一条 text_delta
      const events: AgentEvent[] = [
        { type: 'thinking_delta', contentIndex: 0, text: '前半', turnId: 't1' },
        { type: 'text_delta', text: '正文插入' },
        { type: 'thinking_delta', contentIndex: 0, text: '后半', turnId: 't1' },
      ]

      // When
      const result = compactAgentEventsForPersistence(events)

      // Then: thinking_delta 被 text_delta 物理分隔，各自保留（首尾非连续）
      const deltas = result.filter((e) => e.type === 'thinking_delta')
      expect(deltas).toHaveLength(2)
      // text_delta 原样保留且位置不变
      expect(result[1]!.type).toBe('text_delta')
    })

    test('Given thinking_start/end 边界事件, When 压缩, Then 边界事件与 timestamp 原样保留', () => {
      // Given: 完整的思考段结构
      const events: AgentEvent[] = [
        { type: 'thinking_start', contentIndex: 0, timestamp: 1000 },
        { type: 'thinking_delta', contentIndex: 0, text: '思考内容', timestamp: 1001 },
        { type: 'thinking_end', contentIndex: 0, text: '', timestamp: 5000 },
      ]

      // When
      const result = compactAgentEventsForPersistence(events)

      // Then: 边界事件保留，timestamp 不丢失（用于「思考耗时」）
      expect(result.filter((e) => e.type === 'thinking_start')).toHaveLength(1)
      expect(result.filter((e) => e.type === 'thinking_end')).toHaveLength(1)
      expect(result.find((e) => e.type === 'thinking_start')).toMatchObject({ timestamp: 1000 })
      expect(result.find((e) => e.type === 'thinking_end')).toMatchObject({ timestamp: 5000 })
    })
  })

  describe('tool_update 合并（回归保护）', () => {
    test('Given 同一 toolUseId 的多条 tool_update, When 压缩, Then 合并为一条', () => {
      // Given: 同一命令的多次进度输出
      const events: AgentEvent[] = [
        { type: 'tool_start', toolName: 'bash', toolUseId: 'u1', input: {} },
        { type: 'tool_update', toolUseId: 'u1', partialText: 'line1\n' },
        { type: 'tool_update', toolUseId: 'u1', partialText: 'line1\nline2\n' },
        { type: 'tool_update', toolUseId: 'u1', partialText: 'line1\nline2\nline3\n' },
      ]

      // When
      const result = compactAgentEventsForPersistence(events)

      // Then: 合并为 tool_start + 一条 tool_update
      expect(result).toHaveLength(2)
      const updates = result.filter((e) => e.type === 'tool_update')
      expect(updates).toHaveLength(1)
      expect(updates[0]).toMatchObject({ partialText: 'line1\nline2\nline3\n' })
    })

    test('Given tool_update 后到达最终 tool_result, When 压缩, Then 删除中间 tool_update 只留 result', () => {
      // Given: 中间进度 + 最终结果
      const events: AgentEvent[] = [
        { type: 'tool_start', toolName: 'bash', toolUseId: 'u1', input: {} },
        { type: 'tool_update', toolUseId: 'u1', partialText: 'partial...' },
        { type: 'tool_result', toolUseId: 'u1', result: 'final', isError: false },
      ]

      // When
      const result = compactAgentEventsForPersistence(events)

      // Then: 中间 tool_update 被删除，保留 tool_start + tool_result
      expect(result).toHaveLength(2)
      expect(result.filter((e) => e.type === 'tool_update')).toHaveLength(0)
      expect(result[0]!.type).toBe('tool_start')
      expect(result[1]!.type).toBe('tool_result')
    })

    test('Given 不同 toolUseId 的 tool_update, When 压缩, Then 各自独立合并', () => {
      // Given: 两个并行工具
      const events: AgentEvent[] = [
        { type: 'tool_start', toolName: 'read', toolUseId: 'a', input: {} },
        { type: 'tool_start', toolName: 'write', toolUseId: 'b', input: {} },
        { type: 'tool_update', toolUseId: 'a', partialText: 'a1' },
        { type: 'tool_update', toolUseId: 'b', partialText: 'b1' },
        { type: 'tool_update', toolUseId: 'a', partialText: 'a1a2' },
      ]

      // When
      const result = compactAgentEventsForPersistence(events)

      // Then: 两个工具各自合并成一条 update
      const updates = result.filter((e) => e.type === 'tool_update')
      expect(updates).toHaveLength(2)
      const aUpdate = updates.find((e) => (e as { toolUseId: string }).toolUseId === 'a')
      expect(aUpdate).toMatchObject({ partialText: 'a1a2' })
    })
  })

  describe('短路优化', () => {
    test('Given 已聚合数据（delta 数 ≤ 边界事件数）, When 压缩, Then 原样返回不遍历', () => {
      // Given: 每段 delta 都已合并好，delta 数 = 边界数
      const events: AgentEvent[] = [
        { type: 'thinking_start', contentIndex: 0, timestamp: 1000 },
        { type: 'thinking_delta', contentIndex: 0, text: '完整思考', timestamp: 1001 },
        { type: 'thinking_end', contentIndex: 0, text: '', timestamp: 2000 },
        { type: 'tool_start', toolName: 'bash', toolUseId: 'u1', input: {} },
        { type: 'tool_result', toolUseId: 'u1', result: 'done', isError: false },
      ]
      // delta 数(1) ≤ 边界数(4) → 触发短路

      // When
      const result = compactAgentEventsForPersistence(events)

      // Then: 引用不同（返回新数组）但内容完全一致
      expect(result).not.toBe(events)
      expect(result).toEqual(events)
    })

    test('Given 无 delta 事件的纯边界序列, When 压缩, Then 原样返回', () => {
      // Given: 只有边界事件，无任何 delta
      const events: AgentEvent[] = [
        { type: 'turn_start', timestamp: 1000 },
        { type: 'turn_end', timestamp: 2000, toolResultCount: 0 },
      ]

      // When
      const result = compactAgentEventsForPersistence(events)

      // Then
      expect(result).toEqual(events)
    })
  })

  describe('混合场景', () => {
    test('Given 多轮 thinking + tool 交错的长序列, When 压缩, Then 各类事件按段正确合并', () => {
      // Given: 模拟真实多轮 turn
      const events: AgentEvent[] = [
        { type: 'turn_start', timestamp: 1000, turnId: 't1' },
        { type: 'thinking_start', contentIndex: 0, timestamp: 1001, turnId: 't1' },
        { type: 'thinking_delta', contentIndex: 0, text: '想', turnId: 't1' },
        { type: 'thinking_delta', contentIndex: 0, text: '一想', turnId: 't1' },
        { type: 'thinking_end', contentIndex: 0, text: '', timestamp: 1002, turnId: 't1' },
        { type: 'tool_start', toolName: 'read', toolUseId: 'u1', input: {}, turnId: 't1' },
        { type: 'tool_update', toolUseId: 'u1', partialText: 'read' },
        { type: 'tool_update', toolUseId: 'u1', partialText: 'reading' },
        { type: 'tool_result', toolUseId: 'u1', result: 'content', isError: false },
        { type: 'turn_end', timestamp: 1003, toolResultCount: 1, turnId: 't1' },
      ]

      // When
      const result = compactAgentEventsForPersistence(events)

      // Then: thinking_delta 合 1 条，中间 tool_update 被 result 删除
      expect(result.filter((e) => e.type === 'thinking_delta')).toHaveLength(1)
      expect(result.filter((e) => e.type === 'tool_update')).toHaveLength(0)
      // 边界事件齐全
      expect(result.filter((e) => e.type === 'turn_start')).toHaveLength(1)
      expect(result.filter((e) => e.type === 'turn_end')).toHaveLength(1)
      expect(result.filter((e) => e.type === 'tool_result')).toHaveLength(1)
    })
  })
})
