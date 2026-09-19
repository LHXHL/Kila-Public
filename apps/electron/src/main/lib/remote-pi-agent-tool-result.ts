import type {
  RuntimeToolCallPayloadV1,
  RuntimeToolResultPayloadV1,
  RuntimeToolResultReferenceV1,
} from '@kila/shared'
import { writeRuntimeToolResult } from './agent-runtime-transfer-store'
import { truncateUtf8Tail } from './agent-tools/coding/truncation'
import type { RemoteRun } from './remote-pi-agent-types'

const MAX_INLINE_TOOL_RESULT_BYTES = 200 * 1024

export function createRuntimeToolResultPayload(
  run: RemoteRun,
  call: RuntimeToolCallPayloadV1,
  text: string,
  details: Record<string, unknown>,
  isError: boolean,
): RuntimeToolResultPayloadV1 {
  let inlineText = text
  let resultRef: RuntimeToolResultReferenceV1 | undefined
  if (Buffer.byteLength(text, 'utf8') > MAX_INLINE_TOOL_RESULT_BYTES) {
    if (run.bundlePath) {
      resultRef = writeRuntimeToolResult(run.bundlePath, call.toolCallId, text)
      inlineText = `[工具输出已保存到受控引用，大小 ${resultRef.size} 字节]`
    } else {
      inlineText = truncateUtf8Tail(text, MAX_INLINE_TOOL_RESULT_BYTES).text
    }
  }
  return {
    appBootId: call.appBootId,
    bootId: call.bootId,
    sessionId: run.sessionId,
    generation: run.generation,
    runId: run.runId,
    toolId: call.toolId,
    toolCallId: call.toolCallId,
    text: inlineText,
    details,
    approvedArgs: call.approvedArgs,
    resultRef,
    isError,
  }
}
