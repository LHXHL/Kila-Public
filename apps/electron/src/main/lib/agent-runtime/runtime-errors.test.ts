import { describe, expect, test } from 'bun:test'
import { createRuntimeTypedError, isRuntimeErrorCode } from './runtime-errors'

describe('Runtime typed error 映射', () => {
  test('Given Runtime 崩溃 When 构造 typed error Then 保留用户动作与可重试语义', () => {
    expect(createRuntimeTypedError('runtime_crashed', 'utility process 已退出')).toMatchObject({
      code: 'runtime_crashed',
      title: 'Agent Runtime 已崩溃',
      canRetry: true,
      actions: [{ action: 'retry' }],
    })
  })

  test('Given 协议版本错误 When 查询 Runtime error code Then 不降级为 provider error', () => {
    expect(isRuntimeErrorCode('runtime_protocol_mismatch')).toBe(true)
    expect(isRuntimeErrorCode('provider_error')).toBe(false)
    expect(createRuntimeTypedError('runtime_protocol_mismatch', '版本不一致').canRetry).toBe(false)
  })
})

