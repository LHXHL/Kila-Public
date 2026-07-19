import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@sinclair/typebox'
import { memoryProviderManager } from '../memory/provider-manager'
import type {
  MemoryCategory,
  MemoryEntry,
  MemoryWriteInput,
  NotebookEntry,
  WorkingMemoryScope,
} from '../memory/types'

const MEMORY_CATEGORY_ENUM = [
  'general',
  'decision',
  'preference',
  'fact',
  'task',
  'insight',
] as const satisfies readonly MemoryCategory[]

const MEMORY_WRITE_SCHEMA = Type.Object({
  content: Type.String({ description: '要写入记忆的正文内容' }),
  title: Type.Optional(Type.String({ description: '可选标题' })),
  tags: Type.Optional(Type.Array(Type.String(), { description: '可选标签列表' })),
  category: Type.Optional(Type.Union(MEMORY_CATEGORY_ENUM.map((value) => Type.Literal(value)))),
  key: Type.Optional(Type.String({ description: '可选稳定 key，用于后续人工识别' })),
  scope: Type.Optional(Type.Union([
    Type.Literal('global'),
    Type.Literal('project'),
  ], { description: '记忆作用域；用户偏好和跨项目事实用 global，仅当前项目适用的约束用 project。默认 global。' })),
})

const MEMORY_SEARCH_SCHEMA = Type.Object({
  query: Type.String({ description: '搜索关键词或自然语言查询' }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
})

const MEMORY_READ_SCHEMA = Type.Object({
  uri: Type.String({ description: 'memory://... 形式的记忆 URI' }),
})

const MEMORY_EDIT_SCHEMA = Type.Object({
  uri: Type.String({ description: 'memory://... 形式的记忆 URI' }),
  content: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  tags: Type.Optional(Type.Array(Type.String())),
  category: Type.Optional(Type.Union(MEMORY_CATEGORY_ENUM.map((value) => Type.Literal(value)))),
  key: Type.Optional(Type.String()),
})

const MEMORY_FORGET_SCHEMA = Type.Object({
  uri: Type.String({ description: 'memory://... 形式的记忆 URI' }),
})

const MEMORY_LIST_SCHEMA = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 2000 })),
})

const MEMORY_CONTEXT_SCHEMA = Type.Object({
  action: Type.Union([
    Type.Literal('get'),
    Type.Literal('set'),
    Type.Literal('clear'),
  ]),
  scope: Type.Optional(Type.Union([
    Type.Literal('global'),
    Type.Literal('project'),
  ])),
  content: Type.Optional(Type.String()),
})

const MEMORY_CONTEXT_PATCH_SCHEMA = Type.Object({
  scope: Type.Optional(Type.Union([
    Type.Literal('global'),
    Type.Literal('project'),
  ])),
  section: Type.String({ description: '要 patch 的 markdown heading，例如 ## Notes' }),
  content: Type.Optional(Type.String()),
  append: Type.Optional(Type.String()),
})

const MEMORY_THREAD_SEARCH_SCHEMA = Type.Object({
  query: Type.String({ description: '搜索相关历史线程的关键词或自然语言查询' }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
  source: Type.Optional(Type.String()),
})

const MEMORY_THREAD_FETCH_SCHEMA = Type.Object({
  threadId: Type.String({ description: '线程 ID' }),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
})

const MEMORY_TIMELINE_SCHEMA = Type.Object({
  lastNDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 })),
  dateFrom: Type.Optional(Type.String({ description: 'YYYY-MM-DD' })),
  dateTo: Type.Optional(Type.String({ description: 'YYYY-MM-DD' })),
  eventType: Type.Optional(Type.String()),
  tier1Only: Type.Optional(Type.Boolean()),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
})

const MEMORY_CONNECTIONS_SCHEMA = Type.Object({
  memoryId: Type.Optional(Type.String()),
  query: Type.Optional(Type.String()),
})

const NOTEBOOK_WRITE_SCHEMA = Type.Object({
  content: Type.String({ description: '笔记内容' }),
  title: Type.Optional(Type.String()),
  tags: Type.Optional(Type.Array(Type.String())),
  key: Type.Optional(Type.String()),
})

const NOTEBOOK_READ_SCHEMA = Type.Object({
  uri: Type.String({ description: 'notebook://... 形式的笔记 URI' }),
})

