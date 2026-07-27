import { getMemoryRuntimeConfig, isNowledgeConfigured, type MemoryRuntimeConfig } from './config'
import { NowledgeMemoryProvider } from './nowledge-provider'
import type { MemoryProvider } from './provider'
import { memoryStateStore } from './state-store'
import type {
  MemoryConnectionsInput,
  MemoryConnectionsResult,
  MemoryDuplicateGroup,
  MemoryEditInput,
  MemoryEntry,
  MemoryListInput,
  MemoryMergeDuplicatesInput,
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

const NOWLEDGE_HEALTH_CACHE_MS = 15_000

export interface MemoryProviderManagerDeps {
  getConfig?: () => MemoryRuntimeConfig
  createNowledgeProvider?: (config: MemoryRuntimeConfig) => MemoryProvider | null
}

function normalizeDuplicateText(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function duplicateSignature(entry: MemoryEntry): { signature: string; reason: string } | null {
  if (entry.key?.trim()) return { signature: `key:${entry.key.trim().toLowerCase()}`, reason: 'same key' }
  const title = normalizeDuplicateText(entry.title)
  if (title.length >= 8) return { signature: `title:${entry.category}:${title}`, reason: 'same normalized title and category' }
  const content = normalizeDuplicateText(entry.content).slice(0, 180)
  if (content.length >= 48) return { signature: `content:${entry.category}:${content}`, reason: 'same normalized content prefix and category' }
  return null
}

function mergeMemoryEntries(primary: MemoryEntry, duplicates: MemoryEntry[]): MemoryEditInput {
  const all = [primary, ...duplicates]
  const contentBlocks = Array.from(new Set(all.map((entry) => entry.content.trim()).filter(Boolean)))
  const latest = all.reduce((current, entry) => entry.updatedAt > current.updatedAt ? entry : current, primary)
  return {
    uri: primary.uri,
    key: primary.key ?? duplicates.find((entry) => entry.key)?.key,
    title: primary.title ?? duplicates.find((entry) => entry.title)?.title,
    category: latest.category,
    tags: Array.from(new Set(all.flatMap((entry) => entry.tags))),
    projectPath: primary.projectPath ?? latest.projectPath,
    content: contentBlocks.join('\n\n---\n\n'),
  }
}

/**
 * 记忆 Provider 管理器（仅 Nowledge）。
 *
 * Kila 记忆已收敛为“长期记忆只走 Nowledge”：不再有任何本地 Markdown 存储。
 * 未配置 Nowledge（未启用或地址无效）时，读/写/召回一律禁用（空结果或抛错），
 * 上层据此关闭召回注入、写回与记忆工具。
 */
export class MemoryProviderManager {
  private readonly getConfig: () => MemoryRuntimeConfig
  private readonly createNowledgeProvider: (config: MemoryRuntimeConfig) => MemoryProvider | null
  private nowledgeProvider: MemoryProvider | null = null
  private activeConfig: MemoryRuntimeConfig | null = null
  private initialized = false
  private nowledgeHealthy = false
  private lastCheckedAt = 0
  private detail = 'Nowledge 未配置，记忆功能已禁用'

  constructor(deps: MemoryProviderManagerDeps = {}) {
    this.getConfig = deps.getConfig ?? getMemoryRuntimeConfig
    this.createNowledgeProvider = deps.createNowledgeProvider ?? ((config) => {
      if (!isNowledgeConfigured(config) || !config.nowledgeBaseUrl) return null
      return new NowledgeMemoryProvider({
        baseUrl: config.nowledgeBaseUrl,
        apiKey: config.nowledgeApiKey,
        timeoutMs: config.nowledgeTimeoutMs,
        mode: 'nowledge',
      })
    })
  }

  async initialize(): Promise<void> {
    this.initialized = true
    await this.syncNowledgeWithConfig()
  }

  async dispose(): Promise<void> {
    await this.nowledgeProvider?.dispose()
    this.nowledgeProvider = null
    this.activeConfig = null
    this.nowledgeHealthy = false
    this.lastCheckedAt = 0
    this.initialized = false
  }

  /** 记忆功能是否可用：等价于 Nowledge 已配置且健康。 */
  async isMemoryAvailable(): Promise<boolean> {
    await this.initialize()
    return this.isNowledgeAvailable()
  }

  async search(input: MemorySearchInput): Promise<MemorySearchResult[]> {
    if (!await this.isMemoryAvailable()) return []
    try {
      return await this.nowledgeProvider!.search(input)
    } catch (error) {
      memoryStateStore.appendRuntimeEvent({
        eventType: 'nowledge_search_failed',
        status: 'warn',
        detail: error instanceof Error ? error.message : String(error),
      })
      return []
    }
  }

  async read(uri: string): Promise<MemoryEntry | null> {
    if (!await this.isMemoryAvailable()) return null
    return this.nowledgeProvider!.read(uri)
  }

  async write(input: MemoryWriteInput): Promise<MemoryEntry> {
    const provider = await this.getNowledgeMutationProvider()
    return provider.write(input)
  }

  async edit(input: MemoryEditInput): Promise<MemoryEntry | null> {
    const provider = await this.getNowledgeMutationProvider()
    return provider.edit(input)
  }

  async forget(uri: string): Promise<boolean> {
    const provider = await this.getNowledgeMutationProvider()
    return provider.forget(uri)
  }

  async list(input: MemoryListInput = {}): Promise<MemoryEntry[]> {
    if (!await this.isMemoryAvailable()) return []
    try {
      return await this.nowledgeProvider!.list(input)
    } catch (error) {
      memoryStateStore.appendRuntimeEvent({
        eventType: 'nowledge_list_failed',
        status: 'warn',
        detail: error instanceof Error ? error.message : String(error),
      })
      return []
    }
  }

  async listDuplicateGroups(input: { limit?: number } = {}): Promise<MemoryDuplicateGroup[]> {
    const entries = await this.list({ limit: Math.min(Math.max(input.limit ?? 100, 2), 500) })
    const groups = new Map<string, MemoryDuplicateGroup>()
    for (const entry of entries) {
      const signature = duplicateSignature(entry)
      if (!signature) continue
      const group = groups.get(signature.signature) ?? { signature: signature.signature, reason: signature.reason, items: [] }
      group.items.push(entry)
      groups.set(signature.signature, group)
    }
    return Array.from(groups.values())
      .filter((group) => group.items.length > 1)
      .map((group) => ({ ...group, items: group.items.sort((a, b) => b.updatedAt - a.updatedAt) }))
      .sort((a, b) => b.items[0]!.updatedAt - a.items[0]!.updatedAt)
      .slice(0, 50)
  }

  async mergeDuplicateMemories(input: MemoryMergeDuplicatesInput): Promise<MemoryEntry | null> {
    const primary = await this.read(input.primaryUri)
    if (!primary) return null
    const duplicates = (await Promise.all(
      input.duplicateUris.filter((uri) => uri !== input.primaryUri).map((uri) => this.read(uri)),
    )).filter((entry): entry is MemoryEntry => Boolean(entry))
    if (duplicates.length === 0) return primary
    const merged = await this.edit(mergeMemoryEntries(primary, duplicates))
    if (!merged) return null
    for (const duplicate of duplicates) await this.forget(duplicate.uri)
    return merged
  }

  async getWorkingMemory(input: WorkingMemoryInput): Promise<WorkingMemory | null> {
    // 项目级 working memory 仅本地实现，已随本地存储移除。
    if (input.scope === 'project') return null
    if (!await this.isMemoryAvailable()) return null
    return this.nowledgeProvider!.getWorkingMemory(input)
  }

  async setWorkingMemory(input: WorkingMemoryUpdateInput): Promise<WorkingMemory> {
    if (input.scope === 'project') throw new Error('项目级 working memory 已随本地存储移除')
    const provider = await this.getNowledgeMutationProvider()
    return provider.setWorkingMemory(input)
  }

  async patchWorkingMemory(input: WorkingMemoryPatchInput): Promise<WorkingMemory> {
    if (input.scope === 'project') throw new Error('项目级 working memory 已随本地存储移除')
    const provider = await this.getNowledgeMutationProvider()
    return provider.patchWorkingMemory(input)
  }

  async captureThread(input: MemoryThreadCaptureInput): Promise<void> {
    if (!await this.isMemoryAvailable()) return
    await this.nowledgeProvider!.captureThread(input)
  }

  async searchThreads(input: MemoryThreadSearchInput): Promise<MemoryThreadSearchResult[]> {
    if (!await this.isMemoryAvailable() || !this.nowledgeProvider?.searchThreads) return []
    return this.nowledgeProvider.searchThreads(input)
  }

  async fetchThread(input: MemoryThreadFetchInput): Promise<MemoryThreadFetchResult | null> {
    if (!await this.isMemoryAvailable() || !this.nowledgeProvider?.fetchThread) return null
    return this.nowledgeProvider.fetchThread(input)
  }

  async listTimelineEvents(input: MemoryTimelineInput): Promise<MemoryTimelineEvent[]> {
    if (!await this.isMemoryAvailable() || !this.nowledgeProvider?.listTimelineEvents) return []
    return this.nowledgeProvider.listTimelineEvents(input)
  }

  async getConnections(input: MemoryConnectionsInput): Promise<MemoryConnectionsResult | null> {
    if (!await this.isMemoryAvailable() || !this.nowledgeProvider?.getConnections) return null
    return this.nowledgeProvider.getConnections(input)
  }

  async deleteThread(threadId: string): Promise<boolean> {
    if (!await this.isMemoryAvailable() || !this.nowledgeProvider?.deleteThread) return false
    return this.nowledgeProvider.deleteThread(threadId)
  }

  async cleanupSession(sessionId: string): Promise<void> {
    const state = memoryStateStore.getThreadState(sessionId)
    if (state?.threadId) await this.deleteThread(state.threadId).catch(() => false)
    memoryStateStore.deleteSessionState(sessionId)
  }

  async getStatus(): Promise<MemoryProviderStatus> {
    await this.initialize()
    const config = this.getConfig()
    const configured = isNowledgeConfigured(config)
    const healthy = configured ? await this.refreshNowledgeHealth() : false
    const nowledgeStatus = healthy ? await this.nowledgeProvider?.getStatus() : undefined
    return {
      mode: 'nowledge',
      activeProvider: 'nowledge',
      // 本地存储已移除：这两个字段只为兼容既有状态类型保留，恒为不可用。
      localReady: false,
      memoryDirectory: '',
      nowledgeEnabled: config.nowledgeEnabled,
      nowledgeConfigured: configured,
      nowledgeHealthy: healthy,
      nowledgeBackendVersion: nowledgeStatus?.nowledgeBackendVersion,
      checkedAt: this.lastCheckedAt || Date.now(),
      detail: configured
        ? healthy
          ? 'Nowledge 本地 API 可用；记忆仅由 Nowledge 管理'
          : this.detail
        : 'Nowledge 未配置，记忆功能已禁用',
    }
  }

  private async getNowledgeMutationProvider(): Promise<MemoryProvider> {
    await this.initialize()
    const config = this.getConfig()
    if (!config.nowledgeEnabled) {
      throw new Error('Nowledge 未启用，记忆功能已禁用')
    }
    if (!isNowledgeConfigured(config) || !this.nowledgeProvider) {
      throw new Error('Nowledge 已启用，但本地服务地址尚未正确配置')
    }
    if (!await this.refreshNowledgeHealth()) {
      throw new Error(`Nowledge 已启用但当前不可用：${this.detail}`)
    }
    return this.nowledgeProvider
  }

  private async isNowledgeAvailable(): Promise<boolean> {
    const config = this.getConfig()
    return Boolean(
      config.nowledgeEnabled
      && isNowledgeConfigured(config)
      && this.nowledgeProvider
      && await this.refreshNowledgeHealth()
    )
  }

  private async syncNowledgeWithConfig(): Promise<void> {
    const config = this.getConfig()
    if (this.configEquals(this.activeConfig, config)) return
    await this.nowledgeProvider?.dispose()
    this.nowledgeProvider = null
    this.activeConfig = { ...config }
    this.lastCheckedAt = 0

    if (!isNowledgeConfigured(config)) {
      this.nowledgeHealthy = false
      this.lastCheckedAt = Date.now()
      this.detail = config.nowledgeEnabled
        ? 'Nowledge 已启用，但本地服务地址尚未正确配置'
        : 'Nowledge 未配置，记忆功能已禁用'
      return
    }

    this.nowledgeProvider = this.createNowledgeProvider(config)
    if (!this.nowledgeProvider) {
      this.nowledgeHealthy = false
      this.lastCheckedAt = Date.now()
      this.detail = 'Nowledge Provider 初始化失败'
      return
    }
    await this.nowledgeProvider.initialize()
    await this.refreshNowledgeHealth()
  }

  private async refreshNowledgeHealth(): Promise<boolean> {
    if (!this.nowledgeProvider) return false
    if (this.lastCheckedAt > 0 && Date.now() - this.lastCheckedAt < NOWLEDGE_HEALTH_CACHE_MS) {
      return this.nowledgeHealthy
    }
    try {
      this.nowledgeHealthy = await this.nowledgeProvider.healthCheck()
      this.detail = this.nowledgeHealthy ? 'Nowledge 本地 API 可用' : 'Nowledge 健康检查失败'
    } catch (error) {
      this.nowledgeHealthy = false
      this.detail = error instanceof Error ? error.message : String(error)
    }
    this.lastCheckedAt = Date.now()
    return this.nowledgeHealthy
  }

  private configEquals(a: MemoryRuntimeConfig | null, b: MemoryRuntimeConfig): boolean {
    return Boolean(a
      && a.nowledgeEnabled === b.nowledgeEnabled
      && a.nowledgeBaseUrl === b.nowledgeBaseUrl
      && a.nowledgeApiKey === b.nowledgeApiKey
      && a.nowledgeTimeoutMs === b.nowledgeTimeoutMs)
  }
}
export const memoryProviderManager = new MemoryProviderManager()
