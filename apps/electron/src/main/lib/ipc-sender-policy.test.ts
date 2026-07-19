import { describe, expect, test } from 'bun:test'
import { assertSafeIpcPayload, isTrustedRendererUrl } from './ipc-sender-policy'

describe('IPC sender policy', () => {
  test('Given 开发与生产 Renderer URL，When 校验，Then 仅接受固定应用入口', () => {
    expect(isTrustedRendererUrl('http://localhost:5173/?window=settings', false)).toBe(true)
    expect(isTrustedRendererUrl('http://127.0.0.1:5173/', false)).toBe(true)
    expect(isTrustedRendererUrl('http://localhost:5173.evil.test/', false)).toBe(false)
    expect(isTrustedRendererUrl('https://localhost:5173/', false)).toBe(false)
    expect(isTrustedRendererUrl('file:///Applications/Kila.app/Contents/Resources/app.asar/dist/renderer/index.html?tab=general', true)).toBe(true)
    expect(isTrustedRendererUrl('file:///tmp/preview.html', true)).toBe(false)
    expect(isTrustedRendererUrl('http://localhost:5173/', true)).toBe(false)
  })

  test('Given 异常深度或超大 IPC 参数，When 检查，Then 在业务 handler 前拒绝', () => {
    let nested: unknown = 'leaf'
    for (let index = 0; index < 30; index += 1) nested = { nested }
    expect(() => assertSafeIpcPayload([nested])).toThrow('嵌套过深')
    expect(() => assertSafeIpcPayload(['x'.repeat(8 * 1024 * 1024 + 1)])).toThrow('体积过大')
    expect(() => assertSafeIpcPayload([{ ok: ['a', 'b'] }])).not.toThrow()
  })
})
