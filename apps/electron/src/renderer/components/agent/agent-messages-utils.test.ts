import { describe, expect, test } from 'bun:test'
import {
  TOOL_PAYLOAD_EXPANDED_MAX_CHARS,
  TOOL_PAYLOAD_MAX_CHARS,
  getRenderablePayloadText,
} from './agent-messages-utils'

describe('工具过程输出性能边界', () => {
  test('Given 数 MB 级工具输出 When 生成普通与展开预览 Then 两种 DOM 文本均受固定上限保护', () => {
    const content = 'x'.repeat(250_000)

    const preview = getRenderablePayloadText(content)
    const expanded = getRenderablePayloadText(content, TOOL_PAYLOAD_EXPANDED_MAX_CHARS)

    expect(preview.text.length).toBeLessThan(TOOL_PAYLOAD_MAX_CHARS + 100)
    expect(preview.truncatedCharCount).toBe(250_000 - TOOL_PAYLOAD_MAX_CHARS)
    expect(expanded.text.length).toBeLessThan(TOOL_PAYLOAD_EXPANDED_MAX_CHARS + 100)
    expect(expanded.truncatedCharCount).toBe(150_000)
  })
})
