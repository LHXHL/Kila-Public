import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
// 断言的是 zh-CN 译文，需要先初始化共享 i18n 实例
import i18n from '@/lib/i18n'
import { getMemoryWriteLabel, MemoryRecallDetails } from './MemoryTraceBadge'
import type { MemoryRunTrace } from '@kila/shared'

const t = i18n.t.bind(i18n)

function trace(overrides: Partial<MemoryRunTrace> = {}): MemoryRunTrace {
  return {
    enabled: true,
    provider: 'local',
    recalledMemoryCount: 1,
    relatedThreadCount: 1,
    notebookCount: 0,
    usedGlobalWorkingMemory: true,
    usedProjectWorkingMemory: false,
    incognito: false,
    recallStatus: 'success',
    recallItems: [
      {
        kind: 'memory',
        id: 'memory://global/1',
        title: '代码风格偏好',
        content: '优先使用中文注释。',
        provider: 'local',
        category: 'preference',
      },
      {
        kind: 'thread',
        id: 'thread-1',
        title: 'Shiki 排查记录',
        content: 'CSP 阻止了 WASM 初始化。',
        provider: 'nowledge',
      },
    ],
    ...overrides,
  }
}

describe('MemoryRecallDetails', () => {
  test('以紧凑状态展示本轮召回分类、具体条目与工作记忆', () => {
    const html = renderToStaticMarkup(<MemoryRecallDetails trace={trace()} />)

    expect(html).toContain('本轮记忆召回')
    expect(html).toContain('长期记忆 1')
    expect(html).toContain('相关会话 1')
    expect(html).toContain('代码风格偏好')
    expect(html).toContain('Shiki 排查记录')
    expect(html).toContain('工作记忆')
    expect(html).toContain('全局')
    expect(html).not.toContain('不计入上方召回数量')
    expect(html).not.toContain('不会重新查询或改写当前记忆')
  })

  test('兼容只保存数量的旧历史消息', () => {
    const html = renderToStaticMarkup(<MemoryRecallDetails trace={trace({ recallItems: undefined })} />)

    expect(html).toContain('旧记录未保存召回详情')
  })
})


describe('getMemoryWriteLabel', () => {
  test('后台任务不展示容易误解为卡住的中间写入状态', () => {
    expect(getMemoryWriteLabel(trace({ writeStatus: 'queued' }), t)).toBeNull()
  })

  test('仅展示有意义的最终结果或异常状态', () => {
    expect(getMemoryWriteLabel(trace(), t)).toBeNull()
    expect(getMemoryWriteLabel(trace({ writeStatus: 'written', writtenMemoryCount: 0 }), t)).toBeNull()
    expect(getMemoryWriteLabel(trace({ writeStatus: 'written', writtenMemoryCount: 2 }), t)).toBe('新增 2 条')
    expect(getMemoryWriteLabel(trace({ writeStatus: 'failed' }), t)).toBe('整理失败')
    expect(getMemoryWriteLabel(trace({ incognito: true }), t)).toBe('只读')
  })
})
