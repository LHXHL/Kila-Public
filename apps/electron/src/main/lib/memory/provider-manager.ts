import { getMemoryRuntimeConfig, isNowledgeConfigured, type MemoryRuntimeConfig } from './config'
import { LocalMarkdownMemoryProvider } from './local-markdown-provider'
import { NowledgeMemoryProvider } from './nowledge-provider'
import { pendingMemoryWriteBuffer } from './pending-write-buffer'
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
  MemoryProviderMode,
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
  QueuedMemoryWriteView,
  WorkingMemory,
  WorkingMemoryInput,
  WorkingMemoryPatchInput,
  WorkingMemoryUpdateInput,
} from './types'

const NOWLEDGE_HEALTH_CACHE_MS = 15_000

export type LocalMemoryProviderLike = MemoryProvider & Pick<
  LocalMarkdownMemoryProvider,
  | 'listNotebookEntries'
  | 'readNotebookEntry'
  | 'writeNotebookEntry'
  | 'editNotebookEntry'
  | 'forgetNotebookEntry'
  | 'getIndexContext'
>

export interface MemoryProviderManagerDeps {
  getConfig?: () => MemoryRuntimeConfig
  localProvider?: LocalMemoryProviderLike
  createNowledgeProvider?: (config: MemoryRuntimeConfig) => MemoryProvider | null
}

function normalizeDuplicateText(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 合并本地兼容记忆与 Nowledge 记忆。
 * 同内容时保留当前长期记忆来源，避免设置页展示错误后端的重复条目。
 */
export function mergeMemoryLists(
  localEntries: MemoryEntry[],
  nowledgeEntries: MemoryEntry[],
  input: MemoryListInput = {},
  preferredProvider: MemoryProviderMode = 'local',
): MemoryEntry[] {
  const seenContent = new Set<string>()
  const merged: MemoryEntry[] = []
  const orderedEntries = preferredProvider === 'nowledge'
    ? [...nowledgeEntries, ...localEntries]
    : [...localEntries, ...nowledgeEntries]

  for (const entry of orderedEntries) {
    const signature = normalizeDuplicateText(entry.content)
    if (signature && seenContent.has(signature)) continue
    if (signature) seenContent.add(signature)
    merged.push(entry)
  }

  merged.sort((a, b) => b.updatedAt - a.updatedAt)
  const offset = Math.max(Math.floor(input.offset ?? 0), 0)
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 50), 1), 500)
  return merged.slice(offset, offset + limit)
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

