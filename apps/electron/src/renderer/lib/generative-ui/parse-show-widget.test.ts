import { describe, expect, test } from 'bun:test'
import {
  normalizeShowWidgetMarkup,
  parseAssistantRenderableBlocks,
  parseStreamingAssistantBlocks,
  stripWidgetFencesToPlainText,
} from './parse-show-widget'

const payload = JSON.stringify({
  title: '趋势图',
  widget_code: '<div><svg><path d="M0 0" /></svg></div>',
})

const xmlToolCall = `<tool_call>\n<show-widget>\n${payload}\n</show-widget>\n</show-widget>`

describe('show-widget 兼容解析', () => {
  test('Given Pi 输出 XML tool-call 外壳 When 归一化 Then 转为 canonical fence 且移除重复闭合标签', () => {
    const normalized = normalizeShowWidgetMarkup(xmlToolCall)

    expect(normalized).toContain(`\`\`\`show-widget\n${payload}`)
    expect(normalized).toContain('\n\`\`\`')
    expect(normalized).not.toContain('<show-widget>')
  })

  test('Given Pi 输出 XML tool-call 外壳 When 解析 assistant 消息 Then 恢复 code widget', () => {
    const blocks = parseAssistantRenderableBlocks(`前置说明\n${xmlToolCall}\n后置说明`)

    expect(blocks).toHaveLength(3)
    expect(blocks[0]).toEqual({ kind: 'markdown', markdown: '前置说明\n' })
    expect(blocks[1]).toMatchObject({
      kind: 'codeWidget',
      title: '趋势图',
      widgetCode: '<div><svg><path d="M0 0" /></svg></div>',
    })
    expect(blocks[2]).toEqual({ kind: 'markdown', markdown: '\n后置说明' })
  })

  test('Given XML widget 在流式内容中已经闭合 When 解析 Then 与完整消息使用相同 widget 结果', () => {
    const result = parseStreamingAssistantBlocks(xmlToolCall)

    expect(result.partialWidget).toBeUndefined()
    expect(result.completedBlocks).toHaveLength(1)
    expect(result.completedBlocks[0]).toMatchObject({
      kind: 'codeWidget',
      title: '趋势图',
    })
  })

  test('Given assistant 正文包含 XML widget When 生成复制文本 Then 不泄漏工具标记和 widget payload', () => {
    expect(stripWidgetFencesToPlainText(`说明\n${xmlToolCall}\n结束`)).toBe('说明\n结束')
  })
})

describe('Schema Widget 图表校验', () => {
  test('Given 图表缺少 xKey 或 series 数据 When 解析 Then 拒绝静默补零', () => {
    const invalidPayload = JSON.stringify({
      kind: 'schema',
      widget_type: 'line-chart',
      spec: {
        xKey: 'month',
        series: [{ key: 'revenue', label: '收入' }],
        data: [
          { month: '一月', revenue: 10 },
          { revenue: 20 },
          { month: '三月' },
        ],
      },
    })

    const blocks = parseAssistantRenderableBlocks(`\`\`\`show-widget\n${invalidPayload}\n\`\`\``)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.kind).toBe('markdown')
  })

  test('Given series 值为空或非有限数字 When 解析 Then 拒绝无效图表', () => {
    for (const invalidValue of ['', 'not-a-number', Number.POSITIVE_INFINITY]) {
      const invalidPayload = {
        kind: 'schema',
        widget_type: 'bar-chart',
        spec: {
          xKey: 'name',
          series: [{ key: 'value', label: '数值' }],
          data: [{ name: 'A', value: invalidValue }],
        },
      }

      const blocks = parseAssistantRenderableBlocks(`\`\`\`show-widget\n${JSON.stringify(invalidPayload)}\n\`\`\``)
      expect(blocks).toHaveLength(1)
      expect(blocks[0]?.kind).toBe('markdown')
    }
  })

  test('Given 完整且数值可转换的图表 When 解析 Then 保留 Schema Widget', () => {
    const validPayload = JSON.stringify({
      kind: 'schema',
      widget_type: 'line-chart',
      spec: {
        xKey: 'month',
        series: [{ key: 'revenue', label: '收入' }],
        data: [{ month: '一月', revenue: '10.5' }],
      },
    })

    expect(parseAssistantRenderableBlocks(`\`\`\`show-widget\n${validPayload}\n\`\`\``)[0]).toMatchObject({
      kind: 'schemaWidget',
      widgetType: 'line-chart',
    })
  })
})
