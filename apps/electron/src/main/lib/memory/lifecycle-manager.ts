import type { MemoryRunTrace } from '@kila/shared'
import { getMemoryRuntimeConfig } from './config'
import { createLogger } from '../logger'
import { memoryProviderManager } from './provider-manager'
import { memoryStateStore } from './state-store'
import { markSessionMemoryDeleting, triggerPostRunMemoryFlush, waitForSessionPostRunMemoryFlush, type MemoryFlushResult } from './post-run'
import { memorySnapshotManager } from './snapshot'
import { syncSessionThreadTail } from './thread-sync'

const log = createLogger('Memory Lifecycle')

export function shouldPersistRunMemory(incognito?: boolean): boolean {
  return incognito !== true
}

interface MemorySourceMessage {
  role: string
  content: string
}

export class MemoryLifecycleManager {
  async getPromptContext(input: {
    sessionId: string
    projectPath?: string
    userMessage: string
    messages: MemorySourceMessage[]
    incognito?: boolean
  }): Promise<{ text: string; trace: MemoryRunTrace }> {
    const config = getMemoryRuntimeConfig()
    if (!config.sessionContextEnabled) {
      return {
        text: '',
        trace: {
          enabled: false,
          recalledMemoryCount: 0,
          relatedThreadCount: 0,
          notebookCount: 0,
          usedGlobalWorkingMemory: false,
          usedProjectWorkingMemory: false,
          incognito: input.incognito === true,
          recallStatus: 'disabled',
        },
      }
    }
    try {
      return await memorySnapshotManager.buildPromptContext(input)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      memoryStateStore.appendRuntimeEvent({
        sessionId: input.sessionId,
        threadId: input.sessionId,
        eventType: 'recall_failed',
        status: 'error',
        detail,
      })
      log.warn('[Memory Lifecycle] 记忆召回失败，降级为无记忆上下文:', error)
      return {
        text: '',
        trace: {
          enabled: true,
          recalledMemoryCount: 0,
          relatedThreadCount: 0,
          notebookCount: 0,
          usedGlobalWorkingMemory: false,
          usedProjectWorkingMemory: false,
          incognito: input.incognito === true,
          recallStatus: 'error',
        },
      }
    }
  }

  async onAfterCompaction(input: {
    sessionId: string
    projectPath?: string
    messages: MemorySourceMessage[]
  }): Promise<void> {
    await syncSessionThreadTail(input)
  }

  async onBeforeReset(input: {
    sessionId: string
    projectPath?: string
    messages: MemorySourceMessage[]
  }): Promise<void> {
    await syncSessionThreadTail(input)
  }

  async onBeforeDeleteSession(sessionId: string): Promise<void> {
    markSessionMemoryDeleting(sessionId)
    await waitForSessionPostRunMemoryFlush(sessionId)
    await memoryProviderManager.cleanupSession(sessionId)
  }

  onAgentEnd(input: {
    sessionId: string
    projectPath?: string
    messages: MemorySourceMessage[]
  }): Promise<MemoryFlushResult> {
    return triggerPostRunMemoryFlush(input)
  }
}

export const memoryLifecycleManager = new MemoryLifecycleManager()
