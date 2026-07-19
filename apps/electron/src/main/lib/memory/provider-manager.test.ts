import { describe, expect, test } from 'bun:test'
import type { MemoryProvider } from './provider'
import { MemoryProviderManager, mergeMemoryLists } from './provider-manager'
import type {
  MemoryConnectionsInput,
  MemoryConnectionsResult,
  MemoryEditInput,
  MemoryEntry,
  MemoryListInput,
  MemoryProviderStatus,
  MemorySearchInput,
  MemorySearchResult,
  MemoryThreadCaptureInput,
  MemoryThreadFetchInput,
  MemoryThreadFetchResult,
  MemoryThreadSearchInput,
  MemoryThreadSearchResult,
  MemoryTimelineEvent,
  MemoryTimelineInput,
  MemoryWriteInput,
  NotebookEditInput,
  NotebookEntry,
  NotebookWriteInput,
  WorkingMemory,
  WorkingMemoryInput,
  WorkingMemoryPatchInput,
  WorkingMemoryUpdateInput,
} from './types'

function memory(input: Pick<MemoryEntry, 'uri' | 'content' | 'updatedAt'> & Partial<MemoryEntry>): MemoryEntry {
  return {
    kind: 'memory',
    id: input.uri.replace('memory://', ''),
    uri: input.uri,
    content: input.content,
    tags: input.tags ?? [],
    category: input.category ?? 'general',
    createdAt: input.createdAt ?? input.updatedAt,
    updatedAt: input.updatedAt,
    key: input.key,
    title: input.title,
    sourceSessionId: input.sourceSessionId,
    projectPath: input.projectPath,
  }
}

class FakeMemoryProvider implements MemoryProvider {
  readonly calls: string[] = []
  readonly entries = new Map<string, MemoryEntry>()
  health = true
  workingMemory: WorkingMemory | null = null

  constructor(private readonly name: string) {}

  initialize(): void {}

  dispose(): void {}

  async healthCheck(): Promise<boolean> {
    return this.health
  }

  async getStatus(): Promise<MemoryProviderStatus> {
    return {
      mode: this.name === 'nowledge' ? 'nowledge' : 'local',
      activeProvider: this.name === 'nowledge' ? 'nowledge' : 'local',
      localReady: true,
      memoryDirectory: this.name === 'local' ? '/tmp/kila-memory-test' : '',
      nowledgeEnabled: this.name === 'nowledge',
      nowledgeConfigured: this.name === 'nowledge',
      nowledgeHealthy: this.health,
      checkedAt: Date.now(),
    }
  }

  async search(_input: MemorySearchInput): Promise<MemorySearchResult[]> {
    this.calls.push('search')
    return []
  }

  async read(uri: string): Promise<MemoryEntry | null> {
    this.calls.push(`read:${uri}`)
    return this.entries.get(uri) ?? null
  }

  async write(input: MemoryWriteInput): Promise<MemoryEntry> {
    this.calls.push('write')
    const entry = memory({
      uri: `memory://${this.name}/written-${this.calls.filter((call) => call === 'write').length}`,
      content: input.content,
      title: input.title,
      tags: input.tags,
      category: input.category,
      key: input.key,
      projectPath: input.projectPath,
      updatedAt: Date.now(),
    })
    this.entries.set(entry.uri, entry)
    return entry
  }

  async edit(input: MemoryEditInput): Promise<MemoryEntry | null> {
    this.calls.push(`edit:${input.uri}`)
    const current = this.entries.get(input.uri)
    if (!current) return memory({ uri: input.uri, content: input.content ?? '', updatedAt: Date.now() })
    const next = { ...current, ...input, kind: 'memory' as const, updatedAt: Date.now() }
    this.entries.set(input.uri, next)
    return next
  }

  async forget(uri: string): Promise<boolean> {
    this.calls.push(`forget:${uri}`)
    return this.entries.delete(uri)
  }

  async list(_input?: MemoryListInput): Promise<MemoryEntry[]> {
    this.calls.push('list')
    return Array.from(this.entries.values())
  }

