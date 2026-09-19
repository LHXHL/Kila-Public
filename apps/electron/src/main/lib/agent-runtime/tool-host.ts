import type {
  CodingTool,
  RuntimeToolCallV1,
  RuntimeToolDescriptorV1,
  RuntimeToolResultV1,
  RuntimeToolUpdateV1,
} from '@kila/shared'
import { ToolRegistry, type ToolRegistryExecutionInput, type ToolRegistryExecutor } from './tool-registry'

export interface ToolHostExecutor {
  execute: (input: ToolRegistryExecutionInput) => Promise<RuntimeToolResultV1>
}

export class ToolHost {
  private readonly tools = new Map<string, { descriptor: RuntimeToolDescriptorV1; executor: ToolHostExecutor }>()
  readonly registry: ToolRegistry

  constructor(registry = new ToolRegistry()) {
    this.registry = registry
  }

  register(
    descriptor: RuntimeToolDescriptorV1,
    executor: ToolHostExecutor,
  ): void {
    if (this.tools.has(descriptor.toolId)) {
      throw new Error(`tool_host_duplicate_tool: ${descriptor.toolId}`)
    }
    this.tools.set(descriptor.toolId, { descriptor, executor })
  }

  unregister(toolId: string): void {
    this.tools.delete(toolId)
  }

  descriptors(): RuntimeToolDescriptorV1[] {
    return [...this.tools.values()].map(({ descriptor }) => descriptor)
  }

  call(
    input: RuntimeToolCallV1 & {
      signal?: AbortSignal
      onUpdate?: (update: RuntimeToolUpdateV1) => Promise<void> | void
    },
  ): Promise<RuntimeToolResultV1> {
    const registration = this.tools.get(input.toolId)
    if (!registration) {
      return Promise.resolve({
        text: `工具不存在: ${input.toolId}`,
        isError: true,
      })
    }
    return this.registry.execute(input, registration.executor)
  }
}

/** 将 Kila 自有工具登记为 Runtime descriptor；executor 仍然留在主进程。 */
export function registerCodingTools(host: ToolHost, tools: CodingTool[]): void {
  for (const tool of tools) {
    host.register({
      version: 1,
      toolId: `kila-coding/${tool.name}`,
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      source: 'kila-coding',
      permission: tool.permission,
      resultKinds: ['text', 'structured'],
      supportsStreaming: tool.name === 'bash',
    }, {
      execute: async (input) => {
        let updateSequence = 0
        const result = await tool.execute(input.toolCallId, input.approvedArgs, input.signal, (update) => input.onUpdate({
          ...input,
          updateSequence: ++updateSequence,
          partialText: update.partialText,
          cumulativeBytes: Buffer.byteLength(update.partialText, 'utf8'),
        }), input)
        return { text: result.text, details: result.details, isError: false }
      },
    })
  }
}
