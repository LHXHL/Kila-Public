import { createLogger } from '../logger'
import { getPersonalityState } from '../personality-manager'
import { getUserProfileAutomationState, rewriteUserProfileAutomationSections } from '../personality-user-profile-manager'
import { memoryProviderManager } from './provider-manager'
import { memoryStateStore } from './state-store'
import type { MemoryEntry, WorkingMemory } from './types'

const log = createLogger('User Profile Distill')

interface DistillInput {
  sessionId?: string
}

function toBulletList(lines: string[], emptyFallback: string): string {
  const normalized = Array.from(new Set(lines.map((line) => line.trim()).filter(Boolean))).slice(0, 6)
  return normalized.length > 0
    ? normalized.map((line) => line.startsWith('- ') ? line : `- ${line}`).join('\n')
    : `- ${emptyFallback}`
}

function summarizeWorkingMemory(workingMemory: WorkingMemory | null): string[] {
  if (!workingMemory?.content?.trim()) return []

  return workingMemory.content
    .split('\n')
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 3)
}

function buildProfileSections(memories: MemoryEntry[], globalWorkingMemory: WorkingMemory | null): {
  inferredProfile: string
  openQuestions: string
} {
  const preferenceSignals = memories
    .filter((entry) => entry.category === 'preference' || entry.category === 'decision')
    .map((entry) => entry.title?.trim() || entry.content.trim())

  const generalSignals = memories
    .filter((entry) => entry.category !== 'preference' && entry.category !== 'decision')
    .map((entry) => entry.title?.trim() || entry.content.trim())

  const workingMemorySignals = summarizeWorkingMemory(globalWorkingMemory)

  return {
    inferredProfile: toBulletList(
      [...preferenceSignals, ...workingMemorySignals, ...generalSignals].slice(0, 8),
      '记忆系统尚未沉淀出稳定的长期用户画像。',
    ),
    openQuestions: toBulletList(
      workingMemorySignals.length > 0
        ? ['以下画像包含近期工作记忆信号，仍需继续观察是否稳定。']
        : ['当前缺少足够稳定的长期信号，后续继续观察。'],
      '当前没有待确认问题。',
    ),
  }
}

export async function rebuildUserProfileFromMemory(input: DistillInput = {}): Promise<void> {
  const sessionId = input.sessionId
  try {
    const personality = getPersonalityState()
    const automationState = getUserProfileAutomationState(personality.user)

    if (automationState.locked) {
      memoryStateStore.appendRuntimeEvent({
        sessionId,
        threadId: sessionId,
        eventType: 'user_profile_distill_skipped',
        status: 'info',
        detail: 'user profile automation is locked',
      })
      return
    }

    const [memories, globalWorkingMemory] = await Promise.all([
      memoryProviderManager.list({ limit: 24 }),
      memoryProviderManager.getWorkingMemory({ scope: 'global' }),
    ])

    const sections = buildProfileSections(memories, globalWorkingMemory)
    rewriteUserProfileAutomationSections(personality.user, {
      inferredProfile: sections.inferredProfile,
      openQuestions: sections.openQuestions,
      updatedAt: Date.now(),
      source: 'memory',
    })

    memoryStateStore.appendRuntimeEvent({
      sessionId,
      threadId: sessionId,
      eventType: 'user_profile_distilled',
      status: 'success',
      detail: 'USER.md auto-generated sections rebuilt from memory',
    })
  } catch (error) {
    memoryStateStore.appendRuntimeEvent({
      sessionId,
      threadId: sessionId,
      eventType: 'user_profile_distill_failed',
      status: 'error',
      detail: error instanceof Error ? error.message : String(error),
    })
    log.warn('[User Profile Distill] rebuild failed:', error)
  }
}
