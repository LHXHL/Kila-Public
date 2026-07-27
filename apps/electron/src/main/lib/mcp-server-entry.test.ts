/**
 * MCP 服务器条目归一化与连接指纹回归测试
 */

import { describe, expect, test } from 'bun:test'
import type { McpServerEntry } from '@kila/shared'
import {
  buildCustomMcpRegistryKey,
  buildMcpConnectionSignature,
  isCustomMcpRegistryKey,
  normalizeCustomMcpServers,
  normalizeMcpServerEntry,
} from './mcp-server-entry'

describe('MCP 条目归一化按传输类型校验必填字段', () => {
  test('Given stdio 配置缺少 command When 归一化 Then 直接拒绝并给出原因', () => {
    const result = normalizeMcpServerEntry({ type: 'stdio', enabled: true })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('command')
  })

  test('Given http 配置缺少 url When 归一化 Then 直接拒绝并给出原因', () => {
    const result = normalizeMcpServerEntry({ type: 'http', enabled: true })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('url')
  })

  test('Given sse 配置的 url 是空白串 When 归一化 Then 拒绝而不是留到 new URL 才抛错', () => {
    const result = normalizeMcpServerEntry({ type: 'sse', enabled: true, url: '   ' })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('url')
  })

  test('Given 未知传输类型 When 归一化 Then 拒绝', () => {
    expect(normalizeMcpServerEntry({ type: 'grpc', enabled: true }).ok).toBe(false)
    expect(normalizeMcpServerEntry(null).ok).toBe(false)
    expect(normalizeMcpServerEntry('stdio').ok).toBe(false)
  })

  test('Given 合法 stdio 配置 When 归一化 Then 保留 command/args/env 并默认启用', () => {
    const result = normalizeMcpServerEntry({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'some-mcp'],
      env: { FOO: 'bar', BAD: 1 },
      timeout: 12,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entry.command).toBe('npx')
    expect(result.entry.args).toEqual(['-y', 'some-mcp'])
    expect(result.entry.env).toEqual({ FOO: 'bar' })
    expect(result.entry.timeout).toBe(12)
    expect(result.entry.enabled).toBe(true)
  })
})

describe('session 级自定义 MCP 配置归一化', () => {
  test('Given 混合了非法条目 When 归一化整份配置 Then 只保留合法条目', () => {
    const servers = normalizeCustomMcpServers({
      good: { type: 'http', url: 'https://example.com/mcp', enabled: true },
      missingCommand: { type: 'stdio', enabled: true },
      unknownType: { type: 'ftp', enabled: true },
    })

    expect(Object.keys(servers)).toEqual(['good'])
  })

  test('Given 未传入自定义配置 When 归一化 Then 返回空对象', () => {
    expect(normalizeCustomMcpServers()).toEqual({})
  })
})

describe('连接指纹用于 reload 结构化对比', () => {
  const base: McpServerEntry = {
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'mcp'],
    env: { A: '1', B: '2' },
    enabled: true,
  }

  test('Given 仅 env 键顺序不同 When 生成指纹 Then 指纹相同', () => {
    const reordered: McpServerEntry = { ...base, env: { B: '2', A: '1' } }

    expect(buildMcpConnectionSignature(reordered)).toBe(buildMcpConnectionSignature(base))
  })

  test('Given 只改了 lastTestResult 与 enabled When 生成指纹 Then 指纹相同（不触发无谓重连）', () => {
    const touched: McpServerEntry = {
      ...base,
      enabled: false,
      lastTestResult: { success: true, message: 'ok', timestamp: 1 },
    }

    expect(buildMcpConnectionSignature(touched)).toBe(buildMcpConnectionSignature(base))
  })

  test('Given command / args / env / url 任一变更 When 生成指纹 Then 指纹不同', () => {
    expect(buildMcpConnectionSignature({ ...base, command: 'bunx' }))
      .not.toBe(buildMcpConnectionSignature(base))
    expect(buildMcpConnectionSignature({ ...base, args: ['-y', 'other'] }))
      .not.toBe(buildMcpConnectionSignature(base))
    expect(buildMcpConnectionSignature({ ...base, env: { A: '9' } }))
      .not.toBe(buildMcpConnectionSignature(base))
    expect(buildMcpConnectionSignature({ ...base, timeout: 60 }))
      .not.toBe(buildMcpConnectionSignature(base))
    expect(buildMcpConnectionSignature({
      type: 'http',
      url: 'https://a.example.com/mcp',
      enabled: true,
    })).not.toBe(buildMcpConnectionSignature({
      type: 'http',
      url: 'https://b.example.com/mcp',
      enabled: true,
    }))
  })
})

describe('自定义连接注册键', () => {
  test('Given sessionId 与服务器名 When 构造注册键 Then 带 custom: 前缀且可识别', () => {
    const key = buildCustomMcpRegistryKey('session-1', 'my-server')

    expect(key).toBe('custom:session-1:my-server')
    expect(isCustomMcpRegistryKey(key)).toBe(true)
  })

  test('Given 全局服务器名 When 判断注册键 Then 不属于自定义连接', () => {
    expect(isCustomMcpRegistryKey('my-server')).toBe(false)
  })
})
