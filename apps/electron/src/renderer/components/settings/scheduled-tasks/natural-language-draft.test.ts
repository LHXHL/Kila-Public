import { describe, expect, test } from 'bun:test'
import { parseScheduledTaskNaturalLanguage } from './natural-language-draft'

describe('scheduled task natural language draft', () => {
  test('Given 每 30 分钟任务，When 解析，Then 生成 interval 草稿但不直接创建', () => {
    const result = parseScheduledTaskNaturalLanguage('每 30 分钟检查构建状态')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.schedule).toEqual({ kind: 'every', minutes: 30 })
    expect(result.draft.prompt).toBe('检查构建状态')
  })

  test('Given 每天上午 9 点任务，When 解析，Then 生成本地 wall-clock cron', () => {
    const result = parseScheduledTaskNaturalLanguage('每天上午 9 点总结当前项目进度')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.schedule).toEqual({ kind: 'cron', expr: '0 9 * * *' })
    expect(result.draft.prompt).toBe('总结当前项目进度')
  })

  test('Given 明天下午 3 点任务，When 解析，Then 生成一次性绝对时间', () => {
    const now = new Date('2026-07-11T02:00:00.000Z')
    const result = parseScheduledTaskNaturalLanguage('明天下午 3 点提醒我发布', now)
    expect(result.ok).toBe(true)
    if (!result.ok || result.draft.schedule.kind !== 'at') return
    const target = new Date(result.draft.schedule.at)
    expect(target.getDate()).toBe(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getDate())
    expect(target.getHours()).toBe(15)
    expect(result.draft.prompt).toBe('提醒我发布')
  })

  test('Given 模糊描述，When 解析，Then 返回可操作提示', () => {
    const result = parseScheduledTaskNaturalLanguage('有空时帮我检查项目')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('暂支持')
  })
})
