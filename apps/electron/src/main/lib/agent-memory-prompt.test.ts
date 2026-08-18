import { describe, expect, test } from 'bun:test'
import { composeAgentPrompt } from './memory/prompt-compose'
import { buildDynamicContextProjection, buildSystemPromptAppend } from './agent-prompt-builder'

describe('Agent memory prompt assembly', () => {
  test('Given 已构建的记忆 XML，When 组装最终 prompt，Then 注入正文而不是对象字符串', () => {
    const memoryText = '<memory_context><item>使用 Jotai</item></memory_context>\n\n'
    const result = composeAgentPrompt('dynamic', memoryText, '继续实现')

    expect(result).toContain(memoryText)
    expect(result).toContain('使用 Jotai')
    expect(result).not.toContain('[object Object]')
  })

  test('Given Nowledge 已启用，When Agent 检查状态，Then 不会把 browse-now 当作 Nowledge CLI', () => {
    const prompt = buildSystemPromptAppend({
      sessionId: 'memory-prompt-test',
      permissionMode: 'smart',
    })

    expect(prompt).toContain('nmem status')
    expect(prompt).toContain('不要使用 `browse-now status`')
    expect(prompt).not.toContain('memory-prompt-test')
  })

  test('runtime snapshot keeps stable state out of system prompt and exposes a stable fingerprint', async () => {
    const first = await buildDynamicContextProjection({
      sessionId: 'runtime-projection-test',
      projectName: 'Kila',
      agentCwd: 'C:/workspace/kila',
    })
    const second = await buildDynamicContextProjection({
      sessionId: 'runtime-projection-test',
      projectName: 'Kila',
      agentCwd: 'C:/workspace/kila',
    })

    expect(first.runtimeSnapshot).toContain('runtime-projection-test')
    expect(first.runtimeSnapshot).toEqual(second.runtimeSnapshot)
    expect(first.runtimeSnapshotFingerprint).toBe(second.runtimeSnapshotFingerprint)
    expect(first.perMessageContext).toContain('系统时间')
  })
})
