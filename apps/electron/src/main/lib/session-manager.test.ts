import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionMessage } from '@kila/shared'
import {
  appendSessionMessage,
  createSession,
  deleteSession,
  getRecentSessionMessages,
  getSessionMessages,
  getSessionMessagesPage,
  listSessions,
  saveSessionMessages,
} from './session-manager'

interface TestContext {
  rootDir: string
  indexPath: string
  sessionsDir: string
  projectPath: string
  deps: {
    paths: {
      indexPath: string
      sessionsDir: string
    }
  }
}

const tempDirs: string[] = []
const originalConfigDir = process.env.KILA_CONFIG_DIR

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  if (typeof originalConfigDir === 'string') {
    process.env.KILA_CONFIG_DIR = originalConfigDir
  } else {
    delete process.env.KILA_CONFIG_DIR
  }
})

function createTestContext(): TestContext {
  const rootDir = mkdtempSync(join(tmpdir(), 'kila-session-manager-test-'))
  tempDirs.push(rootDir)
  process.env.KILA_CONFIG_DIR = join(rootDir, 'config')

  const indexPath = join(rootDir, 'sessions.json')
  const sessionsDir = join(rootDir, 'sessions')
  return {
    rootDir,
    indexPath,
    sessionsDir,
    projectPath: join(rootDir, 'project'),
    deps: { paths: { indexPath, sessionsDir } },
  }
}

function createMessage(index: number, overrides: Partial<SessionMessage> = {}): SessionMessage {
  return {
    id: `message-${index}`,
    role: index % 2 === 0 ? 'assistant' : 'user',
    content: `message content ${index}`,
    createdAt: 1_700_000_000_000 + index,
    ...overrides,
  }
}

