import { describe, expect, test } from 'bun:test'
import { isLocalNowledgeBaseUrl, isNowledgeConfigured } from './config'

describe('Nowledge 本地配置策略', () => {
  test('Given localhost 地址，When 启用 Nowledge，Then 允许作为本地增强', () => {
    expect(isLocalNowledgeBaseUrl('http://127.0.0.1:14242')).toBe(true)
    expect(isNowledgeConfigured({
      nowledgeEnabled: true,
      nowledgeBaseUrl: 'http://127.0.0.1:14242',
    })).toBe(true)
  })

  test('Given 远程地址和 API Key，When 检查配置，Then 仍拒绝以保证数据留在本机', () => {
    expect(isNowledgeConfigured({
      nowledgeEnabled: true,
      nowledgeBaseUrl: 'https://memory.example.com',
      nowledgeApiKey: 'secret',
    })).toBe(false)
  })

  test('Given 本地服务未启用，When 检查配置，Then 不连接 Nowledge', () => {
    expect(isNowledgeConfigured({
      nowledgeEnabled: false,
      nowledgeBaseUrl: 'http://localhost:14242',
    })).toBe(false)
  })
})
