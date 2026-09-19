import { describe, expect, test } from 'bun:test'
import { buildProcessRecordKey } from './process-registry-key'

function createIdentity(sessionId: string, runId: string) {
  return {
    appBootId: 'app-process-registry-test',
    bootId: `boot-${sessionId}`,
    sessionId,
    generation: 0,
    runId,
    toolId: 'pi/bash',
  }
}

describe('ProcessRegistry Runtime identity', () => {
  test('Given 两个 Session 使用相同 toolCallId When 构造进程 key Then Runtime identity 仍保持隔离', () => {
    const first = buildProcessRecordKey({
      sessionId: 'process-registry-session-a',
      toolCallId: 'same-tool-call',
      identity: createIdentity('process-registry-session-a', 'run-a'),
    })
    const second = buildProcessRecordKey({
      sessionId: 'process-registry-session-b',
      toolCallId: 'same-tool-call',
      identity: createIdentity('process-registry-session-b', 'run-b'),
    })

    expect(first).not.toBe(second)
    expect(buildProcessRecordKey({
      sessionId: 'process-registry-session-a',
      toolCallId: 'same-tool-call',
      identity: createIdentity('process-registry-session-a', 'run-a'),
    })).toBe(first)
  })
})
