/**
 * Agent 工具名治理回归测试
 *
 * 覆盖两个 P0：
 * - MCP 工具不得静默顶替 Pi 内置的 read / write / edit / bash
 * - 工具合并必须「先到者保留」，冲突不能无声发生
 */

import { describe, expect, test } from 'bun:test'
import {
  collectReservedToolNames,
  ensureUniqueToolName,
  mergeAgentTools,
  normalizeToolNameKey,
  type AnyAgentTool,
} from './agent-tool-names'

/** Pi `0.82.1` createCodingTools 实际暴露的工具名（已核对 node_modules 源码） */
const PI_CODING_TOOL_NAMES = ['read', 'bash', 'edit', 'write'] as const

function createTool(name: string, marker: string): AnyAgentTool {
  return {
    name,
    label: name,
    description: marker,
    parameters: { type: 'object' } as never,
    execute: async () => ({
      content: [{ type: 'text', text: marker }],
      details: { marker },
    }),
  }
}

function toolMarker(tools: AnyAgentTool[], name: string): string | undefined {
  return tools.find((tool) => tool.name === name)?.description
}

describe('MCP 工具名与内置工具冲突', () => {
  test('Given MCP 服务器暴露 read/bash When 分配可见名 Then 降级为 {server}__{tool} 且内置名不被占用', () => {
    const usedNames = collectReservedToolNames(
      PI_CODING_TOOL_NAMES.map((name) => createTool(name, 'builtin')),
    )

    expect(ensureUniqueToolName('read', 'filesystem', usedNames)).toBe('filesystem__read')
    expect(ensureUniqueToolName('bash', 'filesystem', usedNames)).toBe('filesystem__bash')
    expect(ensureUniqueToolName('write', 'filesystem', usedNames)).toBe('filesystem__write')
    expect(ensureUniqueToolName('edit', 'filesystem', usedNames)).toBe('filesystem__edit')
  })

  test('Given MCP 工具名与内置工具只差大小写 When 分配可见名 Then 同样降级', () => {
    const usedNames = collectReservedToolNames([createTool('read', 'builtin')])

    expect(ensureUniqueToolName('Read', 'fs', usedNames)).toBe('fs__Read')
  })

  test('Given MCP 工具名不冲突 When 分配可见名 Then 保留原名', () => {
    const usedNames = collectReservedToolNames([createTool('read', 'builtin')])

    expect(ensureUniqueToolName('search_docs', 'docs', usedNames)).toBe('search_docs')
  })

  test('Given 两台服务器都叫 read When 依次分配 Then 追加序号继续降级', () => {
    const usedNames = collectReservedToolNames([createTool('read', 'builtin')])

    expect(ensureUniqueToolName('read', 'srv', usedNames)).toBe('srv__read')
    expect(ensureUniqueToolName('read', 'srv', usedNames)).toBe('srv__read_2')
    expect(ensureUniqueToolName('read', 'srv', usedNames)).toBe('srv__read_3')
  })

  test('Given 未预置内置工具名 When 分配可见名 Then 会拿走 read（说明 reservedToolNames 是必需的）', () => {
    const usedNames = new Set<string>()

    expect(ensureUniqueToolName('read', 'filesystem', usedNames)).toBe('read')
  })
})

describe('工具名归一化与预留集合', () => {
  test('Given 带空格与大写的工具名 When 归一化 Then 得到统一小写键', () => {
    expect(normalizeToolNameKey('  Read ')).toBe('read')
  })

  test('Given 内置与自定义两组工具 When 收集预留名 Then 全部归一化后入集合', () => {
    const reserved = collectReservedToolNames(
      [createTool('Read', 'coding'), createTool('bash', 'coding')],
      [createTool('web_search', 'builtin')],
      undefined,
    )

    expect([...reserved].sort()).toEqual(['bash', 'read', 'web_search'])
  })
})

describe('mergeAgentTools 冲突策略', () => {
  test('Given MCP 工具与内置 bash 同名 When 合并 Then 保留内置工具并丢弃 MCP 工具', () => {
    const merged = mergeAgentTools([
      { source: 'Pi 内置编码工具', tools: [createTool('bash', 'builtin-bash')] },
      { source: 'MCP 工具', tools: [createTool('bash', 'mcp-bash')] },
    ])

    expect(merged).toHaveLength(1)
    expect(toolMarker(merged, 'bash')).toBe('builtin-bash')
  })

  test('Given 后来来源工具名只差大小写 When 合并 Then 仍判定为冲突并保留先注册者', () => {
    const merged = mergeAgentTools([
      { source: 'Pi 内置编码工具', tools: [createTool('read', 'builtin-read')] },
      { source: 'MCP 工具', tools: [createTool('READ', 'mcp-read')] },
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0]?.name).toBe('read')
    expect(toolMarker(merged, 'read')).toBe('builtin-read')
  })

  test('Given 多来源无冲突工具 When 合并 Then 全部保留且顺序按来源先后', () => {
    const merged = mergeAgentTools([
      { source: 'Pi 内置编码工具', tools: [createTool('read', 'a'), createTool('bash', 'b')] },
      { source: 'Kila 内置工具', tools: [createTool('web_search', 'c')] },
      { source: 'MCP 工具', tools: [createTool('filesystem__read', 'd')] },
      { source: '运行时注入工具', tools: [createTool('exit_scheduled_task', 'e')] },
    ])

    expect(merged.map((tool) => tool.name)).toEqual([
      'read',
      'bash',
      'web_search',
      'filesystem__read',
      'exit_scheduled_task',
    ])
  })

  test('Given MCP 服务器暴露全套 read/write/edit/bash When 走完预留+降级+合并 Then 内置工具全部存活且 MCP 工具改名共存', () => {
    const codingTools = PI_CODING_TOOL_NAMES.map((name) => createTool(name, `builtin-${name}`))
    const usedNames = collectReservedToolNames(codingTools)

    const mcpTools = PI_CODING_TOOL_NAMES.map((name) =>
      createTool(ensureUniqueToolName(name, 'filesystem', usedNames), `mcp-${name}`))

    const merged = mergeAgentTools([
      { source: 'Pi 内置编码工具', tools: codingTools },
      { source: 'MCP 工具', tools: mcpTools },
    ])

    // 内置工具原名仍指向内置实现，没有被 MCP 顶替
    for (const name of PI_CODING_TOOL_NAMES) {
      expect(toolMarker(merged, name)).toBe(`builtin-${name}`)
    }

    // MCP 工具没有被丢弃，只是改名共存
    for (const name of PI_CODING_TOOL_NAMES) {
      expect(toolMarker(merged, `filesystem__${name}`)).toBe(`mcp-${name}`)
    }

    expect(merged).toHaveLength(PI_CODING_TOOL_NAMES.length * 2)
  })

  test('Given 某个来源为 undefined When 合并 Then 安全跳过', () => {
    const merged = mergeAgentTools([
      { source: 'Pi 内置编码工具', tools: [createTool('read', 'a')] },
      { source: '运行时注入工具', tools: undefined },
    ])

    expect(merged.map((tool) => tool.name)).toEqual(['read'])
  })
})
