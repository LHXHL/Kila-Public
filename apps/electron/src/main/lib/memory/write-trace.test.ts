import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { MemoryRunTrace, SessionMessage } from '@kila/shared'
import { getSessionMessages, saveSessionMessages } from '../session-manager'
import { patchLatestAssistantMemoryTrace } from './write-trace'

const initialTrace: MemoryRunTrace = {
  enabled: true,
  provider: 'local',
  recalledMemoryCount: 1,
  relatedThreadCount: 0,
  notebookCount: 0,
  usedGlobalWorkingMemory: true,
  usedProjectWorkingMemory: false,
  incognito: false,
  recallStatus: 'success',
  writeStatus: 'queued',
}
const finalTrace: MemoryRunTrace = {
  ...initialTrace,
  writeStatus: 'written',
  writtenMemoryCount: 2,
}

function assistant(id: string, trace?: MemoryRunTrace): SessionMessage {
  return {
    id,
    role: 'assistant',
    content: id,
    createdAt: 1,
    events: trace ? [{ type: 'memory_trace', trace }] : [],
  }
}

describe('Memory write trace 持久化补丁', () => {
  test('只更新最后一条含 trace 的 assistant 消息', () => {
    const original = [assistant('old', initialTrace), assistant('plain'), assistant('latest', initialTrace)]
    const result = patchLatestAssistantMemoryTrace(original, finalTrace)
    expect(result.patched).toBe(true)
    expect(result.messages).not.toBe(original)
    expect(result.messages[0]).toEqual(original[0])
    expect(result.messages[1]).toEqual(original[1])
    expect(result.messages[2]?.events?.[0]).toEqual({ type: 'memory_trace', trace: finalTrace })
    expect(original[2]?.events?.[0]).toEqual({ type: 'memory_trace', trace: initialTrace })
  })

  test('无目标 trace 时不产生重写内容', () => {
    const original: SessionMessage[] = [assistant('plain'), { id: 'user', role: 'user', content: 'hi', createdAt: 1 }]
    expect(patchLatestAssistantMemoryTrace(original, finalTrace)).toEqual({ messages: original, patched: false })
  })

  test('保存后重新加载仍保留最终写入状态', () => {
    const root = mkdtempSync(join(tmpdir(), 'kila-memory-trace-'))
    const deps = { paths: { indexPath: join(root, 'sessions.json'), sessionsDir: join(root, 'sessions') } }
    try {
      const original = [assistant('latest', initialTrace)]
      saveSessionMessages('session-1', original, deps)
      const patched = patchLatestAssistantMemoryTrace(getSessionMessages('session-1', deps), finalTrace)
      expect(patched.patched).toBe(true)
      saveSessionMessages('session-1', patched.messages, deps)

      const reloaded = getSessionMessages('session-1', deps)
      expect(reloaded[0]?.events?.[0]).toEqual({ type: 'memory_trace', trace: finalTrace })
      expect(readFileSync(join(root, 'sessions', 'session-1.jsonl'), 'utf8')).toContain('"writeStatus":"written"')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
