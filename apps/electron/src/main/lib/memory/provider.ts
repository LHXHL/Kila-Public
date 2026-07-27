import type {
  MemoryEditInput,
  MemoryEntry,
  MemoryListInput,
  MemoryProviderStatus,
  MemorySearchInput,
  MemorySearchResult,
  MemoryThreadFetchInput,
  MemoryThreadFetchResult,
  MemoryThreadSearchInput,
  MemoryThreadSearchResult,
  MemoryTimelineEvent,
  MemoryTimelineInput,
  MemoryConnectionsInput,
  MemoryConnectionsResult,
  MemoryThreadCaptureInput,
  MemoryWriteInput,
  WorkingMemory,
  WorkingMemoryInput,
  WorkingMemoryPatchInput,
  WorkingMemoryUpdateInput,
} from './types'

export interface MemoryProvider {
  initialize(): Promise<void> | void
  dispose(): Promise<void> | void
  healthCheck(): Promise<boolean>
  getStatus(): Promise<MemoryProviderStatus>
  search(input: MemorySearchInput): Promise<MemorySearchResult[]>
  read(uri: string): Promise<MemoryEntry | null>
  write(input: MemoryWriteInput): Promise<MemoryEntry>
  edit(input: MemoryEditInput): Promise<MemoryEntry | null>
  forget(uri: string): Promise<boolean>
  list(input?: MemoryListInput): Promise<MemoryEntry[]>
  captureThread(input: MemoryThreadCaptureInput): Promise<void>
  getWorkingMemory(input: WorkingMemoryInput): Promise<WorkingMemory | null>
  setWorkingMemory(input: WorkingMemoryUpdateInput): Promise<WorkingMemory>
  /** 必选：Manager 不再保留「provider 没有 patch 就本地拼接」的兜底实现，避免两份 patch 行为不一致 */
  patchWorkingMemory(input: WorkingMemoryPatchInput): Promise<WorkingMemory>
  searchThreads?(input: MemoryThreadSearchInput): Promise<MemoryThreadSearchResult[]>
  fetchThread?(input: MemoryThreadFetchInput): Promise<MemoryThreadFetchResult | null>
  deleteThread?(threadId: string, options?: { cascadeDeleteMemories?: boolean }): Promise<boolean>
  listTimelineEvents?(input: MemoryTimelineInput): Promise<MemoryTimelineEvent[]>
  getConnections?(input: MemoryConnectionsInput): Promise<MemoryConnectionsResult | null>
}
