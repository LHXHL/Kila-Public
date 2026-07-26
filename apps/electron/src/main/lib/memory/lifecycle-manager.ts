import type { MemoryRunTrace } from '@kila/shared'
import { getMemoryRuntimeConfig, isNowledgeConfigured } from './config'
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

/** 记忆是否启用：仅当 Nowledge 已配置。未配置则整个记忆功能（召回/写回/工具）禁用。 */
function isMemoryEnabled(): boolean {
  return isNowledgeConfigured(getMemoryRuntimeConfig())
}

function disabledTrace(incognito?: boolean): MemoryRunTrace {
  return {
    enabled: false,
    recalledMemoryCount: 0,
    relatedThreadCount: 0,
    notebookCount: 0,
    usedGlobalWorkingMemory: false,
    usedProjectWorkingMemory: false,
    incognito: incognito === true,
    recallStatus: 'disabled',
  }
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
    // 未配置 Nowledge → 记忆禁用，不注入任何召回上下文。
    if (!isMemoryEnabled()) {
      return { text: '', trace: disabledTrace(input.incognito) }
    }
    const config = getMemoryRuntimeConfig()
    if (!config.sessionContextEnabled) {
      return { text: '', trace: disabledTrace(input.incognito) }
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
    if (!isMemoryEnabled()) return
    await syncSessionThreadTail(input)
  }

  async onBeforeReset(input: {
    sessionId: string
    projectPath?: string
    messages: MemorySourceMessage[]
  }): Promise<void> {
    if (!isMemoryEnabled()) return
    await syncSessionThreadTail(input)
  }

  async onBeforeDeleteSession(sessionId: string): Promise<void> {
    if (!isMemoryEnabled()) return
    markSessionMemoryDeleting(sessionId)
    await waitForSessionPostRunMemoryFlush(sessionId)
    await memoryProviderManager.cleanupSession(sessionId)
  }

  onAgentEnd(input: {
    sessionId: string
    projectPath?: string
    messages: MemorySourceMessage[]
  }): Promise<MemoryFlushResult> {
    if (!isMemoryEnabled()) return Promise.resolve({ status: 'written', writtenCount: 0 })
    return triggerPostRunMemoryFlush(input)
  }
}

export const memoryLifecycleManager = new MemoryLifecycleManager()
