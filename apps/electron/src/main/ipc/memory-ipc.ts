import { shell } from 'electron'
import { handle } from './shared'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  getMemoryRuntimeConfig,
  isLocalNowledgeBaseUrl,
  NOWLEDGE_DEFAULT_BASE_URL,
} from '../lib/memory/config'
import { memoryProviderManager } from '../lib/memory/provider-manager'
import { memorySnapshotManager } from '../lib/memory/snapshot'
import { memoryStateStore } from '../lib/memory/state-store'
import { getMemoryDir } from '../lib/config-paths'

function serializeMemoryEntry(entry: {
  uri: string
  title?: string
  content: string
  category: string
  tags: string[]
  projectPath?: string
  updatedAt: number
}) {
  return {
    uri: entry.uri,
    title: entry.title,
    content: entry.content,
    category: entry.category,
    tags: entry.tags,
    projectPath: entry.projectPath,
    updatedAt: entry.updatedAt,
  }
}

interface NowledgeConfigProbe {
  baseUrl?: string
  apiKey?: string
}

interface DetectCandidate {
  source: 'config' | 'probe'
  baseUrl: string
  apiKey?: string
}

async function probeNowledge(baseUrl: string, apiKey?: string): Promise<{
  healthy: boolean
  version?: string
  detail: string
}> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3_000)
  try {
    const headers: Record<string, string> = {}
    if (apiKey?.trim()) {
      headers.authorization = `Bearer ${apiKey}`
      headers['x-nmem-api-key'] = apiKey
    }

    const response = await fetch(new URL('/health', baseUrl).toString(), {
      method: 'GET',
      headers,
      signal: controller.signal,
    })
    if (!response.ok) {
      return {
        healthy: false,
        detail: `Nowledge health check failed: ${response.status}`,
      }
    }
    const payload = await response.json().catch(() => ({}))
    const version = typeof payload?.version === 'string'
      ? payload.version
      : typeof payload?.server_version === 'string'
        ? payload.server_version
        : undefined
    return {
      healthy: true,
      version,
      detail: 'Detected local Nowledge successfully',
    }
  } catch (error) {
    return {
      healthy: false,
      detail: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timeout)
  }
}

function readLocalNowledgeConfig(): NowledgeConfigProbe {
  const configPath = join(homedir(), '.nowledge-mem', 'config.json')
  if (!existsSync(configPath)) return {}

  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>
    const baseUrl = typeof raw.apiUrl === 'string'
      ? raw.apiUrl.trim() || undefined
      : typeof raw.baseUrl === 'string'
        ? raw.baseUrl.trim() || undefined
        : undefined
    const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() || undefined : undefined
    return { baseUrl, apiKey }
  } catch {
    return {}
  }
}

