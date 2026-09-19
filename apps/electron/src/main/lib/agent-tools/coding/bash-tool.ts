import type { CodingTool } from '@kila/shared'
import type { CodingPathPolicy } from './path-policy'
import {
  BASH_DEFAULT_TIMEOUT_MS,
  BASH_MAX_COMMAND_BYTES,
  BASH_MAX_TIMEOUT_MS,
  BASH_MIN_TIMEOUT_MS,
  BASH_TOOL_PARAMETERS,
  CodingToolError,
  parseBashInput,
} from './schemas'
import { truncateUtf8Tail } from './truncation'

const MAX_RESULT_BYTES = 256 * 1024

interface BashOperations {
  exec: (
    command: string,
    cwd: string,
    options: {
      onData: (data: Buffer) => void
      signal?: AbortSignal
      timeout?: number
    },
  ) => Promise<{ exitCode: number | null }>
}

export function createBashTool(
  policy: CodingPathPolicy,
  deps: { createOperations?: (sessionId: string, toolCallId: string) => BashOperations } = {},
): CodingTool {
  return {
    name: 'bash',
    label: 'Bash',
    description: '在当前会话项目目录中执行 shell 命令，并持续记录后台输出。',
    parameters: BASH_TOOL_PARAMETERS,
    permission: 'execute',
    execute: async (toolCallId, rawInput, signal, onUpdate, executionContext) => {
      const input = parseBashInput(rawInput)
      if (Buffer.byteLength(input.command, 'utf8') > BASH_MAX_COMMAND_BYTES) {
        throw new CodingToolError('coding_bash_command_too_large', `命令超过 ${BASH_MAX_COMMAND_BYTES} 字节限制`)
      }
      const timeoutMs = input.timeout ?? BASH_DEFAULT_TIMEOUT_MS
      if (timeoutMs < BASH_MIN_TIMEOUT_MS || timeoutMs > BASH_MAX_TIMEOUT_MS) {
        throw new CodingToolError(
          'coding_bash_invalid_timeout',
          `timeout 必须在 ${BASH_MIN_TIMEOUT_MS} 到 ${BASH_MAX_TIMEOUT_MS} 毫秒之间`,
        )
      }

      let output = ''
      let outputBytes = 0
      const operations = deps.createOperations?.(policySessionId(policy), toolCallId)
        ?? (await import('../../process-registry')).createTrackedBashOperations({
          sessionId: policySessionId(policy),
          toolCallId,
          identity: executionContext,
        })
      const result = await operations.exec(input.command, policy.cwd, {
        timeout: timeoutMs / 1000,
        signal,
        onData: (data) => {
          output += data.toString('utf8')
          outputBytes += data.byteLength
          const partial = truncateUtf8Tail(output, MAX_RESULT_BYTES)
          onUpdate?.({
            partialText: partial.text,
            details: partial.truncation.truncated ? { truncation: partial.truncation } : undefined,
          })
        },
      })

      const truncated = truncateUtf8Tail(output, MAX_RESULT_BYTES)
      return {
        text: truncated.text || '(命令没有输出)',
        details: {
          exitCode: result.exitCode,
          processId: toolCallId,
          outputBytes,
          ...(truncated.truncation.truncated ? { truncation: truncated.truncation } : {}),
        },
      }
    },
  }
}

function policySessionId(policy: CodingPathPolicy): string {
  return policy.sessionId
}
