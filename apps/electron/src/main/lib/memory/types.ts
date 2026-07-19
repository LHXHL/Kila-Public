export type MemoryCategory =
  | 'general'
  | 'decision'
  | 'preference'
  | 'fact'
  | 'task'
  | 'insight'

export type MemoryRecordKind = 'memory' | 'notebook'
export type WorkingMemoryScope = 'global' | 'project'
export type MemoryProviderMode = 'local' | 'nowledge'

export interface MemoryRecordBase {
  id: string
  uri: string
  key?: string
  title?: string
  content: string
  tags: string[]
  sourceSessionId?: string
  projectPath?: string
  createdAt: number
  updatedAt: number
}

export interface MemoryEntry extends MemoryRecordBase {
  kind: 'memory'
  category: MemoryCategory
}

export interface NotebookEntry extends MemoryRecordBase {
  kind: 'notebook'
}

export type MemoryRecord = MemoryEntry | NotebookEntry

export interface MemorySearchResult {
  entry: MemoryEntry
  score: number
  relevanceReason?: string
  labels?: string[]
  sourceThreadId?: string
  matchedSnippet?: string
}

export interface MemoryDuplicateGroup {
  signature: string
  reason: string
  items: MemoryEntry[]
}

export interface MemoryMergeDuplicatesInput {
  primaryUri: string
  duplicateUris: string[]
}

export interface QueuedMemoryWriteView extends MemoryWriteInput {
  sourceSessionId: string
}

export interface WorkingMemory {
  scope: WorkingMemoryScope
  projectPath?: string
  content: string
  updatedAt: number
}

export interface MemoryProviderStatus {
  mode: MemoryProviderMode
  activeProvider: MemoryProviderMode
  localReady: boolean
  memoryDirectory: string
  nowledgeEnabled: boolean
  nowledgeConfigured: boolean
  nowledgeHealthy: boolean
  nowledgeBackendVersion?: string
  checkedAt: number
  detail?: string
}

export interface MemoryListInput {
  limit?: number
  offset?: number
  projectPath?: string
}

export interface MemorySearchInput {
  query: string
  limit?: number
  projectPath?: string
  sessionId?: string
}

export interface MemoryWriteInput {
  content: string
  title?: string
  tags?: string[]
  category?: MemoryCategory
  key?: string
  sourceSessionId?: string
  projectPath?: string
}

export interface MemoryEditInput {
  uri: string
  content?: string
  title?: string
  tags?: string[]
  category?: MemoryCategory
  key?: string
  projectPath?: string
}

export interface NotebookWriteInput {
  content: string
  title?: string
  tags?: string[]
  key?: string
  sourceSessionId?: string
  projectPath?: string
}

export interface NotebookEditInput {
  uri: string
  content?: string
  title?: string
  tags?: string[]
  key?: string
  projectPath?: string
}

export interface WorkingMemoryInput {
  scope: WorkingMemoryScope
  projectPath?: string
}

export interface WorkingMemoryUpdateInput extends WorkingMemoryInput {
  content: string
}

export interface WorkingMemoryPatchInput extends WorkingMemoryInput {
  heading: string
  content?: string
  append?: string
}

export interface MemoryDistillThreadMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface MemoryThreadCaptureInput {
  sessionId: string
  threadId: string
  threadTitle?: string
  projectPath?: string
  messages: MemoryDistillThreadMessage[]
}

export interface MemoryThreadSearchInput {
  query: string
  limit?: number
  source?: string
}

export interface MemoryThreadSearchMessageHit {
  role: string
  snippet: string
}

export interface MemoryThreadSearchResult {
  threadId: string
  title: string
  source?: string
  messageCount: number
  lastActivity?: string
  relevanceScore: number
  matchedMessages: MemoryThreadSearchMessageHit[]
}

export interface MemoryThreadFetchInput {
  threadId: string
  offset?: number
  limit?: number
}

export interface MemoryThreadMessage {
  role: string
  content: string
  timestamp?: string | number | null
}

export interface MemoryThreadFetchResult {
  threadId: string
  title: string
  source?: string
  messageCount: number
  messages: MemoryThreadMessage[]
}

export interface MemoryTimelineInput {
  lastNDays?: number
  dateFrom?: string
  dateTo?: string
  eventType?: string
  tier1Only?: boolean
  limit?: number
}

export interface MemoryTimelineEvent {
  id?: string
  eventType: string
  createdAt: string
  title?: string
  description?: string
  memoryId?: string
  relatedMemoryIds: string[]
}

export interface MemoryConnectionsInput {
  memoryId?: string
  query?: string
}

export interface MemoryConnectionItem {
  nodeId: string
  nodeType: string
  title: string
  snippet?: string
  edgeType: string
  relation?: string
  weight?: number
}

export interface MemoryConnectionsResult {
  targetMemoryId: string
  items: MemoryConnectionItem[]
}

export interface MemorySnapshotCacheEntry {
  scopeType: 'global' | 'project' | 'session'
  scopeKey: string
  snapshotText: string
  snapshotSourceJson?: string
  updatedAt: number
}

export interface MemoryRuntimeEvent {
  id: string
  sessionId?: string
  threadId?: string
  eventType: string
  status: 'info' | 'success' | 'warn' | 'error'
  detail: string
  createdAt: number
}

export interface NowledgeThreadState {
  sessionId: string
  threadId: string
  threadTitle?: string
  projectPath?: string
  lastAppendedMessageSeq: number
  lastDistilledMessageSeq: number
  lastDistilledAt?: number
  lastTriageAt?: number
  lastTriageResultJson?: string
  lastError?: string
  updatedAt: number
}
