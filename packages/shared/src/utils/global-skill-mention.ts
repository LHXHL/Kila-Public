import type { GlobalSkillEntrySource } from '../types/agent'

export interface ParsedGlobalSkillMention {
  source: GlobalSkillEntrySource
  slug: string
}

const GLOBAL_SKILL_SOURCE_LABELS: Record<GlobalSkillEntrySource, string> = {
  kila: 'Kila',
  codex: 'Codex',
  claude: 'Claude',
}

export function buildGlobalSkillMentionId(input: Pick<ParsedGlobalSkillMention, 'source' | 'slug'>): string {
  const slug = input.slug.trim()
  if (!slug) return ''
  if (input.source === 'kila') {
    return slug
  }
  return `${input.source}:${slug}`
}

export function parseGlobalSkillMentionId(rawValue: string): ParsedGlobalSkillMention {
  const value = rawValue.trim()
  if (!value) {
    return { source: 'kila', slug: '' }
  }

  const colonIndex = value.indexOf(':')
  if (colonIndex <= 0) {
    return { source: 'kila', slug: value }
  }

  const sourceCandidate = value.slice(0, colonIndex)
  const slug = value.slice(colonIndex + 1).trim()

  if (
    (sourceCandidate === 'kila' || sourceCandidate === 'codex' || sourceCandidate === 'claude')
    && slug
  ) {
    return {
      source: sourceCandidate,
      slug,
    }
  }

  return { source: 'kila', slug: value }
}

export function formatGlobalSkillMentionLabel(rawValue: string): string {
  const parsed = parseGlobalSkillMentionId(rawValue)
  if (!parsed.slug) return rawValue
  if (parsed.source === 'kila') {
    return parsed.slug
  }
  return `${GLOBAL_SKILL_SOURCE_LABELS[parsed.source]} / ${parsed.slug}`
}
