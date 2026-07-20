import { describe, expect, test } from 'bun:test'
import { normalizeAnthropicBaseUrlForSdk } from './url-utils'

describe('Anthropic SDK Base URL 规范化', () => {
  test('Given Base URL 已包含 v1 When 交给 SDK Then 去除版本路径避免重复追加', () => {
    expect(normalizeAnthropicBaseUrlForSdk('https://api.example.com/v1')).toBe('https://api.example.com')
  })

  test('Given 网关路径包含 v1/messages When 交给 SDK Then 保留网关根路径', () => {
    expect(normalizeAnthropicBaseUrlForSdk('https://gateway.example.com/anthropic/v1/messages')).toBe(
      'https://gateway.example.com/anthropic',
    )
  })
})
