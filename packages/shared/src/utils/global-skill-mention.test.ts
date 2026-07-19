import { describe, expect, test } from 'bun:test'
import {
  buildGlobalSkillMentionId,
  formatGlobalSkillMentionLabel,
  parseGlobalSkillMentionId,
} from './global-skill-mention'

describe('global skill mention helpers', () => {
  test('keeps Kila skills backward compatible with plain slug mentions', () => {
    expect(buildGlobalSkillMentionId({ source: 'kila', slug: 'local-skill' })).toBe('local-skill')
    expect(parseGlobalSkillMentionId('local-skill')).toEqual({
      source: 'kila',
      slug: 'local-skill',
    })
  })

  test('namespaces external sources with source:slug format', () => {
    expect(buildGlobalSkillMentionId({ source: 'codex', slug: 'cli-scheduler' })).toBe('codex:cli-scheduler')
    expect(parseGlobalSkillMentionId('claude:auth-sec')).toEqual({
      source: 'claude',
      slug: 'auth-sec',
    })
  })

  test('formats external mention labels for transcript display', () => {
    expect(formatGlobalSkillMentionLabel('codex:cli-scheduler')).toBe('Codex / cli-scheduler')
    expect(formatGlobalSkillMentionLabel('local-skill')).toBe('local-skill')
  })
})
