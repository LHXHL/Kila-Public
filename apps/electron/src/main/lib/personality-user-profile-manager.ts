import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  PersonalityDocument,
  UserProfileAutomationSection,
  UserProfileAutomationState,
} from '@kila/shared'
import { getPersonalityUserPath, getUserProfileAutomationStatePath } from './config-paths'

const AUTO_BLOCK_START = '<!-- AUTO-GENERATED: START -->'
const AUTO_BLOCK_END = '<!-- AUTO-GENERATED: END -->'
const INFERRED_HEADING = '## Inferred Profile'
const OPEN_QUESTIONS_HEADING = '## Open Questions'

interface UserProfileAutomationPersistedState {
  locked?: boolean
  sections?: Partial<Record<UserProfileAutomationSection, { locked?: boolean }>>
  updatedAt?: number
  lastAppliedAt?: number
  lastSource?: 'memory'
}

export interface UserProfileAutomationRewriteInput {
  inferredProfile: string
  openQuestions: string
  updatedAt?: number
  source?: 'memory'
}

function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function normalizeMarkdownContent(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`
}

function buildAutoBlock(content: string): string {
  const trimmed = content.trim()
  return `${AUTO_BLOCK_START}\n${trimmed || '- 暂无稳定信号。'}\n${AUTO_BLOCK_END}`
}

function escapeHeadingForRegex(heading: string): string {
  return heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceOrAppendAutoSection(document: string, heading: string, body: string): string {
  const normalized = normalizeMarkdownContent(document)
  const sectionPattern = new RegExp(
    `${escapeHeadingForRegex(heading)}\\n(?:${escapeHeadingForRegex(AUTO_BLOCK_START)}[\\s\\S]*?${escapeHeadingForRegex(AUTO_BLOCK_END)}|[\\s\\S]*?)(?=\\n## |\\n# |$)`,
    'm',
  )
  const nextSection = `${heading}\n${buildAutoBlock(body)}\n`

  if (sectionPattern.test(normalized)) {
    return normalized.replace(sectionPattern, nextSection).replace(/\n+$/, '\n')
  }

  return `${normalized.trimEnd()}\n\n${nextSection}`.replace(/\n+$/, '\n')
}

function extractAutoSection(document: string, heading: string): string {
  const sectionPattern = new RegExp(
    `${escapeHeadingForRegex(heading)}\\n${escapeHeadingForRegex(AUTO_BLOCK_START)}\\n([\\s\\S]*?)\\n${escapeHeadingForRegex(AUTO_BLOCK_END)}`,
    'm',
  )
  const match = document.match(sectionPattern)
  return match?.[1]?.trim() ?? ''
}

function ensureUserProfileTemplate(document: PersonalityDocument): PersonalityDocument {
  const content = normalizeMarkdownContent(document.content)
  const hasExplicit = content.includes('## Explicit Profile')
  const hasInferred = content.includes(INFERRED_HEADING)
  const hasOpenQuestions = content.includes(OPEN_QUESTIONS_HEADING)

  if (hasExplicit && hasInferred && hasOpenQuestions) {
    return {
      ...document,
      content,
    }
  }

  const upgraded = `${content.trimEnd()}\n\n## Explicit Profile\n- 用户明确声明的长期身份、偏好与边界。\n\n${INFERRED_HEADING}\n${buildAutoBlock('- 暂无稳定信号。')}\n\n${OPEN_QUESTIONS_HEADING}\n${buildAutoBlock('- 暂无待确认问题。')}\n`

  writeFileSync(document.path, upgraded, 'utf-8')

  return {
    ...document,
    content: upgraded,
  }
}

function readPersistedState(): UserProfileAutomationPersistedState {
  const filePath = getUserProfileAutomationStatePath()
  if (!existsSync(filePath)) return {}

  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as UserProfileAutomationPersistedState
    return {
      locked: Boolean(raw.locked),
      sections: {
        inferredProfile: {
          locked: Boolean(raw.sections?.inferredProfile?.locked),
        },
        openQuestions: {
          locked: Boolean(raw.sections?.openQuestions?.locked),
        },
      },
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : undefined,
      lastAppliedAt: typeof raw.lastAppliedAt === 'number' ? raw.lastAppliedAt : undefined,
      lastSource: raw.lastSource === 'memory' ? 'memory' : undefined,
    }
  } catch {
    return {}
  }
}

function writePersistedState(next: UserProfileAutomationPersistedState): void {
  const filePath = getUserProfileAutomationStatePath()
  ensureParentDir(filePath)
  writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8')
}

export function ensureUserProfileAutomationDocument(document: PersonalityDocument): PersonalityDocument {
  return ensureUserProfileTemplate(document)
}

export function getUserProfileAutomationState(document: PersonalityDocument): UserProfileAutomationState {
  const normalizedDocument = ensureUserProfileAutomationDocument(document)
  const persisted = readPersistedState()

  return {
    path: normalizedDocument.path,
    locked: Boolean(persisted.locked),
    sections: {
      inferredProfile: {
        locked: Boolean(persisted.sections?.inferredProfile?.locked),
      },
      openQuestions: {
        locked: Boolean(persisted.sections?.openQuestions?.locked),
      },
    },
    updatedAt: persisted.updatedAt,
    lastAppliedAt: persisted.lastAppliedAt,
    lastSource: persisted.lastSource,
    inferredProfile: extractAutoSection(normalizedDocument.content, INFERRED_HEADING),
    openQuestions: extractAutoSection(normalizedDocument.content, OPEN_QUESTIONS_HEADING),
  }
}

export function setUserProfileAutomationLock(
  document: PersonalityDocument,
  locked: boolean,
  section?: UserProfileAutomationSection,
): UserProfileAutomationState {
  ensureUserProfileAutomationDocument(document)
  const current = readPersistedState()
  writePersistedState({
    ...current,
    locked: section ? current.locked : locked,
    sections: section
      ? {
          inferredProfile: {
            locked: section === 'inferredProfile'
              ? locked
              : Boolean(current.sections?.inferredProfile?.locked),
          },
          openQuestions: {
            locked: section === 'openQuestions'
              ? locked
              : Boolean(current.sections?.openQuestions?.locked),
          },
        }
      : current.sections,
  })
  return getUserProfileAutomationState(document)
}

export function rewriteUserProfileAutomationSections(
  document: PersonalityDocument,
  input: UserProfileAutomationRewriteInput,
): PersonalityDocument {
  const upgraded = ensureUserProfileAutomationDocument(document)
  const current = readPersistedState()
  const automationState = getUserProfileAutomationState(upgraded)
  let nextContent = upgraded.content

  if (!current.locked && !automationState.sections.inferredProfile.locked) {
    nextContent = replaceOrAppendAutoSection(nextContent, INFERRED_HEADING, input.inferredProfile)
  }
  if (!current.locked && !automationState.sections.openQuestions.locked) {
    nextContent = replaceOrAppendAutoSection(nextContent, OPEN_QUESTIONS_HEADING, input.openQuestions)
  }
  nextContent = normalizeMarkdownContent(nextContent)

  writeFileSync(getPersonalityUserPath(), nextContent, 'utf-8')

  const now = input.updatedAt ?? Date.now()
  writePersistedState({
    ...current,
    updatedAt: now,
    lastAppliedAt: now,
    lastSource: input.source ?? 'memory',
  })

  return {
    kind: 'user',
    path: getPersonalityUserPath(),
    content: nextContent,
  }
}