function patchMarkdownSection(
  currentContent: string,
  heading: string,
  input: Pick<WorkingMemoryPatchInput, 'content' | 'append'>,
): string {
  const trimmedHeading = heading.trim()
  if (!trimmedHeading) throw new Error('working memory patch heading is required')
  if (!currentContent.trim()) {
    return `${trimmedHeading}\n${(input.append ?? input.content ?? '').trim()}`.trim()
  }

  const lines = currentContent.split('\n')
  const headingLc = trimmedHeading.toLowerCase()
  const targetLevel = trimmedHeading.match(/^(#{1,6})\s/)?.[1]?.length ?? 2
  const startIndex = lines.findIndex((line) => line.trim().toLowerCase() === headingLc)
  if (startIndex < 0) {
    return `${currentContent.trimEnd()}\n\n${trimmedHeading}\n${(input.append ?? input.content ?? '').trim()}`.trim()
  }

  let endIndex = lines.length
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const match = lines[index]!.match(/^(#{1,6})\s/)
    if (match && match[1]!.length <= targetLevel) {
      endIndex = index
      break
    }
  }
  const existingBody = lines.slice(startIndex + 1, endIndex).join('\n').trimEnd()
  const nextBody = typeof input.append === 'string'
    ? [existingBody, input.append.trim()].filter(Boolean).join('\n')
    : (input.content ?? '').trim()
  return [...lines.slice(0, startIndex), lines[startIndex]!, nextBody, ...lines.slice(endIndex)].join('\n').trim()
}

export class MemoryProviderManager {
  private readonly localProvider: LocalMemoryProviderLike
  private readonly getConfig: () => MemoryRuntimeConfig
  private readonly createNowledgeProvider: (config: MemoryRuntimeConfig) => MemoryProvider | null
  private nowledgeProvider: MemoryProvider | null = null
  private activeConfig: MemoryRuntimeConfig | null = null
  private initialized = false
  private nowledgeHealthy = false
  private lastCheckedAt = 0
  private detail = '本地 Markdown 存储可用'

  constructor(deps: MemoryProviderManagerDeps = {}) {
    this.localProvider = deps.localProvider ?? new LocalMarkdownMemoryProvider()
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
    if (!this.initialized) {
      await this.localProvider.initialize()
      this.initialized = true
    }
    await this.syncNowledgeWithConfig()
  }

  async dispose(): Promise<void> {
    await this.nowledgeProvider?.dispose()
    await this.localProvider.dispose()
    this.nowledgeProvider = null
    this.activeConfig = null
    this.nowledgeHealthy = false
    this.lastCheckedAt = 0
    this.initialized = false
  }

  async search(input: MemorySearchInput): Promise<MemorySearchResult[]> {
    await this.initialize()
    const localResults = await this.localProvider.search(input)
    if (!await this.isNowledgeAvailable()) return localResults

    try {
      const externalResults = await this.nowledgeProvider!.search(input)
      const seen = new Set<string>()
      return [...externalResults, ...localResults]
        .filter((result) => {
          const key = normalizeDuplicateText(result.entry.content)
          if (key && seen.has(key)) return false
          if (key) seen.add(key)
          return true
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.min(Math.max(input.limit ?? 4, 1), 10))
    } catch (error) {
      memoryStateStore.appendRuntimeEvent({
        eventType: 'nowledge_search_failed',
        status: 'warn',
        detail: error instanceof Error ? error.message : String(error),
      })
      return localResults
    }
  }

  async read(uri: string): Promise<MemoryEntry | null> {
    await this.initialize()
    if (this.isLocalMemoryUri(uri)) return this.localProvider.read(uri)
    if (await this.isNowledgeAvailable()) return this.nowledgeProvider!.read(uri)
    return null
  }

  async write(input: MemoryWriteInput): Promise<MemoryEntry> {
    const provider = await this.getLongTermWriteProvider()
    return provider.write(input)
  }

  async edit(input: MemoryEditInput): Promise<MemoryEntry | null> {
    await this.initialize()
    if (this.isLocalMemoryUri(input.uri)) return this.localProvider.edit(input)
    const provider = await this.getNowledgeMutationProvider()
    return provider.edit(input)
  }

  async forget(uri: string): Promise<boolean> {
    await this.initialize()
    if (this.isLocalMemoryUri(uri)) return this.localProvider.forget(uri)
    const provider = await this.getNowledgeMutationProvider()
    return provider.forget(uri)
  }

  async list(input: MemoryListInput = {}): Promise<MemoryEntry[]> {
    await this.initialize()
    const offset = Math.max(Math.floor(input.offset ?? 0), 0)
    const limit = Math.min(Math.max(Math.floor(input.limit ?? 50), 1), 500)
    const sourceInput = { ...input, offset: 0, limit: offset + limit }
    const localEntries = await this.localProvider.list(sourceInput)

    if (!await this.isNowledgeAvailable()) {
      return mergeMemoryLists(localEntries, [], input)
    }

    try {
      const nowledgeEntries = await this.nowledgeProvider!.list(sourceInput)
      return mergeMemoryLists(localEntries, nowledgeEntries, input, 'nowledge')
    } catch (error) {
      memoryStateStore.appendRuntimeEvent({
        eventType: 'nowledge_list_failed',
        status: 'warn',
        detail: error instanceof Error ? error.message : String(error),
      })
      return mergeMemoryLists(localEntries, [], input)
    }
  }

  async listDuplicateGroups(input: { limit?: number } = {}): Promise<MemoryDuplicateGroup[]> {
    await this.initialize()
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

  listPendingWrites(sessionId?: string): QueuedMemoryWriteView[] {
    return pendingMemoryWriteBuffer.list(sessionId)
  }

  clearPendingWrites(sessionId?: string): number {
    const count = pendingMemoryWriteBuffer.list(sessionId).length
    pendingMemoryWriteBuffer.clear(sessionId)
    return count
  }

  async getWorkingMemory(input: WorkingMemoryInput): Promise<WorkingMemory | null> {
    await this.initialize()
    if (input.scope === 'project') return this.localProvider.getWorkingMemory(input)
    if (!await this.isNowledgeAvailable()) return this.localProvider.getWorkingMemory(input)
    return this.nowledgeProvider!.getWorkingMemory(input)
  }

  async setWorkingMemory(input: WorkingMemoryUpdateInput): Promise<WorkingMemory> {
    await this.initialize()
    if (input.scope === 'project') return this.localProvider.setWorkingMemory(input)
    const provider = await this.getLongTermWriteProvider()
    return provider.setWorkingMemory(input)
  }

  async patchWorkingMemory(input: WorkingMemoryPatchInput): Promise<WorkingMemory> {
    await this.initialize()
    const provider = input.scope === 'project'
      ? this.localProvider
      : await this.getLongTermWriteProvider()
    if (provider.patchWorkingMemory) return provider.patchWorkingMemory(input)
    const current = await provider.getWorkingMemory(input)
    return provider.setWorkingMemory({
      scope: input.scope,
      projectPath: input.projectPath,
      content: patchMarkdownSection(current?.content ?? '', input.heading, input),
    })
  }

  async listNotebookEntries(input?: MemoryListInput): Promise<NotebookEntry[]> {
    await this.initialize()
    return this.localProvider.listNotebookEntries(input)
  }

  async readNotebookEntry(uri: string): Promise<NotebookEntry | null> {
    await this.initialize()
    return this.localProvider.readNotebookEntry(uri)
  }

  async writeNotebookEntry(input: NotebookWriteInput): Promise<NotebookEntry> {
    await this.initialize()
    return this.localProvider.writeNotebookEntry(input)
  }

  async editNotebookEntry(input: NotebookEditInput): Promise<NotebookEntry | null> {
    await this.initialize()
    return this.localProvider.editNotebookEntry(input)
  }

  async forgetNotebookEntry(uri: string): Promise<boolean> {
    await this.initialize()
    return this.localProvider.forgetNotebookEntry(uri)
  }

  async captureThread(input: MemoryThreadCaptureInput): Promise<void> {
    await this.initialize()
    if (!await this.isNowledgeAvailable()) return
    await this.nowledgeProvider!.captureThread(input)
  }

  async searchThreads(input: MemoryThreadSearchInput): Promise<MemoryThreadSearchResult[]> {
    await this.initialize()
    if (!this.nowledgeProvider?.searchThreads || !await this.isNowledgeAvailable()) return []
    return this.nowledgeProvider.searchThreads(input)
  }

  async fetchThread(input: MemoryThreadFetchInput): Promise<MemoryThreadFetchResult | null> {
    await this.initialize()
    if (!this.nowledgeProvider?.fetchThread || !await this.isNowledgeAvailable()) return null
    return this.nowledgeProvider.fetchThread(input)
  }

  async listTimelineEvents(input: MemoryTimelineInput): Promise<MemoryTimelineEvent[]> {
    await this.initialize()
    if (!this.nowledgeProvider?.listTimelineEvents || !await this.isNowledgeAvailable()) return []
    return this.nowledgeProvider.listTimelineEvents(input)
  }

  async getConnections(input: MemoryConnectionsInput): Promise<MemoryConnectionsResult | null> {
    await this.initialize()
    if (!this.nowledgeProvider?.getConnections || !await this.isNowledgeAvailable()) return null
    return this.nowledgeProvider.getConnections(input)
  }

  async deleteThread(threadId: string): Promise<boolean> {
    await this.initialize()
    if (!this.nowledgeProvider?.deleteThread || !await this.isNowledgeAvailable()) return false
    return this.nowledgeProvider.deleteThread(threadId)
  }

  async cleanupSession(sessionId: string): Promise<void> {
    const state = memoryStateStore.getThreadState(sessionId)
    if (state?.threadId) await this.deleteThread(state.threadId).catch(() => false)
    memoryStateStore.deleteSessionState(sessionId)
  }

  getIndexContext(projectPath?: string): string {
    return this.localProvider.getIndexContext(projectPath)
  }

  async getStatus(): Promise<MemoryProviderStatus> {
    await this.initialize()
    const config = this.getConfig()
    const localStatus = await this.localProvider.getStatus()
    const configured = isNowledgeConfigured(config)
    const healthy = configured ? await this.refreshNowledgeHealth() : false
    const nowledgeStatus = healthy ? await this.nowledgeProvider?.getStatus() : undefined
    const selectedProvider: MemoryProviderMode = config.nowledgeEnabled ? 'nowledge' : 'local'
    return {
      mode: selectedProvider,
      activeProvider: selectedProvider,
      localReady: localStatus.localReady,
      memoryDirectory: localStatus.memoryDirectory,
      nowledgeEnabled: config.nowledgeEnabled,
      nowledgeConfigured: configured,
      nowledgeHealthy: healthy,
      nowledgeBackendVersion: nowledgeStatus?.nowledgeBackendVersion,
      checkedAt: this.lastCheckedAt || Date.now(),
      detail: config.nowledgeEnabled
        ? healthy
          ? 'Nowledge 本地 API 可用；Embedding 凭证由 Nowledge 管理'
          : this.detail
        : '本地 Markdown 长期记忆可用',
    }
  }

  private async getLongTermWriteProvider(): Promise<MemoryProvider> {
    await this.initialize()
    const config = this.getConfig()
    if (!config.nowledgeEnabled) return this.localProvider
    return this.getNowledgeMutationProvider()
  }

  private async getNowledgeMutationProvider(): Promise<MemoryProvider> {
    const config = this.getConfig()
    if (!config.nowledgeEnabled) {
      throw new Error('Nowledge 未启用，无法修改该长期记忆')
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

  private isLocalMemoryUri(uri: string): boolean {
    return uri.startsWith('memory://global/') || uri.startsWith('memory://project/')
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
        : '本地 Markdown 长期记忆可用；Nowledge 未启用'
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
