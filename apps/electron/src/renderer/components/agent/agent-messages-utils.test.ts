import { describe, expect, test } from 'bun:test'
import {
  TOOL_PAYLOAD_EXPANDED_MAX_CHARS,
  TOOL_PAYLOAD_MAX_CHARS,
  formatPayloadPreview,
  getMessagePreviewText,
  getRenderablePayloadText,
  isAgentMessageRetryable,
} from './agent-messages-utils'

describe('工具过程输出性能边界', () => {
  test('Given 数 MB 级工具输出 When 生成普通与展开预览 Then 两种 DOM 文本均受固定上限保护', () => {
    const content = 'x'.repeat(250_000)

    const preview = getRenderablePayloadText(content)
    const expanded = getRenderablePayloadText(content, TOOL_PAYLOAD_EXPANDED_MAX_CHARS)

    expect(preview.text.length).toBeLessThan(TOOL_PAYLOAD_MAX_CHARS + 100)
    expect(preview.truncatedCharCount).toBe(250_000 - TOOL_PAYLOAD_MAX_CHARS)
    expect(expanded.text.length).toBeLessThan(TOOL_PAYLOAD_EXPANDED_MAX_CHARS + 100)
    expect(expanded.truncatedCharCount).toBe(250_000 - TOOL_PAYLOAD_EXPANDED_MAX_CHARS)
  })

  test('Given 深层大对象 When 生成结构化预览 Then 限制深度字段和长字符串', () => {
    const content = {
      items: Array.from({ length: 200 }, (_, index) => ({
        index,
        value: 'x'.repeat(5_000),
      })),
    }

    const preview = formatPayloadPreview(content)

    expect(preview.length).toBeLessThan(TOOL_PAYLOAD_MAX_CHARS + 200)
    expect(preview).toContain('字符串已截断')
    expect(preview).toContain('截断')
  })

  test('Given 超长历史消息 When 生成迷你地图摘要 Then 只处理受限源文本', () => {
    const preview = getMessagePreviewText({
      id: 'message-1',
      role: 'assistant',
      content: `开头摘要${'x'.repeat(200_000)}`,
      createdAt: Date.now(),
    })

    expect(preview.startsWith('开头摘要')).toBe(true)
    expect(preview.length).toBeLessThanOrEqual(2_048)
  })
})

describe('Agent 错误恢复入口', () => {
  test('Given Runtime 不可重试错误 When 判断消息 Then 不显示重试入口', () => {
    expect(isAgentMessageRetryable({
      id: 'error-1',
      role: 'status',
      content: 'Runtime 数据超限',
      createdAt: Date.now(),
      errorCanRetry: false,
    })).toBe(false)
  })

  test('Given 旧消息没有 retry 字段 When 判断消息 Then 保持兼容并允许重试', () => {
    expect(isAgentMessageRetryable({
      id: 'error-2',
      role: 'status',
      content: '执行失败',
      createdAt: Date.now(),
    })).toBe(true)
  })
})
