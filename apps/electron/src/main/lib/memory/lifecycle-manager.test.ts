import { describe, expect, test } from 'bun:test'
import { shouldPersistRunMemory } from './lifecycle-manager'

describe('memory incognito policy', () => {
  test('Given 普通运行，When 判断持久化策略，Then 允许写入记忆', () => {
    expect(shouldPersistRunMemory(false)).toBe(true)
    expect(shouldPersistRunMemory(undefined)).toBe(true)
  })

  test('Given 隐身运行，When 判断持久化策略，Then 禁止写入与蒸馏', () => {
    expect(shouldPersistRunMemory(true)).toBe(false)
  })
})