const NOTEBOOK_EDIT_SCHEMA = Type.Object({
  uri: Type.String({ description: 'notebook://... 形式的笔记 URI' }),
  content: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  tags: Type.Optional(Type.Array(Type.String())),
  key: Type.Optional(Type.String()),
})

const NOTEBOOK_FORGET_SCHEMA = Type.Object({
  uri: Type.String({ description: 'notebook://... 形式的笔记 URI' }),
})

function formatMemoryEntry(entry: MemoryEntry): string {
  const title = entry.title ? `标题: ${entry.title}\n` : ''
  const tags = entry.tags.length > 0 ? `标签: ${entry.tags.join(', ')}\n` : ''
  const key = entry.key ? `Key: ${entry.key}\n` : ''
  const project = entry.projectPath ? `项目: ${entry.projectPath}\n` : ''
  return `${title}${tags}${key}${project}URI: ${entry.uri}\n类别: ${entry.category}\n内容: ${entry.content}`
}

function formatNotebookEntry(entry: NotebookEntry): string {
  const title = entry.title ? `标题: ${entry.title}\n` : ''
  const tags = entry.tags.length > 0 ? `标签: ${entry.tags.join(', ')}\n` : ''
  const key = entry.key ? `Key: ${entry.key}\n` : ''
  const project = entry.projectPath ? `项目: ${entry.projectPath}\n` : ''
  return `${title}${tags}${key}${project}URI: ${entry.uri}\n内容: ${entry.content}`
}

function resolveScope(scope?: WorkingMemoryScope): WorkingMemoryScope {
  return scope === 'project' ? 'project' : 'global'
}

export function resolveMemoryWriteProjectPath(
  scope: WorkingMemoryScope | undefined,
  projectPath: string | undefined,
): string | undefined {
  if (scope !== 'project') return undefined
  if (!projectPath) throw new Error('当前会话未绑定项目，无法写入项目级长期记忆')
  return projectPath
}

export function resolveMemoryEntryProvider(uri: string): 'local' | 'nowledge' {
  return uri.startsWith('memory://global/') || uri.startsWith('memory://project/')
    ? 'local'
    : 'nowledge'
}

export interface MemoryToolDeps {
  writeMemory?: (input: MemoryWriteInput) => Promise<MemoryEntry>
}

