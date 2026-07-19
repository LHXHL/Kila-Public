import { describe, expect, test } from 'bun:test'
import { loggerInternals } from './logger'

describe('主进程日志脱敏', () => {
  test('Given 嵌套设置对象，When 写入日志，Then API Key 与 Bearer token 不可见', () => {
    const result = loggerInternals.sanitizeLogValue({
      memoryNowledgeApiKey: 'nmem_super-secret-value',
      nested: { authorization: 'Bearer abc.def.ghi', label: 'ok' },
    })
    const serialized = JSON.stringify(result)

    expect(serialized).not.toContain('super-secret-value')
    expect(serialized).not.toContain('abc.def.ghi')
    expect(serialized).toContain('[REDACTED]')
    expect(serialized).toContain('ok')
  })

  test('Given JSON 字符串和带凭证代理 URL，When 写入日志，Then 字符串内容也会脱敏', () => {
    const json = loggerInternals.sanitizeLogValue(JSON.stringify({ apiKey: 'sk-1234567890abcdef', theme: 'dark' }))
    const proxy = loggerInternals.sanitizeLogValue('proxy=http://alice:very-secret@127.0.0.1:8080')

    expect(String(json)).not.toContain('1234567890abcdef')
    expect(String(json)).toContain('dark')
    expect(String(proxy)).not.toContain('very-secret')
    expect(String(proxy)).toContain('alice:[REDACTED]@')
  })

  test('Given 循环对象，When 写入日志，Then 不抛错并标记循环引用', () => {
    const input: Record<string, unknown> = { label: 'root' }
    input.self = input

    expect(loggerInternals.sanitizeLogValue(input)).toEqual({ label: 'root', self: '[Circular]' })
  })
})
