import { describe, expect, test } from 'bun:test'
import {
  buildDynamicContextProjection,
  buildGoalEvaluationPrompt,
  buildSystemPromptAppend,
  evaluateGoalExecution,
} from './agent-prompt-builder'
import { composeAgentPrompt } from './memory/prompt-compose'

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

  test('目标自动评估会列出三种模式并要求直接按判断推进', () => {
    const prompt = buildGoalEvaluationPrompt('auto')

    expect(prompt).toContain('mode="auto"')
    expect(prompt).toContain('definite')
    expect(prompt).toContain('exploratory')
    expect(prompt).toContain('incremental')
    expect(prompt).toContain('无需仅为报告模式而打断用户')
  })

  test('手动目标模式只注入对应的执行策略', () => {
    const prompt = buildGoalEvaluationPrompt('definite')

    expect(prompt).toContain('mode="definite"')
    expect(prompt).toContain('验收结果')
    expect(prompt).not.toContain('mode="exploratory"')
  })

  test('自动目标评估会把明确交付目标归类为 definite', () => {
    expect(evaluateGoalExecution('请实现登录功能并运行测试')).toMatchObject({
      selectedMode: 'definite',
    })
  })

  test('自动目标评估会把调查类目标归类为 exploratory', () => {
    expect(evaluateGoalExecution('分析当前性能瓶颈并比较可行的优化方案')).toMatchObject({
      selectedMode: 'exploratory',
    })
  })

  test('自动目标评估会把跨阶段目标归类为 incremental', () => {
    expect(evaluateGoalExecution('分阶段完成整个系统迁移，先制定里程碑再逐步交付')).toMatchObject({
      selectedMode: 'incremental',
    })
  })
})