export function registerMemoryHandlers(): void {
  handle(
    'memory:get-status',
    async () => {
      return memoryProviderManager.getStatus()
    },
  )

  handle(
    'memory:list',
    async (_, input?: { limit?: number; offset?: number; projectPath?: string }) => {
      const entries = await memoryProviderManager.list({
        limit: typeof input?.limit === 'number' ? input.limit : 50,
        offset: typeof input?.offset === 'number' ? input.offset : 0,
        projectPath: input?.projectPath?.trim() || undefined,
      })

      return entries.map(serializeMemoryEntry)
    },
  )

  handle(
    'memory:open-directory',
    async (): Promise<void> => {
      // 记忆目录不属于 Agent 工作区，不能复用 showInFolder 的工作区路径校验。
      // 这里不接收渲染进程传入的任意路径，只打开 Kila 自己管理的目录。
      await memoryProviderManager.initialize()
      const error = await shell.openPath(getMemoryDir())
      if (error) throw new Error(error)
    },
  )

  handle(
    'memory:list-duplicates',
    async (_, input?: { limit?: number }) => {
      const groups = await memoryProviderManager.listDuplicateGroups({
        limit: typeof input?.limit === 'number' ? input.limit : 500,
      })
      return groups.map((group) => ({
        signature: group.signature,
        reason: group.reason,
        items: group.items.map(serializeMemoryEntry),
      }))
    },
  )

  handle(
    'memory:merge-duplicates',
    async (_, input: { primaryUri: string; duplicateUris: string[] }) => {
      const primaryUri = typeof input?.primaryUri === 'string' ? input.primaryUri.trim() : ''
      const duplicateUris = Array.isArray(input?.duplicateUris)
        ? input.duplicateUris.map((uri) => String(uri ?? '').trim()).filter(Boolean)
        : []
      if (!primaryUri) throw new Error('primaryUri is required')
      const merged = await memoryProviderManager.mergeDuplicateMemories({ primaryUri, duplicateUris })
      return merged ? serializeMemoryEntry(merged) : null
    },
  )

  handle(
    'memory:forget',
    async (_, uri: string) => {
      const targetUri = typeof uri === 'string' ? uri.trim() : ''
      if (!targetUri) throw new Error('memory uri is required')
      return memoryProviderManager.forget(targetUri)
    },
  )

  handle(
    'memory:list-pending-writes',
    async (_, input?: { sessionId?: string }) => {
      const sessionId = typeof input?.sessionId === 'string' ? input.sessionId.trim() || undefined : undefined
      return memoryProviderManager.listPendingWrites(sessionId)
    },
  )

  handle(
    'memory:clear-pending-writes',
    async (_, input?: { sessionId?: string }) => {
      const sessionId = typeof input?.sessionId === 'string' ? input.sessionId.trim() || undefined : undefined
      return { cleared: memoryProviderManager.clearPendingWrites(sessionId) }
    },
  )

  handle(
    'memory:get-debug',
    async (_, input?: { sessionId?: string; projectPath?: string }) => {
      const sessionId = input?.sessionId?.trim() || undefined
      const projectPath = input?.projectPath?.trim() || undefined
      return {
        sessionId,
        projectPath,
        threadState: sessionId ? memoryStateStore.getThreadState(sessionId) : null,
        snapshot: memorySnapshotManager.getCachedSnapshotEntry({ sessionId, projectPath }),
        runtimeEvents: memoryStateStore.listRuntimeEvents({ limit: 20, sessionId }),
        lastWorkingMemoryFetchAt: memoryStateStore.getLastWorkingMemoryFetchAt(),
        config: {
          nowledgeEnabled: getMemoryRuntimeConfig().nowledgeEnabled,
          sessionContextEnabled: getMemoryRuntimeConfig().sessionContextEnabled,
        },
      }
    },
  )

  handle(
    'memory:list-notebook',
    async (_, input?: { limit?: number; offset?: number; projectPath?: string }) => {
      const entries = await memoryProviderManager.listNotebookEntries({
        limit: typeof input?.limit === 'number' ? input.limit : 20,
        offset: typeof input?.offset === 'number' ? input.offset : 0,
        projectPath: input?.projectPath?.trim() || undefined,
      })

      return entries.map((entry) => ({
        uri: entry.uri,
        key: entry.key,
        title: entry.title,
        content: entry.content,
        tags: entry.tags,
        sourceSessionId: entry.sourceSessionId,
        projectPath: entry.projectPath,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      }))
    },
  )

  handle(
    'memory:write-notebook',
    async (_, input) => {
      const entry = await memoryProviderManager.writeNotebookEntry({
        key: input.key,
        title: input.title,
        content: input.content,
        tags: input.tags,
        sourceSessionId: input.sourceSessionId,
        projectPath: input.projectPath,
      })
      return {
        uri: entry.uri,
        key: entry.key,
        title: entry.title,
        content: entry.content,
        tags: entry.tags,
        sourceSessionId: entry.sourceSessionId,
        projectPath: entry.projectPath,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      }
    },
  )

  handle(
    'memory:edit-notebook',
    async (_, input) => {
      const entry = await memoryProviderManager.editNotebookEntry({
        uri: input.uri,
        key: input.key,
        title: input.title,
        content: input.content,
        tags: input.tags,
        projectPath: input.projectPath,
      })
      if (!entry) return null
      return {
        uri: entry.uri,
        key: entry.key,
        title: entry.title,
        content: entry.content,
        tags: entry.tags,
        sourceSessionId: entry.sourceSessionId,
        projectPath: entry.projectPath,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      }
    },
  )

  handle(
    'memory:forget-notebook',
    async (_, uri: string) => {
      return memoryProviderManager.forgetNotebookEntry(uri)
    },
  )

  handle(
    'memory:detect-nowledge',
    async () => {
      const fromConfig = readLocalNowledgeConfig()
      const current = getMemoryRuntimeConfig()
      const candidateMap = new Map<string, DetectCandidate>()
      const addCandidate = (candidate: DetectCandidate | null): void => {
        if (!candidate) return
        if (candidateMap.has(candidate.baseUrl)) return
        candidateMap.set(candidate.baseUrl, candidate)
      }

      addCandidate(fromConfig.baseUrl && isLocalNowledgeBaseUrl(fromConfig.baseUrl)
        ? { source: 'config', baseUrl: fromConfig.baseUrl, apiKey: fromConfig.apiKey }
        : null)
      addCandidate(current.nowledgeBaseUrl && isLocalNowledgeBaseUrl(current.nowledgeBaseUrl)
        ? { source: 'config', baseUrl: current.nowledgeBaseUrl, apiKey: current.nowledgeApiKey }
        : null)
      addCandidate({ source: 'probe', baseUrl: NOWLEDGE_DEFAULT_BASE_URL, apiKey: fromConfig.apiKey })
      addCandidate({ source: 'probe', baseUrl: 'http://localhost:14242', apiKey: fromConfig.apiKey })

      const candidates = Array.from(candidateMap.values())

      for (const candidate of candidates) {
        const result = await probeNowledge(candidate.baseUrl, candidate.apiKey)
        if (result.healthy) {
          return {
            found: true,
            source: candidate.source,
            baseUrl: candidate.baseUrl,
            apiKey: candidate.apiKey,
            apiKeyFound: Boolean(candidate.apiKey?.trim()),
            nowledgeBackendVersion: result.version,
            detail: result.detail,
          }
        }
      }

      return {
        found: false,
        source: 'none' as const,
        apiKeyFound: false,
        detail: 'No local Nowledge service detected on the default desktop endpoint',
      }
    },
  )

  handle(
    'memory:get-impression',
    async () => {
      const impression = await memoryProviderManager.getWorkingMemory({ scope: 'global' })
      return {
        content: impression?.content?.trim() || undefined,
        updatedAt: impression?.updatedAt,
      }
    },
  )
}
