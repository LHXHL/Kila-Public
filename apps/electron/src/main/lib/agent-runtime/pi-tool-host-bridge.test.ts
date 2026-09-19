import { describe, expect, test } from 'bun:test'
import type { AnyAgentTool } from '../agent-tool-names'
import { createPiToolHostProxies } from './pi-tool-host-bridge'
import { ToolHost } from './tool-host'
import { createToolDescriptors } from '../remote-pi-agent-helpers'

describe('Pi ToolHost bridge', () => {
  test('Given Pi tool When 经过 ToolHost proxy 执行 Then descriptor、approvedArgs 与 update 均走统一边界', async () => {
    let receivedArgs: Record<string, unknown> | undefined
    const tool = {
      name: 'read',
      label: 'Read',
      description: '读取文件',
      parameters: { type: 'object' },
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, onUpdate?: (update: { content: Array<{ type: 'text'; text: string }> }) => void) => {
        receivedArgs = params
        onUpdate?.({ content: [{ type: 'text', text: 'partial' }] })
        return {
          content: [{ type: 'text', text: 'done' }],
          details: { path: params.path },
        }
      },
    } as unknown as AnyAgentTool
    const host = new ToolHost()
    const proxy = createPiToolHostProxies(host, [{ tool, kind: 'builtin' }], {
      appBootId: 'app-1',
      bootId: 'boot-1',
      sessionId: 'session-1',
      generation: 0,
      runId: 'run-1',
    })[0]!
    const updates: string[] = []

    const result = await proxy.execute('call-1', { path: 'README.md' }, undefined, (update) => {
      updates.push(update.content[0]?.type === 'text' ? update.content[0].text : '')
    })

    expect(host.descriptors()[0]).toMatchObject({
      toolId: 'pi/read',
      source: 'kila-coding',
      permission: 'read',
    })
    expect(receivedArgs).toEqual({ path: 'README.md' })
    expect(updates).toEqual(['partial'])
    expect(result.content).toEqual([{ type: 'text', text: 'done' }])
    expect(result.details).toEqual({ path: 'README.md' })
  })

  test('Given MCP tool When 转成 Runtime descriptor Then 保留 mcp 来源而不是降级为 Kila 内置', () => {
    const tool = {
      name: 'search_docs',
      label: 'Search docs',
      description: '搜索文档',
      parameters: { type: 'object' },
      execute: async () => ({
        content: [{ type: 'text', text: 'ok' }],
        details: {},
      }),
    } as unknown as AnyAgentTool
    const host = new ToolHost()
    const proxy = createPiToolHostProxies(host, [{ tool, kind: 'mcp' }], {
      appBootId: 'app-1',
      bootId: 'boot-1',
      sessionId: 'session-1',
      generation: 0,
      runId: 'run-1',
    })

    expect(createToolDescriptors(proxy)[0]?.source).toBe('mcp')
  })
})
