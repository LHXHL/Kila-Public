import type { CodingTool, CodingToolExecutionContext, RuntimeToolCallV1, RuntimeToolSource } from '@kila/shared'
import type { AnyAgentTool, MergedAgentToolWithSource } from '../agent-tool-names'
import { KILA_CODING_TOOL } from './coding-tool-marker'
import type { ToolHost } from './tool-host'

export interface PiToolHostIdentity {
  appBootId: string
  bootId: string
  sessionId: string
  generation: number
  runId: string
}

/** 保留合并阶段的来源归类，供跨进程 descriptor 使用。 */
export const RUNTIME_TOOL_SOURCE = Symbol.for('kila.runtime.tool-source')

type RuntimeSourcedPiTool = AnyAgentTool & {
  [RUNTIME_TOOL_SOURCE]?: RuntimeToolSource
}

interface HostedPiTool {
  tool: AnyAgentTool
  source: RuntimeToolSource
}

const KILA_CODING_TOOL_NAMES = new Set(['read', 'write', 'edit', 'bash'])

/**
 * 将当前进程内的 Pi AgentTool 也压过一层 ToolHost。
 *
 * 这一步先验证 descriptor/executor 与 Pi tool 的分离；迁移到 Utility 后，
 * 同一组 descriptor/executor 只需把 proxy 的 call 换成 Runtime RPC。
 */
export function createPiToolHostProxies(
  host: ToolHost,
  mergedTools: MergedAgentToolWithSource[],
  identity: PiToolHostIdentity,
): AnyAgentTool[] {
  const hostedTools = mergedTools.map(({ tool, kind }): HostedPiTool => ({
    tool,
    source: KILA_CODING_TOOL_NAMES.has(tool.name)
      ? 'kila-coding'
      : kind === 'mcp' ? 'mcp' : 'kila',
  }))

  for (const hosted of hostedTools) registerPiTool(host, hosted)
  return hostedTools.map(({ tool, source }) => createProxyTool(host, tool, source, identity))
}

function registerPiTool(host: ToolHost, hosted: HostedPiTool): void {
  const { tool, source } = hosted
  host.register({
    version: 1,
    toolId: `pi/${tool.name}`,
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: toRecord(tool.parameters),
    source,
    permission: resolvePermission(source, tool.name),
    resultKinds: ['text', 'structured'],
    supportsStreaming: true,
  }, {
    execute: async (input) => {
      let updateSequence = 0
      let updateChain = Promise.resolve()
      const codingTool = (tool as AnyAgentTool & { [KILA_CODING_TOOL]?: CodingTool })[KILA_CODING_TOOL]
      if (codingTool) {
        const result = await codingTool.execute(
          input.toolCallId,
          input.approvedArgs,
          input.signal,
          (partial) => {
            const update = {
              ...input,
              updateSequence: ++updateSequence,
              partialText: partial.partialText,
              cumulativeBytes: Buffer.byteLength(partial.partialText, 'utf8'),
            }
            updateChain = updateChain.then(() => input.onUpdate(update))
          },
          input as CodingToolExecutionContext,
        )
        await updateChain
        return { text: result.text, details: result.details, isError: false }
      }
      const result = await tool.execute(
        input.toolCallId,
        input.approvedArgs as never,
        input.signal,
        (partial) => {
          const partialText = partial.content
            .filter((item) => item.type === 'text')
            .map((item) => item.text)
            .join('\n')
          const update = {
            ...input,
            updateSequence: ++updateSequence,
            partialText,
            cumulativeBytes: Buffer.byteLength(partialText, 'utf8'),
          }
          updateChain = updateChain.then(() => input.onUpdate(update))
        },
      )
      await updateChain
      const text = result.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n')
      return {
        text,
        details: {
          value: result.details,
          content: result.content,
        },
        isError: false,
      }
    },
  })
}

function createProxyTool(
  host: ToolHost,
  tool: AnyAgentTool,
  source: RuntimeToolSource,
  identity: PiToolHostIdentity,
): RuntimeSourcedPiTool {
  const toolId = `pi/${tool.name}`
  return {
    ...tool,
    [RUNTIME_TOOL_SOURCE]: source,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const call: RuntimeToolCallV1 = {
        ...identity,
        toolId,
        toolCallId,
        requestedArgs: params as Record<string, unknown>,
        approvedArgs: params as Record<string, unknown>,
        argsModified: false,
      }
      const result = await host.call({
        ...call,
        signal,
        onUpdate: async (update) => {
          onUpdate?.({
            content: [{ type: 'text', text: update.partialText }],
            details: {},
          })
        },
      })
      if (result.isError) throw new Error(result.text)
      const details = result.details as { value?: unknown; content?: unknown }
      return {
        content: Array.isArray(details?.content)
          ? details.content as never
          : [{ type: 'text', text: result.text }],
        details: details?.value,
      }
    },
  }
}

function resolvePermission(source: RuntimeToolSource, toolName: string): 'read' | 'write' | 'execute' | 'interactive' {
  if (source !== 'kila-coding') return 'execute'
  if (toolName === 'read') return 'read'
  if (toolName === 'write' || toolName === 'edit') return 'write'
  return 'execute'
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { type: 'object' }
}
