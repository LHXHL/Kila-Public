import { describe, expect, test } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import {
  createMemoryTools,
  resolveMemoryWriteProjectPath,
} from './memory-tools'

describe('memory_write 作用域', () => {
  test('Given 未指定作用域，When 写入用户长期偏好，Then 默认保存为全局记忆', () => {
    expect(resolveMemoryWriteProjectPath(undefined, '/tmp/session-project')).toBeUndefined()
  })

  test('Given 明确指定项目作用域，When 当前会话已绑定项目，Then 保存到当前项目', () => {
    expect(resolveMemoryWriteProjectPath('project', '/tmp/session-project')).toBe('/tmp/session-project')
  })

  test('Given 明确指定项目作用域但会话没有项目，When 解析写入目标，Then 拒绝静默降级', () => {
    expect(() => resolveMemoryWriteProjectPath('project', undefined)).toThrow('当前会话未绑定项目')
  })
})


describe('memory_write 持久化时机', () => {
  test('Given Nowledge 返回真实 URI，When memory_write 写入成功，Then 明确反馈已持久化到 Nowledge', async () => {
    const writes: Array<{ content: string; projectPath?: string }> = []
    const tools = createMemoryTools({
      sessionId: 'session-immediate',
      backendAvailable: true,
    }, {
      writeMemory: async (input) => {
        writes.push({ content: input.content, projectPath: input.projectPath })
        return {
          kind: 'memory',
          id: 'nowledge-memory-1',
          uri: 'memory://nowledge-memory-1',
          content: input.content,
          tags: input.tags ?? [],
          category: input.category ?? 'general',
          sourceSessionId: input.sourceSessionId,
          projectPath: input.projectPath,
          createdAt: 1,
          updatedAt: 1,
        }
      },
    })
    const tool = tools.find((candidate) => candidate.name === 'memory_write')
    if (!tool) throw new Error('memory_write tool not registered')

    const result = await tool.execute('tool-1', {
      content: '立即可见的 Nowledge 记忆',
      category: 'fact',
    })
    const textContent = result.content.find((item) => item.type === 'text')

    expect(writes).toEqual([{ content: '立即可见的 Nowledge 记忆' }])
    expect(textContent?.text).toContain('已写入 Nowledge 长期记忆')
    expect(textContent?.text).not.toContain('缓冲区')
    expect(result.details).toMatchObject({
      persisted: true,
      provider: 'nowledge',
      uri: 'memory://nowledge-memory-1',
    })
  })

  test('Given 本地存储已移除，When memory_write 描述被注入模型上下文，Then 不再宣称存在本地 Markdown 回退', () => {
    const tools = createMemoryTools({ sessionId: 'session-desc', backendAvailable: true })
    const tool = tools.find((candidate) => candidate.name === 'memory_write')
    if (!tool) throw new Error('memory_write tool not registered')

    expect(tool.description).not.toContain('本地 Markdown')
    expect(tool.description).toContain('仅写入 Nowledge')
  })

  test('Given 当前后端写入失败，When memory_write 被调用，Then 将错误直接交给 Agent 而不是伪装成成功', async () => {
    const tools = createMemoryTools({
      sessionId: 'session-failure',
      backendAvailable: true,
    }, {
      writeMemory: async () => {
        throw new Error('Nowledge 已启用但当前不可用')
      },
    })
    const tool = tools.find((candidate) => candidate.name === 'memory_write')
    if (!tool) throw new Error('memory_write tool not registered')

    await expect(tool.execute('tool-2', { content: '不得伪装成功' })).rejects.toThrow('Nowledge 已启用但当前不可用')
  })
})

describe('working memory 作用域 schema', () => {
  function schemaOf(toolName: string) {
    const tools = createMemoryTools({
      sessionId: 'session-scope',
      projectPath: '/tmp/session-project',
      backendAvailable: true,
    })
    const tool = tools.find((candidate) => candidate.name === toolName)
    if (!tool) throw new Error(`${toolName} tool not registered`)
    return tool.parameters
  }

  test('Given 项目级 working memory 已随本地存储移除，When memory_context 传 project 作用域，Then schema 层直接拒绝', () => {
    expect(Value.Check(schemaOf('memory_context'), { action: 'get', scope: 'project' })).toBe(false)
    expect(Value.Check(schemaOf('memory_context'), { action: 'get', scope: 'global' })).toBe(true)
    expect(Value.Check(schemaOf('memory_context'), { action: 'get' })).toBe(true)
  })

  test('Given 项目级 working memory 已随本地存储移除，When memory_context_patch 传 project 作用域，Then schema 层直接拒绝', () => {
    const schema = schemaOf('memory_context_patch')
    expect(Value.Check(schema, { section: '## Notes', append: 'x', scope: 'project' })).toBe(false)
    expect(Value.Check(schema, { section: '## Notes', append: 'x', scope: 'global' })).toBe(true)
  })

  test('Given 长期记忆写入仍支持项目作用域，When 检查 memory_write schema，Then project 依然是合法枚举', () => {
    expect(Value.Check(schemaOf('memory_write'), { content: '项目约束', scope: 'project' })).toBe(true)
  })
})