  async captureThread(_input: MemoryThreadCaptureInput): Promise<void> {
    this.calls.push('captureThread')
  }

  async getWorkingMemory(_input: WorkingMemoryInput): Promise<WorkingMemory | null> {
    this.calls.push('getWorkingMemory')
    return this.workingMemory
  }

  async setWorkingMemory(input: WorkingMemoryUpdateInput): Promise<WorkingMemory> {
    this.calls.push('setWorkingMemory')
    this.workingMemory = {
      scope: input.scope,
      projectPath: input.projectPath,
      content: input.content,
      updatedAt: Date.now(),
    }
    return this.workingMemory
  }

  async patchWorkingMemory(input: WorkingMemoryPatchInput): Promise<WorkingMemory> {
    this.calls.push('patchWorkingMemory')
    const current = this.workingMemory?.content ?? ''
    const content = input.append
      ? `${current}\n${input.append}`.trim()
      : input.content ?? current
    return this.setWorkingMemory({
      scope: input.scope,
      projectPath: input.projectPath,
      content,
    })
  }

  async searchThreads(_input: MemoryThreadSearchInput): Promise<MemoryThreadSearchResult[]> {
    this.calls.push('searchThreads')
    return []
  }

  async fetchThread(_input: MemoryThreadFetchInput): Promise<MemoryThreadFetchResult | null> {
    this.calls.push('fetchThread')
    return null
  }

  async deleteThread(_threadId: string): Promise<boolean> {
    this.calls.push('deleteThread')
    return true
  }

  async listTimelineEvents(_input: MemoryTimelineInput): Promise<MemoryTimelineEvent[]> {
    this.calls.push('listTimelineEvents')
    return []
  }

  async getConnections(_input: MemoryConnectionsInput): Promise<MemoryConnectionsResult | null> {
    this.calls.push('getConnections')
    return null
  }

  listNotebookEntries(_input?: MemoryListInput): Promise<NotebookEntry[]> {
    return Promise.resolve([])
  }

  readNotebookEntry(_uri: string): Promise<NotebookEntry | null> {
    return Promise.resolve(null)
  }

  writeNotebookEntry(_input: NotebookWriteInput): Promise<NotebookEntry> {
    throw new Error('not used in provider routing tests')
  }

  editNotebookEntry(_input: NotebookEditInput): Promise<NotebookEntry | null> {
    throw new Error('not used in provider routing tests')
  }

  forgetNotebookEntry(_uri: string): Promise<boolean> {
    throw new Error('not used in provider routing tests')
  }

  getIndexContext(_projectPath?: string): string {
    return ''
  }
}

function config(nowledgeEnabled: boolean) {
  return {
    nowledgeEnabled,
    nowledgeBaseUrl: 'http://127.0.0.1:14242',
    nowledgeTimeoutMs: 100,
    sessionContextEnabled: true,
  }
}

describe('MemoryProviderManager list aggregation', () => {
  test('Given 本地与 Nowledge 都有记忆，When 合并长期记忆列表，Then 历史 Nowledge 条目不会被隐藏', () => {
    const local = memory({
      uri: 'memory://global/local-1',
      content: 'Kila 本地 Markdown 记忆',
      updatedAt: 200,
    })
    const nowledge = memory({
      uri: 'memory://nowledge-1',
      content: '重构前保存在 Nowledge 的历史记忆',
      updatedAt: 100,
    })

    const result = mergeMemoryLists([local], [nowledge], { limit: 10 })

    expect(result.map((entry) => entry.uri)).toEqual([
      'memory://global/local-1',
      'memory://nowledge-1',
    ])
  })

  test('Given 两端存在相同内容，When 合并并分页，Then 本地条目优先且分页稳定', () => {
    const local = memory({
      uri: 'memory://global/local-duplicate',
      content: '回复优先使用中文。',
      updatedAt: 300,
    })
    const duplicate = memory({
      uri: 'memory://nowledge-duplicate',
      content: '回复优先使用中文。',
      updatedAt: 250,
    })
    const historical = memory({
      uri: 'memory://nowledge-historical',
      content: '历史项目使用 Bun。',
      updatedAt: 200,
    })

    const result = mergeMemoryLists([local], [duplicate, historical], { offset: 1, limit: 1 })

    expect(result).toHaveLength(1)
    expect(result[0]?.uri).toBe('memory://nowledge-historical')
  })

  test('Given Nowledge 是当前后端，When 合并相同内容，Then Nowledge 条目优先', () => {
    const local = memory({ uri: 'memory://global/legacy', content: '同一条记忆', updatedAt: 300 })
    const nowledge = memory({ uri: 'memory://nmem-1', content: '同一条记忆', updatedAt: 200 })

    const result = mergeMemoryLists([local], [nowledge], { limit: 10 }, 'nowledge')

    expect(result.map((entry) => entry.uri)).toEqual(['memory://nmem-1'])
  })
})

