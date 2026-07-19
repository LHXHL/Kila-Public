import { describe, expect, test } from 'bun:test'
import { mapRunOutcomeToCompleteReason } from './run'

describe('CLI run 终态映射', () => {
  test('Given Session outcome=stopped 且没有 Agent stopReason, Then 返回 stopped', () => {
    expect(mapRunOutcomeToCompleteReason('stopped', undefined, null)).toBe('stopped')
  })

  test('Given Session outcome=error 且已有部分正常 complete, Then 返回 error', () => {
    expect(mapRunOutcomeToCompleteReason('error', 'stop', null)).toBe('error')
  })

  test('Given Session outcome=success 且旧 stopReason 看似 abort, Then canonical outcome 优先返回 completed', () => {
    expect(mapRunOutcomeToCompleteReason('success', 'aborted', null)).toBe('completed')
  })

  test('Given 旧发送方没有 outcome, Then 兼容 stream error 与 abort stopReason', () => {
    expect(mapRunOutcomeToCompleteReason(null, undefined, '网络失败')).toBe('error')
    expect(mapRunOutcomeToCompleteReason(null, 'cancelled', null)).toBe('stopped')
    expect(mapRunOutcomeToCompleteReason(null, 'stop', null)).toBe('completed')
  })
})
