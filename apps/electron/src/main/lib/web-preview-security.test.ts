import { describe, expect, test } from 'bun:test'
import type { WebPreferences } from 'electron'
import {
  hardenWebPreviewPreferences,
  isAllowedWebPreviewAttachment,
  isAllowedWebPreviewUrl,
  WEB_PREVIEW_PARTITION,
} from './web-preview-security'

describe('web preview security policy', () => {
  test('Given http/https 地址，When 校验，Then 仅允许无内嵌凭据的网页 URL', () => {
    expect(isAllowedWebPreviewUrl('http://127.0.0.1:4173/index.html')).toBe(true)
    expect(isAllowedWebPreviewUrl('https://example.com/docs')).toBe(true)
    expect(isAllowedWebPreviewUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedWebPreviewUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedWebPreviewUrl('https://user:pass@example.com')).toBe(false)
  })

  test('Given webview 附着请求，When partition 或 src 不符合策略，Then 拒绝附着', () => {
    expect(isAllowedWebPreviewAttachment(WEB_PREVIEW_PARTITION, 'https://example.com')).toBe(true)
    expect(isAllowedWebPreviewAttachment(WEB_PREVIEW_PARTITION, 'about:blank')).toBe(true)
    expect(isAllowedWebPreviewAttachment('persist:shared', 'https://example.com')).toBe(false)
    expect(isAllowedWebPreviewAttachment(WEB_PREVIEW_PARTITION, 'file:///tmp/a.html')).toBe(false)
  })

  test('Given 来宾尝试注入宽松偏好，When 加固，Then 删除 preload 并强制隔离沙箱', () => {
    const preferences = {
      preload: '/tmp/evil.js',
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      experimentalFeatures: true,
      safeDialogs: false,
    } as WebPreferences

    hardenWebPreviewPreferences(preferences)

    expect(preferences).toMatchObject({
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      safeDialogs: true,
    })
    expect(preferences.preload).toBeUndefined()
  })
})
