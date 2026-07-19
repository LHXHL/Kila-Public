import { describe, expect, test } from 'bun:test'
import { getWidgetCacheKey } from './widget-height-cache'

describe('Widget 高度缓存键', () => {
  test('Given 前 200 字符相同但尾部不同的 Widget When 计算缓存键 Then 不发生碰撞', () => {
    const prefix = 'x'.repeat(200)
    expect(getWidgetCacheKey(`${prefix}:a`)).not.toBe(getWidgetCacheKey(`${prefix}:b`))
  })

  test('Given 相同 Widget 内容 When 重复计算 Then 缓存键稳定', () => {
    const code = '<div>稳定内容</div>'
    expect(getWidgetCacheKey(code)).toBe(getWidgetCacheKey(code))
  })
})
