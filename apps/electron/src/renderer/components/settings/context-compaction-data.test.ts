import { describe, expect, test } from 'bun:test'
import type { AgentEvent, SessionMessage, SessionMeta } from '@kila/shared'
import {
  loadCompactionRecords,
  summarizeCompactionRecords,
  type CompactionRecordsApi,
} from './context-compaction-data'

function createSession(id: string): SessionMeta {
  return {
    id,
    title: `Session ${id}`,
    project: {
      path: `/tmp/${id}`,
      name: id,
      source: 'temp',
      profileId: `profile-${id}`,
    },
    createdAt: 1,
    updatedAt: 1,
  }
}

function createMessage(
  id: string,
  createdAt: number,
  event?: Extract<AgentEvent, { type: 'compact_complete' }>,
): SessionMessage {
  return {
    id,
    role: 'status',
    content: '',
    createdAt,
    events: event ? [event] : [],
  }
}

describe('上下文压缩记录加载', () => {
  test('Given 大量 Session, When 加载记录, Then 同时读取的 Session 不超过并发上限', async () => {
    const sessions = Array.from({ length: 9 }, (_, index) => createSession(String(index)))
    let active = 0
    let maxActive = 0

    const api: CompactionRecordsApi = {
      listSessions: async () => sessions,
      getSessionMessagesPage: async ({ sessionId }) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await Bun.sleep(5)
        active -= 1
        return {
          messages: [],
          total: 0,
          offset: 0,
          limit: 200,
          hasMore: false,
        }
      },
    }

    await loadCompactionRecords(api, { concurrency: 3 })

    expect(maxActive).toBe(3)
  })

  test('Given 单个长 Session, When 分页扫描, Then 每页处理并按时间倒序返回压缩记录', async () => {
    const session = createSession('long')
    const messages = [
      createMessage('m1', 100, {
        type: 'compact_complete',
        reason: 'threshold',
        tokensBefore: 1_000,
      }),
      createMessage('m2', 200),
      createMessage('m3', 300, {
        type: 'compact_complete',
        reason: 'overflow',
        tokensBefore: 2_000,
        willRetry: true,
        summaryText: 'summary',
      }),
    ]
    const offsets: number[] = []

    const api: CompactionRecordsApi = {
      listSessions: async () => [session],
      getSessionMessagesPage: async ({ offset = 0, limit = 2 }) => {
        offsets.push(offset)
        const pageMessages = messages.slice(offset, offset + limit)
        return {
          messages: pageMessages,
          total: messages.length,
          offset,
          limit,
          hasMore: offset + pageMessages.length < messages.length,
        }
      },
    }

    const result = await loadCompactionRecords(api, { pageSize: 2 })

    expect(offsets).toEqual([0, 2])
    expect(result.failures).toEqual([])
    expect(result.records.map((record) => record.messageId)).toEqual(['m3', 'm1'])
    expect(summarizeCompactionRecords(result.records)).toMatchObject({
      count: 2,
      overflowCount: 1,
      retryCount: 1,
      tokensBefore: 3_000,
      summaryChars: 7,
      lastCompactedAt: 300,
    })
  })

  test('Given 服务端声称还有数据但返回空页, When 扫描, Then 跳过损坏 Session 而不是拖垮整个设置页', async () => {
    const api: CompactionRecordsApi = {
      listSessions: async () => [createSession('broken')],
      getSessionMessagesPage: async () => ({
        messages: [],
        total: 10,
        offset: 0,
        limit: 2,
        hasMore: true,
      }),
    }

    const result = await loadCompactionRecords(api, { pageSize: 2 })

    expect(result.records).toEqual([])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.error).toContain('消息分页未推进')
  })
})