describe('MemoryProviderManager provider routing', () => {
  function createManager(nowledgeEnabled: boolean, nowledge: FakeMemoryProvider, local = new FakeMemoryProvider('local')) {
    return {
      local,
      nowledge,
      manager: new MemoryProviderManager({
        getConfig: () => config(nowledgeEnabled),
        localProvider: local,
        createNowledgeProvider: () => nowledge,
      }),
    }
  }

  test('Given Nowledge 健康且已启用，When 写入长期记忆，Then 只调用 Nowledge', async () => {
    const { manager, local, nowledge } = createManager(true, new FakeMemoryProvider('nowledge'))

    await manager.write({ content: '回复优先使用中文', category: 'preference' })

    expect(nowledge.calls).toContain('write')
    expect(local.calls).not.toContain('write')
  })

  test('Given Nowledge 已启用但离线，When 写入长期记忆，Then 明确失败且不回退本地', async () => {
    const nowledge = new FakeMemoryProvider('nowledge')
    nowledge.health = false
    const { manager, local } = createManager(true, nowledge)

    await expect(manager.write({ content: '不得静默回退' })).rejects.toThrow('Nowledge 已启用但当前不可用')

    expect(local.calls).not.toContain('write')
  })

  test('Given Nowledge 未启用，When 写入长期记忆，Then 使用本地 Markdown', async () => {
    const { manager, local, nowledge } = createManager(false, new FakeMemoryProvider('nowledge'))

    await manager.write({ content: '本地长期记忆' })

    expect(local.calls).toContain('write')
    expect(nowledge.calls).toEqual([])
  })

  test('Given 记忆 URI 指向不同后端，When 编辑或删除，Then 按 URI 路由到对应 Provider', async () => {
    const { manager, local, nowledge } = createManager(true, new FakeMemoryProvider('nowledge'))
    local.entries.set('memory://global/local-1', memory({ uri: 'memory://global/local-1', content: '本地', updatedAt: 1 }))
    nowledge.entries.set('memory://nmem-1', memory({ uri: 'memory://nmem-1', content: '远端', updatedAt: 1 }))

    await manager.edit({ uri: 'memory://global/local-1', content: '本地更新' })
    await manager.edit({ uri: 'memory://nmem-1', content: '远端更新' })
    await manager.forget('memory://global/local-1')
    await manager.forget('memory://nmem-1')

    expect(local.calls).toContain('edit:memory://global/local-1')
    expect(local.calls).toContain('forget:memory://global/local-1')
    expect(nowledge.calls).toContain('edit:memory://nmem-1')
    expect(nowledge.calls).toContain('forget:memory://nmem-1')
  })

  test('Given Nowledge 已启用，When 更新全局与项目 Working Memory，Then 全局走 Nowledge、项目走本地', async () => {
    const { manager, local, nowledge } = createManager(true, new FakeMemoryProvider('nowledge'))

    await manager.setWorkingMemory({ scope: 'global', content: '全局约束' })
    await manager.setWorkingMemory({ scope: 'project', projectPath: '/tmp/project', content: '项目约束' })

    expect(nowledge.calls).toContain('setWorkingMemory')
    expect(local.calls).toContain('setWorkingMemory')
  })
})
