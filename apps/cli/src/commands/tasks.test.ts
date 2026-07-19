import { describe, expect, test } from 'bun:test'
import { parseHistoryTurns, parseThinkingLevel } from './tasks'

describe('task command parsers', () => {
  test('accepts kila thinking levels', () => {
    expect(parseThinkingLevel(undefined)).toBeUndefined()
    expect(parseThinkingLevel('none')).toBe('none')
    expect(parseThinkingLevel('low')).toBe('low')
    expect(parseThinkingLevel('medium')).toBe('medium')
    expect(parseThinkingLevel('high')).toBe('high')
    expect(parseThinkingLevel('xhigh')).toBe('xhigh')
  })

  test('rejects unsupported thinking levels', () => {
    expect(() => parseThinkingLevel('minimal')).toThrow('无效的 thinking level')
  })

  test('parses finite and infinite history turns', () => {
    expect(parseHistoryTurns(undefined)).toBeUndefined()
    expect(parseHistoryTurns('infinite')).toBe('infinite')
    expect(parseHistoryTurns('12')).toBe(12)
  })

  test('rejects invalid history turns', () => {
    expect(() => parseHistoryTurns('-1')).toThrow('无效的 history turns')
    expect(() => parseHistoryTurns('abc')).toThrow('无效的 history turns')
  })
})
