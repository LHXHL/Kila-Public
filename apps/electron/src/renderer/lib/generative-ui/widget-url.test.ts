import { describe, expect, test } from 'bun:test'
import {
  containsAllowedWidgetCdnUrl,
  normalizeWidgetExternalUrl,
} from './widget-url'

describe('Widget URL 边界', () => {
  test('Given 外部链接 When 协议不是 http/https Then 拒绝打开', () => {
    expect(normalizeWidgetExternalUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeWidgetExternalUrl('data:text/html,hello')).toBeNull()
    expect(normalizeWidgetExternalUrl('file:///tmp/secret')).toBeNull()
    expect(normalizeWidgetExternalUrl('/relative/path')).toBeNull()
  })

  test('Given 合法 http/https 链接 When 归一化 Then 返回绝对地址', () => {
    expect(normalizeWidgetExternalUrl('https://example.com/report')).toBe('https://example.com/report')
    expect(normalizeWidgetExternalUrl('http://localhost:3000')).toBe('http://localhost:3000/')
  })

  test('Given 伪造白名单子串 When 检测 CDN Then 不误判为受支持 CDN', () => {
    expect(containsAllowedWidgetCdnUrl('<script src="https://cdnjs.cloudflare.com.evil.test/a.js"></script>')).toBe(false)
    expect(containsAllowedWidgetCdnUrl('<script src="https://evil.test/?next=https://cdn.jsdelivr.net.evil/a.js"></script>')).toBe(false)
    expect(containsAllowedWidgetCdnUrl('<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>')).toBe(true)
  })
})
