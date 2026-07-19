import { describe, expect, test } from 'bun:test'
import {
  analyzeBashCommand,
  hasDangerousStructure,
  isDangerousCommand,
  isSafeBashCommand,
} from './permission-rules'

describe('bash permission rules', () => {
  test('allows read-only commands without shell structure', () => {
    const analysis = analyzeBashCommand('git status --short')

    expect(analysis.isSafe).toBe(true)
    expect(analysis.dangerLevel).toBe('safe')
    expect(analysis.riskScore).toBe(0)
    expect(isSafeBashCommand('git status --short')).toBe(true)
  })

  test('detects shell operators outside quotes', () => {
    expect(hasDangerousStructure('printf "a|b"')).toBe(false)
    expect(hasDangerousStructure('git status | cat')).toBe(true)
    expect(hasDangerousStructure('echo hi > out.txt')).toBe(true)
  })

  test('marks destructive commands as dangerous with reasons', () => {
    const analysis = analyzeBashCommand('rm -rf dist')

    expect(analysis.isDangerous).toBe(true)
    expect(analysis.dangerLevel).toBe('dangerous')
    expect(analysis.riskScore).toBeGreaterThanOrEqual(70)
    expect(analysis.reasons.join('\n')).toContain('dangerous command: rm')
    expect(isDangerousCommand('rm -rf dist')).toBe(true)
  })

  test('raises command substitution above normal risk', () => {
    const analysis = analyzeBashCommand('echo $(cat ~/.ssh/id_rsa)')

    expect(analysis.hasStructure).toBe(true)
    expect(analysis.isDangerous).toBe(true)
    expect(analysis.reasons).toContain('command substitution')
  })
})