export function createMemoryTools(
  options: {
    sessionId: string
    projectPath?: string
    /** 当前后端是否可用，false 时只注册 memory_status */
    backendAvailable?: boolean
  },
  deps: MemoryToolDeps = {},
): AgentTool<any>[] {
  const writeMemory = deps.writeMemory ?? memoryProviderManager.write.bind(memoryProviderManager)
  const memoryWriteTool: AgentTool<typeof MEMORY_WRITE_SCHEMA> = {
    name: 'memory_write',
    label: 'Memory Write',
    description: '立即写入长期记忆。Nowledge 启用时写入 Nowledge；未启用时写入本地 Markdown。用户偏好与跨项目事实写入 global；仅当前项目适用的约束写入 project；未指定时默认 global。',
    parameters: MEMORY_WRITE_SCHEMA,
    execute: async (_toolCallId, params) => {
      const entry = await writeMemory({
        content: params.content,
        title: params.title,
        tags: params.tags,
        category: params.category,
        key: params.key,
        sourceSessionId: options.sessionId,
        projectPath: resolveMemoryWriteProjectPath(params.scope, options.projectPath),
      })
      const provider = resolveMemoryEntryProvider(entry.uri)
      const providerLabel = provider === 'nowledge' ? ' Nowledge ' : '本地 Markdown '

      return {
        content: [{
          type: 'text',
          text: `已写入${providerLabel}长期记忆：${entry.uri}`,
        }],
        details: {
          persisted: true,
          provider,
          uri: entry.uri,
          sessionId: options.sessionId,
          projectPath: entry.projectPath,
        },
      }
    },
  }

  const memorySearchTool: AgentTool<typeof MEMORY_SEARCH_SCHEMA> = {
    name: 'memory_search',
    label: 'Memory Search',
    description: '搜索长期记忆。',
    parameters: MEMORY_SEARCH_SCHEMA,
    execute: async (_toolCallId, params) => {
      const results = await memoryProviderManager.search({
        query: params.query,
        limit: params.limit,
        projectPath: options.projectPath,
      })

      if (results.length === 0) {
        return {
          content: [{ type: 'text', text: '没有找到相关记忆。' }],
          details: { count: 0 },
        }
      }

      return {
        content: [{
          type: 'text',
          text: results.map((result, index) => `${index + 1}. [${result.entry.category}] ${result.entry.content} (${result.entry.uri})`).join('\n'),
        }],
        details: {
          count: results.length,
          uris: results.map((result) => result.entry.uri),
          results: results.map((result) => ({
            uri: result.entry.uri,
            score: result.score,
            relevanceReason: result.relevanceReason,
            labels: result.labels,
            sourceThreadId: result.sourceThreadId,
            matchedSnippet: result.matchedSnippet,
          })),
        },
      }
    },
  }

  const memoryReadTool: AgentTool<typeof MEMORY_READ_SCHEMA> = {
    name: 'memory_read',
    label: 'Memory Read',
    description: '按 URI 读取单条长期记忆。',
    parameters: MEMORY_READ_SCHEMA,
    execute: async (_toolCallId, params) => {
      const entry = await memoryProviderManager.read(params.uri)
      if (!entry) {
        return {
          content: [{ type: 'text', text: '指定记忆不存在。' }],
          details: { found: false },
        }
      }
      return {
        content: [{ type: 'text', text: formatMemoryEntry(entry) }],
        details: { found: true, uri: entry.uri },
      }
    },
  }

  const memoryEditTool: AgentTool<typeof MEMORY_EDIT_SCHEMA> = {
    name: 'memory_edit',
    label: 'Memory Edit',
    description: '编辑已有长期记忆。',
    parameters: MEMORY_EDIT_SCHEMA,
    execute: async (_toolCallId, params) => {
      const entry = await memoryProviderManager.edit({
        uri: params.uri,
        content: params.content,
        title: params.title,
        tags: params.tags,
        category: params.category,
        key: params.key,
        projectPath: options.projectPath,
      })

      if (!entry) {
        return {
          content: [{ type: 'text', text: '指定记忆不存在，无法编辑。' }],
          details: { updated: false },
        }
      }

      return {
        content: [{ type: 'text', text: `记忆已更新：${entry.uri}` }],
        details: { updated: true, uri: entry.uri },
      }
    },
  }

  const memoryForgetTool: AgentTool<typeof MEMORY_FORGET_SCHEMA> = {
    name: 'memory_forget',
    label: 'Memory Forget',
    description: '删除一条长期记忆。',
    parameters: MEMORY_FORGET_SCHEMA,
    execute: async (_toolCallId, params) => {
      const deleted = await memoryProviderManager.forget(params.uri)
      return {
        content: [{ type: 'text', text: deleted ? `已删除记忆：${params.uri}` : '指定记忆不存在。' }],
        details: { deleted, uri: params.uri },
      }
    },
  }

  const memoryListTool: AgentTool<typeof MEMORY_LIST_SCHEMA> = {
    name: 'memory_list',
    label: 'Memory List',
    description: '按时间顺序列出近期长期记忆。',
    parameters: MEMORY_LIST_SCHEMA,
    execute: async (_toolCallId, params) => {
      const entries = await memoryProviderManager.list({
        limit: params.limit,
        offset: params.offset,
        projectPath: options.projectPath,
      })

      return {
        content: [{
          type: 'text',
          text: entries.length > 0
            ? entries.map((entry, index) => `${index + 1}. [${entry.category}] ${entry.title || entry.content.slice(0, 80)} (${entry.uri})`).join('\n')
            : '当前没有长期记忆。',
        }],
        details: { count: entries.length, uris: entries.map((entry) => entry.uri) },
      }
    },
  }

  const memoryContextTool: AgentTool<typeof MEMORY_CONTEXT_SCHEMA> = {
    name: 'memory_context',
    label: 'Memory Context',
    description: '读取或更新 working memory。',
    parameters: MEMORY_CONTEXT_SCHEMA,
    execute: async (_toolCallId, params) => {
      const scope = resolveScope(params.scope)

      if (params.action === 'get') {
        const state = await memoryProviderManager.getWorkingMemory({
          scope,
          projectPath: scope === 'project' ? options.projectPath : undefined,
        })
        return {
          content: [{ type: 'text', text: state?.content?.trim() || '当前 working memory 为空。' }],
          details: { scope, updatedAt: state?.updatedAt ?? null },
        }
      }

      const next = await memoryProviderManager.setWorkingMemory({
        scope,
        projectPath: scope === 'project' ? options.projectPath : undefined,
        content: params.action === 'clear'
          ? '## Focus Areas\n- cleared'
          : (params.content ?? ''),
      })

      return {
        content: [{ type: 'text', text: params.action === 'clear' ? 'working memory 已清空。' : 'working memory 已更新。' }],
        details: { scope, updatedAt: next.updatedAt },
      }
    },
  }

  const memoryStatusTool: AgentTool<any> = {
    name: 'memory_status',
    label: 'Memory Status',
    description: '检查当前记忆后端状态。',
    parameters: Type.Object({}),
    execute: async () => {
      const status = await memoryProviderManager.getStatus()
      return {
        content: [{
          type: 'text',
          text: `mode=${status.mode}, active=${status.activeProvider}, nowledgeConfigured=${status.nowledgeConfigured}, nowledgeHealthy=${status.nowledgeHealthy}${status.detail ? `, detail=${status.detail}` : ''}`,
        }],
        details: status,
      }
    },
  }

  const memoryContextPatchTool: AgentTool<typeof MEMORY_CONTEXT_PATCH_SCHEMA> = {
    name: 'memory_context_patch',
    label: 'Memory Context Patch',
    description: '按 section patch working memory，而不是整块覆盖。',
    parameters: MEMORY_CONTEXT_PATCH_SCHEMA,
    execute: async (_toolCallId, params) => {
      const scope = resolveScope(params.scope)
      const next = await memoryProviderManager.patchWorkingMemory({
        scope,
        projectPath: scope === 'project' ? options.projectPath : undefined,
        heading: params.section,
        content: params.content,
        append: params.append,
      })
      return {
        content: [{ type: 'text', text: `working memory section 已更新：${params.section}` }],
        details: { scope, updatedAt: next.updatedAt },
      }
    },
  }

  const memoryThreadSearchTool: AgentTool<typeof MEMORY_THREAD_SEARCH_SCHEMA> = {
    name: 'memory_thread_search',
    label: 'Memory Thread Search',
    description: '搜索历史 conversation threads，返回 thread id / title / snippet / score。',
    parameters: MEMORY_THREAD_SEARCH_SCHEMA,
    execute: async (_toolCallId, params) => {
      const threads = await memoryProviderManager.searchThreads({
        query: params.query,
        limit: params.limit,
        source: params.source,
      })
      return {
        content: [{
          type: 'text',
          text: threads.length > 0
            ? threads.map((thread, index) => `${index + 1}. ${thread.title} [${thread.threadId}] score=${thread.relevanceScore.toFixed(3)}${thread.matchedMessages[0]?.snippet ? ` — ${thread.matchedMessages[0]!.snippet}` : ''}`).join('\n')
            : '没有找到相关线程。',
        }],
        details: { count: threads.length, threads },
      }
    },
  }

  const memoryThreadFetchTool: AgentTool<typeof MEMORY_THREAD_FETCH_SCHEMA> = {
    name: 'memory_thread_fetch',
    label: 'Memory Thread Fetch',
    description: '按 threadId + offset + limit 拉取完整历史片段。',
    parameters: MEMORY_THREAD_FETCH_SCHEMA,
    execute: async (_toolCallId, params) => {
      const thread = await memoryProviderManager.fetchThread({
        threadId: params.threadId,
        offset: params.offset,
        limit: params.limit,
      })
      if (!thread) {
        return {
          content: [{ type: 'text', text: '指定线程不存在或当前 provider 不支持 thread fetch。' }],
          details: { found: false },
        }
      }
      return {
        content: [{
          type: 'text',
          text: thread.messages.map((message, index) => `${index + 1}. [${message.role}] ${message.content}`).join('\n\n'),
        }],
        details: { found: true, thread },
      }
    },
  }

  const memoryTimelineTool: AgentTool<typeof MEMORY_TIMELINE_SCHEMA> = {
    name: 'memory_timeline',
    label: 'Memory Timeline',
    description: '查询最近的知识活动时间线事件。',
    parameters: MEMORY_TIMELINE_SCHEMA,
    execute: async (_toolCallId, params) => {
      const events = await memoryProviderManager.listTimelineEvents({
        lastNDays: params.lastNDays,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        eventType: params.eventType,
        tier1Only: params.tier1Only,
        limit: params.limit,
      })
      return {
        content: [{
          type: 'text',
          text: events.length > 0
            ? events.map((event, index) => `${index + 1}. ${event.createdAt} [${event.eventType}] ${event.title || event.description || ''}`.trim()).join('\n')
            : '没有匹配的时间线事件。',
        }],
        details: { count: events.length, events },
      }
    },
  }

  const memoryConnectionsTool: AgentTool<typeof MEMORY_CONNECTIONS_SCHEMA> = {
    name: 'memory_connections',
    label: 'Memory Connections',
    description: '探索某条记忆在知识图谱中的连接关系。',
    parameters: MEMORY_CONNECTIONS_SCHEMA,
    execute: async (_toolCallId, params) => {
      const result = await memoryProviderManager.getConnections({
        memoryId: params.memoryId,
        query: params.query,
      })
      if (!result) {
        return {
          content: [{ type: 'text', text: '没有可用的图连接结果。' }],
          details: { found: false },
        }
      }
      return {
        content: [{
          type: 'text',
          text: result.items.length > 0
            ? result.items.map((item, index) => `${index + 1}. [${item.edgeType}] ${item.title}${item.snippet ? ` — ${item.snippet}` : ''}`).join('\n')
            : '该记忆当前还没有图连接。',
        }],
        details: { found: true, result },
      }
    },
  }

  const notebookReadTool: AgentTool<typeof NOTEBOOK_READ_SCHEMA> = {
    name: 'notebook_read',
    label: 'Notebook Read',
    description: '读取本地 notebook 条目。',
    parameters: NOTEBOOK_READ_SCHEMA,
    execute: async (_toolCallId, params) => {
      const entry = await memoryProviderManager.readNotebookEntry(params.uri)
      if (!entry) {
        return {
          content: [{ type: 'text', text: '指定笔记不存在。' }],
          details: { found: false },
        }
      }
      return {
        content: [{ type: 'text', text: formatNotebookEntry(entry) }],
        details: { found: true, uri: entry.uri },
      }
    },
  }

  const notebookWriteTool: AgentTool<typeof NOTEBOOK_WRITE_SCHEMA> = {
    name: 'notebook_write',
    label: 'Notebook Write',
    description: '写入本地 notebook 条目。',
    parameters: NOTEBOOK_WRITE_SCHEMA,
    execute: async (_toolCallId, params) => {
      const entry = await memoryProviderManager.writeNotebookEntry({
        content: params.content,
        title: params.title,
        tags: params.tags,
        key: params.key,
        sourceSessionId: options.sessionId,
        projectPath: options.projectPath,
      })

      return {
        content: [{ type: 'text', text: `笔记已保存：${entry.uri}` }],
        details: { uri: entry.uri },
      }
    },
  }

  const notebookEditTool: AgentTool<typeof NOTEBOOK_EDIT_SCHEMA> = {
    name: 'notebook_edit',
    label: 'Notebook Edit',
    description: '编辑本地 notebook 条目。',
    parameters: NOTEBOOK_EDIT_SCHEMA,
    execute: async (_toolCallId, params) => {
      const entry = await memoryProviderManager.editNotebookEntry({
        uri: params.uri,
        content: params.content,
        title: params.title,
        tags: params.tags,
        key: params.key,
        projectPath: options.projectPath,
      })

      return {
        content: [{ type: 'text', text: entry ? `笔记已更新：${entry.uri}` : '指定笔记不存在。' }],
        details: { updated: Boolean(entry), uri: entry?.uri },
      }
    },
  }

  const notebookForgetTool: AgentTool<typeof NOTEBOOK_FORGET_SCHEMA> = {
    name: 'notebook_forget',
    label: 'Notebook Forget',
    description: '删除本地 notebook 条目。',
    parameters: NOTEBOOK_FORGET_SCHEMA,
    execute: async (_toolCallId, params) => {
      const deleted = await memoryProviderManager.forgetNotebookEntry(params.uri)
      return {
        content: [{ type: 'text', text: deleted ? `已删除笔记：${params.uri}` : '指定笔记不存在。' }],
        details: { deleted, uri: params.uri },
      }
    },
  }

  // 后端未配置时只注册 memory_status，避免 AI 盲调其他工具
  if (!options.backendAvailable) {
    return [memoryStatusTool]
  }

  return [
    memorySearchTool,
    memoryReadTool,
    memoryWriteTool,
    memoryEditTool,
    memoryForgetTool,
    memoryListTool,
    memoryContextTool,
    memoryContextPatchTool,
    memoryStatusTool,
    memoryThreadSearchTool,
    memoryThreadFetchTool,
    memoryTimelineTool,
    memoryConnectionsTool,
    notebookReadTool,
    notebookWriteTool,
    notebookEditTool,
    notebookForgetTool,
  ]
}
