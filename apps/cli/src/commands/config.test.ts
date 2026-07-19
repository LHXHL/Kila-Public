import { describe, expect, test } from 'bun:test'
import { parseConfigValue } from './config'

describe('parseConfigValue', () => {
  test('parses primitive values in non-json mode', () => {
    expect(parseConfigValue('true', false)).toBe(true)
    expect(parseConfigValue('false', false)).toBe(false)
    expect(parseConfigValue('null', false)).toBeNull()
    expect(parseConfigValue('42', false)).toBe(42)
    expect(parseConfigValue('plain-text', false)).toBe('plain-text')
  })

  test('parses object-like strings opportunistically in non-json mode', () => {
    expect(parseConfigValue('{"a":1}', false)).toEqual({ a: 1 })
    expect(parseConfigValue('[1,2,3]', false)).toEqual([1, 2, 3])
  })

  test('uses strict JSON parsing in json mode', () => {
    expect(parseConfigValue('"hello"', true)).toBe('hello')
    expect(() => parseConfigValue('hello', true)).toThrow()
  })
})
