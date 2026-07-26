import { describe, expect, test } from 'bun:test'
import type { MemoryProvider } from './provider'
import { MemoryProviderManager } from './provider-manager'
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

class FakeNowledgeProvider implements MemoryProvider {
  readonly calls: string[] = []
  readonly entries = new Map<string, MemoryEntry>()
  health = true
  workingMemory: WorkingMemory | null = null

  initialize(): void {}
  dispose(): void {}

  async healthCheck(): Promise<boolean> {
    return this.health
  }

  async getStatus(): Promise<MemoryProviderStatus> {
    return {
      mode: 'nowledge',
      activeProvider: 'nowledge',
      localReady: false,
      memoryDirectory: '',
      nowledgeEnabled: true,
      nowledgeConfigured: true,
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
      uri: `memory://written-${this.calls.filter((call) => call === 'write').length}`,
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
    const content = input.append ? `${current}\n${input.append}`.trim() : input.content ?? current
    return this.setWorkingMemory({ scope: input.scope, projectPath: input.projectPath, content })
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
}

function config(nowledgeEnabled: boolean) {
  return {
    nowledgeEnabled,
    nowledgeBaseUrl: 'http://127.0.0.1:14242',
    nowledgeTimeoutMs: 100,
    sessionContextEnabled: true,
  }
}

describe('MemoryProviderManager 仅 Nowledge 路由', () => {
  function createManager(nowledgeEnabled: boolean, nowledge = new FakeNowledgeProvider()) {
    return {
      nowledge,
      manager: new MemoryProviderManager({
        getConfig: () => config(nowledgeEnabled),
        createNowledgeProvider: () => (nowledgeEnabled ? nowledge : null),
      }),
    }
  }

  test('Given Nowledge 健康且已启用，When 写入长期记忆，Then 调用 Nowledge', async () => {
    const { manager, nowledge } = createManager(true)
    await manager.write({ content: '回复优先使用中文', category: 'preference' })
    expect(nowledge.calls).toContain('write')
  })

  test('Given Nowledge 已启用但离线，When 写入长期记忆，Then 明确失败', async () => {
    const nowledge = new FakeNowledgeProvider()
    nowledge.health = false
    const { manager } = createManager(true, nowledge)
    await expect(manager.write({ content: '不得静默回退' })).rejects.toThrow('Nowledge 已启用但当前不可用')
  })

  test('Given Nowledge 未启用，When 写入长期记忆，Then 抛错（记忆已禁用），不写本地', async () => {
    const { manager } = createManager(false)
    await expect(manager.write({ content: '未配置不应写入' })).rejects.toThrow('Nowledge 未启用')
  })

  test('Given Nowledge 未启用，When 读/搜/列，Then 返回空且不抛错（记忆禁用）', async () => {
    const { manager } = createManager(false)
    expect(await manager.search({ query: 'x' })).toEqual([])
    expect(await manager.list({})).toEqual([])
    expect(await manager.read('memory://nmem-1')).toBeNull()
  })

  test('Given Nowledge 已启用，When 编辑/删除，Then 路由到 Nowledge', async () => {
    const { manager, nowledge } = createManager(true)
    nowledge.entries.set('memory://nmem-1', memory({ uri: 'memory://nmem-1', content: '远端', updatedAt: 1 }))
    await manager.edit({ uri: 'memory://nmem-1', content: '远端更新' })
    await manager.forget('memory://nmem-1')
    expect(nowledge.calls).toContain('edit:memory://nmem-1')
    expect(nowledge.calls).toContain('forget:memory://nmem-1')
  })

  test('Given Nowledge 已启用，When 更新全局 Working Memory，Then 走 Nowledge；项目级抛错（已移除）', async () => {
    const { manager, nowledge } = createManager(true)
    await manager.setWorkingMemory({ scope: 'global', content: '全局约束' })
    expect(nowledge.calls).toContain('setWorkingMemory')
    await expect(manager.setWorkingMemory({ scope: 'project', projectPath: '/tmp/p', content: 'x' }))
      .rejects.toThrow('项目级 working memory 已随本地存储移除')
  })

  test('Given Nowledge 未启用，When 查询状态，Then 记忆不可用', async () => {
    const { manager } = createManager(false)
    const status = await manager.getStatus()
    expect(status.nowledgeConfigured).toBe(false)
    expect(status.localReady).toBe(false)
    expect(await manager.isMemoryAvailable()).toBe(false)
  })
})