describe('session manager persistence', () => {
  test('Given 空目录，When 创建 Session，Then 元数据与输入偏好持久化到索引', () => {
    const context = createTestContext()

    const created = createSession({
      title: '持久化测试',
      projectPath: context.projectPath,
      channelId: 'channel-a',
      modelId: 'model-a',
      thinkingLevel: 'high',
      historyTurns: 12,
      enabledToolIds: ['read', 'write'],
      systemPromptId: 'prompt-a',
    }, context.deps)

    expect(created.project).toMatchObject({
      path: context.projectPath,
      name: 'project',
      source: 'user',
    })
    expect(created.systemPromptId).toBe('prompt-a')
    expect(existsSync(context.indexPath)).toBe(true)
    expect(existsSync(`${context.indexPath}.bak`)).toBe(true)

    const persisted = JSON.parse(readFileSync(context.indexPath, 'utf-8')) as {
      version: number
      sessions: Array<typeof created>
    }
    expect(persisted.version).toBe(1)
    expect(persisted.sessions).toHaveLength(1)
    expect(persisted.sessions[0]).toMatchObject({
      id: created.id,
      title: '持久化测试',
      channelId: 'channel-a',
      modelId: 'model-a',
      thinkingLevel: 'high',
      historyTurns: 12,
      enabledToolIds: ['read', 'write'],
      systemPromptId: 'prompt-a',
    })
  })

  test('Given 主索引损坏且备份有效，When 读取列表，Then 从备份恢复主索引', () => {
    const context = createTestContext()
    const created = createSession({
      title: '备份恢复',
      projectPath: context.projectPath,
    }, context.deps)
    const backup = readFileSync(`${context.indexPath}.bak`, 'utf-8')
    writeFileSync(context.indexPath, '{ invalid json', 'utf-8')

    const sessions = listSessions(context.deps)

    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ id: created.id, title: '备份恢复' })
    expect(readFileSync(context.indexPath, 'utf-8')).toBe(backup)
  })

  test('Given JSONL 同时包含有效与损坏行，When 读取，Then 返回有效消息并隔离原始坏行', () => {
    const context = createTestContext()
    const session = createSession({ projectPath: context.projectPath }, context.deps)
    const filePath = join(context.sessionsDir, `${session.id}.jsonl`)
    const first = createMessage(1)
    const second = createMessage(2)
    const badLine = '{"id":"broken"'
    writeFileSync(filePath, `${JSON.stringify(first)}\n${badLine}\n${JSON.stringify(second)}\n`, 'utf-8')

    expect(getSessionMessages(session.id, context.deps)).toEqual([first, second])

    const corruptLines = readFileSync(`${filePath}.corrupt`, 'utf-8').trim().split('\n')
    expect(corruptLines).toHaveLength(1)
    expect(JSON.parse(corruptLines[0]!)).toMatchObject({
      sessionId: session.id,
      lineNumber: 2,
      raw: badLine,
    })
  })

  test('Given 多条消息，When 请求最近消息与分页，Then 返回稳定的边界信息', () => {
    const context = createTestContext()
    const session = createSession({ projectPath: context.projectPath }, context.deps)
    const messages = Array.from({ length: 6 }, (_, index) => createMessage(index + 1))
    saveSessionMessages(session.id, messages, context.deps)

    expect(getRecentSessionMessages(session.id, 2, context.deps)).toEqual({
      messages: messages.slice(-2),
      total: 6,
      hasMore: true,
    })
    expect(getSessionMessagesPage(session.id, 2, 3, context.deps)).toEqual({
      messages: messages.slice(2, 5),
      total: 6,
      offset: 2,
      limit: 3,
      hasMore: true,
    })
    expect(getSessionMessagesPage(session.id, 99, 999, context.deps)).toEqual({
      messages: [],
      total: 6,
      offset: 6,
      limit: 500,
      hasMore: false,
    })
  })

  test('Given 偏移索引有效，When 请求最近消息与分页，Then 按索引读取且不触发全量重建', () => {
    const context = createTestContext()
    const session = createSession({ projectPath: context.projectPath }, context.deps)
    const messages = Array.from({ length: 120 }, (_, index) => createMessage(index + 1))
    const filePath = join(context.sessionsDir, `${session.id}.jsonl`)
    const now = spyOn(Date, 'now')

    try {
      now.mockReturnValue(1_000)
      saveSessionMessages(session.id, messages, context.deps)
      const initialIndex = JSON.parse(readFileSync(`${filePath}.offsets.json`, 'utf-8')) as {
        updatedAt: number
      }

      now.mockReturnValue(2_000)
      expect(getRecentSessionMessages(session.id, 10, context.deps).messages).toEqual(messages.slice(-10))
      expect(getSessionMessagesPage(session.id, 40, 10, context.deps).messages).toEqual(messages.slice(40, 50))

      const afterQueries = JSON.parse(readFileSync(`${filePath}.offsets.json`, 'utf-8')) as {
        updatedAt: number
      }
      expect(afterQueries.updatedAt).toBe(initialIndex.updatedAt)

      now.mockReturnValue(3_000)
      const appended = createMessage(121)
      appendSessionMessage(session.id, appended, context.deps)
      const afterAppend = JSON.parse(readFileSync(`${filePath}.offsets.json`, 'utf-8')) as {
        updatedAt: number
      }
      now.mockReturnValue(4_000)
      expect(getRecentSessionMessages(session.id, 2, context.deps).messages).toEqual([messages.at(-1)!, appended])
      const afterAppendQuery = JSON.parse(readFileSync(`${filePath}.offsets.json`, 'utf-8')) as {
        updatedAt: number
      }
      expect(afterAppendQuery.updatedAt).toBe(afterAppend.updatedAt)
    } finally {
      now.mockRestore()
    }
  })

  test('Given 非有限或非法分页参数，When 查询，Then 使用安全默认值并避免空切片异常', () => {
    const context = createTestContext()
    const session = createSession({ projectPath: context.projectPath }, context.deps)
    const messages = [createMessage(1), createMessage(2), createMessage(3)]
    saveSessionMessages(session.id, messages, context.deps)

    expect(getRecentSessionMessages(session.id, Number.NaN, context.deps)).toEqual({
      messages,
      total: 3,
      hasMore: false,
    })
    expect(getSessionMessagesPage(session.id, Number.NaN, Number.POSITIVE_INFINITY, context.deps)).toEqual({
      messages,
      total: 3,
      offset: 0,
      limit: 100,
      hasMore: false,
    })
    expect(getSessionMessagesPage(session.id, -10, 0, context.deps)).toMatchObject({
      messages: [messages[0]],
      offset: 0,
      limit: 1,
      hasMore: true,
    })
  })

  test('Given 重写消息，When 生成偏移索引，Then 字节位置与消息数量准确', () => {
    const context = createTestContext()
    const session = createSession({ projectPath: context.projectPath }, context.deps)
    const messages = [
      createMessage(1, { content: 'ASCII' }),
      createMessage(2, { content: '中文内容' }),
    ]
    saveSessionMessages(session.id, messages, context.deps)

    const filePath = join(context.sessionsDir, `${session.id}.jsonl`)
    const firstLine = `${JSON.stringify(messages[0])}\n`
    const secondLine = `${JSON.stringify(messages[1])}\n`
    const index = JSON.parse(readFileSync(`${filePath}.offsets.json`, 'utf-8')) as {
      messageCount: number
      offsets: Array<{
        id: string
        lineNumber: number
        byteOffset: number
        byteLength: number
        createdAt: number
        role: SessionMessage['role']
      }>
    }

    expect(index.messageCount).toBe(2)
    expect(index.offsets).toEqual([
      {
        id: messages[0]!.id,
        lineNumber: 1,
        byteOffset: 0,
        byteLength: Buffer.byteLength(firstLine),
        createdAt: messages[0]!.createdAt,
        role: messages[0]!.role,
      },
      {
        id: messages[1]!.id,
        lineNumber: 2,
        byteOffset: Buffer.byteLength(firstLine),
        byteLength: Buffer.byteLength(secondLine),
        createdAt: messages[1]!.createdAt,
        role: messages[1]!.role,
      },
    ])
  })

  test('Given 消息及其偏移和损坏 sidecar，When 删除 Session，Then 全部持久化文件被清理', () => {
    const context = createTestContext()
    const session = createSession({ projectPath: context.projectPath }, context.deps)
    const filePath = join(context.sessionsDir, `${session.id}.jsonl`)
    appendSessionMessage(session.id, createMessage(1), context.deps)
    writeFileSync(filePath, `${readFileSync(filePath, 'utf-8')}{ broken\n`, 'utf-8')
    getSessionMessages(session.id, context.deps)

    expect(existsSync(filePath)).toBe(true)
    expect(existsSync(`${filePath}.offsets.json`)).toBe(true)
    expect(existsSync(`${filePath}.corrupt`)).toBe(true)

    deleteSession(session.id, context.deps)

    expect(listSessions(context.deps)).toEqual([])
    expect(existsSync(filePath)).toBe(false)
    expect(existsSync(`${filePath}.offsets.json`)).toBe(false)
    expect(existsSync(`${filePath}.corrupt`)).toBe(false)
    expect(existsSync(context.projectPath)).toBe(true)
  })
})
