import type { CodingToolExecutionContext } from '@kila/shared'

export function buildProcessRecordKey(input: {
  sessionId: string
  toolCallId: string
  identity?: CodingToolExecutionContext
}): string {
  const identity = input.identity
  return [
    identity?.appBootId ?? 'legacy-app',
    identity?.bootId ?? 'legacy-boot',
    input.sessionId,
    identity?.generation ?? 0,
    identity?.runId ?? 'legacy-run',
    identity?.toolId ?? 'kila-coding/bash',
    input.toolCallId,
  ].map((part) => String(part).replaceAll(':', '%3A')).join(':')
}
