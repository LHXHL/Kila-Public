import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compactAgentEventsForPersistence, type AgentEvent, type SessionMessage, type SessionMeta } from '@kila/shared'
import { createPiEventMapper } from './adapters/pi-agent-adapter'
import { getSearchIndexPath } from './config-paths'
import {
  disposeSessionSearchIndex,
  searchSessionsWithIndex,
  warmSessionSearchIndex,
} from './session-search-index'
import { markSessionSearchIndexDirty } from './session-search-dirty'
import { searchSessions } from './session-search-service'

const tempDirs: string[] = []
const originalConfigDir = process.env.KILA_CONFIG_DIR

afterEach(() => {
  disposeSessionSearchIndex()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  if (typeof originalConfigDir === 'string') {
    process.env.KILA_CONFIG_DIR = originalConfigDir
  } else {
    delete process.env.KILA_CONFIG_DIR
  }
})

function createFixture(): { configDir: string; messagePath: string; session: SessionMeta; message: SessionMessage } {
  const rootDir = mkdtempSync(join(tmpdir(), 'kila-session-search-test-'))
  const configDir = join(rootDir, 'config')
  const sessionsDir = join(configDir, 'sessions')
  const projectPath = join(rootDir, 'project')
  tempDirs.push(rootDir)
  process.env.KILA_CONFIG_DIR = configDir
  mkdirSync(sessionsDir, { recursive: true })

  const session: SessionMeta = {
    id: 'session-search-regression',
    title: '索引回归测试',
    project: {
      path: projectPath,
      name: 'project',
      source: 'user',
      profileId: 'profile-search-regression',
    },
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
  }
  const repeatedPayload = 'x'.repeat(8 * 1024)
  const message: SessionMessage = {
    id: 'message-search-regression',
    role: 'assistant',
    content: '这里包含需要命中的稀有检索词',
    createdAt: 1_700_000_000_500,
    events: Array.from({ length: 32 }, (_, index) => ({
      type: 'tool_update' as const,
      toolUseId: 'tool-search-regression',
      partialText: `${index}:${repeatedPayload}`,
    })),
  }

  writeFileSync(join(configDir, 'sessions.json'), JSON.stringify({ version: 1, sessions: [session] }), 'utf-8')
  const messagePath = join(sessionsDir, `${session.id}.jsonl`)
  writeFileSync(messagePath, `${JSON.stringify(message)}\n`, 'utf-8')
  return { configDir, messagePath, session, message }
}

describe('session search regression', () => {
  test('Given 消息携带大量事件，When 预热索引并搜索，Then 只索引可搜索正文', async () => {
    const { session, message } = createFixture()

    await warmSessionSearchIndex()
    const result = await searchSessionsWithIndex({ query: '稀有检索词', limitPerType: 6 })

    expect(result?.results).toContainEqual(expect.objectContaining({
      type: 'message',
      sessionId: session.id,
      messageId: message.id,
    }))
    expect(existsSync(getSearchIndexPath())).toBe(true)
    expect(readFileSync(getSearchIndexPath(), 'utf-8').length).toBeLessThan(16 * 1024)

    const scoped = await searchSessions({ query: 'message: 稀有检索词', limitPerType: 6 })
    expect(scoped.results.every((item) => item.type === 'message')).toBe(true)
  })

  test('Given events 中存在同名嵌套字段，When 搜索消息正文，Then 只匹配顶层 content', async () => {
    const { messagePath, session } = createFixture()
    const nestedDecoy = '嵌套字段不应成为可搜索正文'
    const topLevelContent = '顶层正文必须被检索到'
    const line = [
      '{',
      JSON.stringify('id'), ':', JSON.stringify('message-top-level-content'), ',',
      JSON.stringify('role'), ':', JSON.stringify('assistant'), ',',
      JSON.stringify('events'), ':[{"input":{"content":', JSON.stringify(nestedDecoy), '}}],',
      JSON.stringify('content'), ':', JSON.stringify(topLevelContent), ',',
      JSON.stringify('createdAt'), ':', String(1_700_000_000_600),
      '}',
    ].join('')
    writeFileSync(messagePath, `${line}\n`, 'utf-8')
    markSessionSearchIndexDirty(session.id)

    const topLevelResult = await searchSessionsWithIndex({ query: topLevelContent, limitPerType: 6 })
    expect(topLevelResult.results).toContainEqual(expect.objectContaining({
      type: 'message',
      sessionId: session.id,
      messageId: 'message-top-level-content',
    }))

    const nestedResult = await searchSessionsWithIndex({ query: nestedDecoy, limitPerType: 6 })
    expect(nestedResult.results.some((item) => item.type === 'message')).toBe(false)
  })

  test('Given 会话消息发生变化，When 再次搜索，Then 只增量刷新脏会话', async () => {
    const { messagePath, session, message } = createFixture()
    await warmSessionSearchIndex()
    const appended: SessionMessage = {
      id: 'message-search-appended',
      role: 'user',
      content: '增量索引立即可见',
      createdAt: message.createdAt + 1,
    }
    writeFileSync(messagePath, `${JSON.stringify(message)}\n${JSON.stringify(appended)}\n`, 'utf-8')
    markSessionSearchIndexDirty(session.id)

    const result = await searchSessionsWithIndex({ query: '增量索引立即可见', limitPerType: 6 })

    expect(result.results).toContainEqual(expect.objectContaining({
      type: 'message',
      sessionId: session.id,
      messageId: appended.id,
    }))
  })

  test('Given Pi 发送累计工具输出，When 转换并持久化，Then 只保留线性增量', () => {
    const mapEvent = createPiEventMapper()
    const start = mapEvent({
      type: 'tool_execution_start',
      toolCallId: 'tool-regression',
      toolName: 'bash',
      args: {},
    } as never)
    const first = mapEvent({
      type: 'tool_execution_update',
      toolCallId: 'tool-regression',
      toolName: 'bash',
      partialResult: { content: [{ type: 'text', text: 'hello' }] },
    } as never)
    const second = mapEvent({
      type: 'tool_execution_update',
      toolCallId: 'tool-regression',
      toolName: 'bash',
      partialResult: { content: [{ type: 'text', text: 'hello world' }] },
    } as never)

    expect(first).toEqual([expect.objectContaining({ type: 'tool_update', partialText: 'hello' })])
    expect(second).toEqual([expect.objectContaining({ type: 'tool_update', partialText: ' world' })])

    const interrupted = compactAgentEventsForPersistence([
      ...start,
      ...first,
      ...second,
    ] as AgentEvent[])
    expect(interrupted).toContainEqual(expect.objectContaining({
      type: 'tool_update',
      partialText: 'hello world',
    }))

    const completed = compactAgentEventsForPersistence([
      ...interrupted,
      {
        type: 'tool_result',
        toolUseId: 'tool-regression',
        toolName: 'bash',
        result: 'hello world',
        isError: false,
      },
    ])
    expect(completed.some((event: AgentEvent) => event.type === 'tool_update')).toBe(false)
  })
})
