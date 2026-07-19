import { describe, expect, test } from 'bun:test'
import {
  assertNumber,
  assertSessionId,
  validateSessionMessagesPageInput,
  validateSessionProjectFilesSaveInput,
  validateSessionSearchInput,
} from './validation'

describe('Session IPC 输入校验', () => {
  test('分页参数只接受有界整数', () => {
    expect(validateSessionMessagesPageInput({ sessionId: 'session-1' })).toEqual({
      sessionId: 'session-1',
      offset: undefined,
      limit: undefined,
    })
    expect(
      validateSessionMessagesPageInput({
        sessionId: 'session-1',
        offset: 20,
        limit: 200,
      })
    ).toEqual({ sessionId: 'session-1', offset: 20, limit: 200 })

    expect(() =>
      validateSessionMessagesPageInput({ sessionId: 'session-1', offset: -1 })
    ).toThrow('offset 不能小于 0')
    expect(() =>
      validateSessionMessagesPageInput({ sessionId: 'session-1', limit: 201 })
    ).toThrow('limit 不能大于 200')
    expect(() =>
      validateSessionMessagesPageInput({ sessionId: 'session-1', limit: 1.5 })
    ).toThrow('limit 必须是整数')
  })

  test('最近消息数量拒绝无限值和超大值', () => {
    expect(
      assertNumber(500, 'limit', { min: 1, max: 500, integer: true })
    ).toBe(500)
    expect(() =>
      assertNumber(Number.POSITIVE_INFINITY, 'limit', {
        min: 1,
        max: 500,
        integer: true,
      })
    ).toThrow('limit 必须是有限数字')
    expect(() =>
      assertNumber(501, 'limit', { min: 1, max: 500, integer: true })
    ).toThrow('limit 不能大于 500')
  })

  test('搜索输入限制查询长度和每类结果数', () => {
    expect(
      validateSessionSearchInput({ query: 'message: Pi retry', limitPerType: 20 })
    ).toEqual({ query: 'message: Pi retry', limitPerType: 20 })
    expect(() =>
      validateSessionSearchInput({ query: 'x'.repeat(1001) })
    ).toThrow('query 过长')
    expect(() =>
      validateSessionSearchInput({ query: 'Pi', limitPerType: 51 })
    ).toThrow('limitPerType 不能大于 50')
  })

  test('项目文件保存复用文件名和负载上限校验', () => {
    expect(
      validateSessionProjectFilesSaveInput({
        sessionId: 'session-1',
        files: [{ filename: 'chart.html', data: '<html />' }],
      })
    ).toEqual({
      sessionId: 'session-1',
      files: [{ filename: 'chart.html', data: '<html />' }],
    })

    expect(() =>
      validateSessionProjectFilesSaveInput({
        sessionId: 'session-1',
        files: [{ filename: '../escape.html', data: 'x' }],
      })
    ).toThrow('filename 无效')
  })

  test('Session ID 必须非空且有界', () => {
    expect(assertSessionId('session-1')).toBe('session-1')
    expect(() => assertSessionId('  ')).toThrow('sessionId 不能为空')
    expect(() => assertSessionId('x'.repeat(129))).toThrow('sessionId 过长')
  })
})
