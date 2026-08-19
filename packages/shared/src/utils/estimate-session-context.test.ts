import { describe, expect, test } from 'bun:test'
import type { SessionMessage } from '../types'
import * as sharedUtils from './index'

type CalibrationSnapshot = {
  modelId: string
  fingerprint: string
  estimatedTokens: number
  actualTokens: number
}

type EstimateSessionContext = (input: {
  modelId: string
  contextWindow?: number
  historyTurns?: number | 'infinite'
  systemPrompt: string
  dynamicContext: string
  visibleMessages: SessionMessage[]
  currentTurnText?: string
  attachedFilesBlock?: string
  calibration?: CalibrationSnapshot
}) => {
  fingerprint: string
  estimatedTokens: number
  displayTokens: number
  contextWindow?: number
  calibrationRatio?: number
}

const estimateSessionContext = (sharedUtils as typeof sharedUtils & {
  estimateSessionContext?: EstimateSessionContext
}).estimateSessionContext

const buildSessionContextSnapshot = (sharedUtils as typeof sharedUtils & {
  buildSessionContextSnapshot?: (input: {
    modelId: string
    contextWindow?: number
    historyTurns?: number | 'infinite'
    systemPrompt: string
    dynamicContext: string
    historyMessages: SessionMessage[]
    currentTurnText: string
    toolDefinitions?: Array<{ name?: string; description?: string }>
  }) => {
    fingerprint: string
    estimatedInputTokens: number
    segmentSummary: {
      systemPromptChars: number
      historyChars: number
      historyTurns: number
      attachmentsChars: number
      currentTurnChars: number
      toolDefinitionsChars: number
    }
    contextWindow?: number
    modelId: string
  }
}).buildSessionContextSnapshot

function createMessage(overrides: Partial<SessionMessage>): SessionMessage {
  return {
    id: overrides.id ?? 'message-1',
    role: overrides.role ?? 'user',
    content: overrides.content ?? 'message',
    createdAt: overrides.createdAt ?? 1,
    ...overrides,
  }
}

describe('estimateSessionContext', () => {
  test('produces a stable estimate and fingerprint for the same visible payload', () => {
    expect(typeof estimateSessionContext).toBe('function')
    if (typeof estimateSessionContext !== 'function') return

    const input = {
      modelId: 'gpt-5.2',
      contextWindow: 400000,
      historyTurns: 'infinite' as const,
      systemPrompt: 'Static prompt append',
      dynamicContext: 'Current time + project state',
      visibleMessages: [
        createMessage({ id: 'u1', role: 'user', content: 'Summarize the repo' }),
        createMessage({ id: 'a1', role: 'assistant', content: 'Sure, here is the summary.' }),
      ],
      currentTurnText: 'Now estimate the context badge state.',
    }

    const first = estimateSessionContext(input)
    const second = estimateSessionContext(input)

    expect(first.fingerprint).toBe(second.fingerprint)
    expect(first.estimatedTokens).toBe(second.estimatedTokens)
    expect(first.displayTokens).toBe(second.displayTokens)
    expect(first.contextWindow).toBe(400000)
  })

  test('reduces the estimate when history turns shrink', () => {
    expect(typeof estimateSessionContext).toBe('function')
    if (typeof estimateSessionContext !== 'function') return

    const visibleMessages = [
      createMessage({ id: 'u1', role: 'user', content: 'first question' }),
      createMessage({ id: 'a1', role: 'assistant', content: 'first answer' }),
      createMessage({ id: 'u2', role: 'user', content: 'second question' }),
      createMessage({ id: 'a2', role: 'assistant', content: 'second answer' }),
    ]

    const full = estimateSessionContext({
      modelId: 'gpt-5.2',
      contextWindow: 400000,
      historyTurns: 'infinite',
      systemPrompt: 'Static prompt append',
      dynamicContext: 'Current time + project state',
      visibleMessages,
      currentTurnText: 'follow-up',
    })

    const reduced = estimateSessionContext({
      modelId: 'gpt-5.2',
      contextWindow: 400000,
      historyTurns: 1,
      systemPrompt: 'Static prompt append',
      dynamicContext: 'Current time + project state',
      visibleMessages: visibleMessages.slice(-2),
      currentTurnText: 'follow-up',
    })

    expect(reduced.estimatedTokens).toBeLessThan(full.estimatedTokens)
  })

  test('counts attached file blocks as part of the sent context', () => {
    expect(typeof estimateSessionContext).toBe('function')
    if (typeof estimateSessionContext !== 'function') return

    const withoutFiles = estimateSessionContext({
      modelId: 'gpt-5.2',
      contextWindow: 400000,
      historyTurns: 'infinite',
      systemPrompt: 'Static prompt append',
      dynamicContext: 'Current time + project state',
      visibleMessages: [createMessage({ id: 'u1', role: 'user', content: 'Open the design doc' })],
      currentTurnText: 'Please use the attachments.',
    })

    const withFiles = estimateSessionContext({
      modelId: 'gpt-5.2',
      contextWindow: 400000,
      historyTurns: 'infinite',
      systemPrompt: 'Static prompt append',
      dynamicContext: 'Current time + project state',
      visibleMessages: [createMessage({ id: 'u1', role: 'user', content: 'Open the design doc' })],
      currentTurnText: 'Please use the attachments.',
      attachedFilesBlock: '<attached_files>\n- spec.md: /tmp/spec.md\n</attached_files>',
    })

    expect(withFiles.estimatedTokens).toBeGreaterThan(withoutFiles.estimatedTokens)
  })

  test('reuses the latest real usage only when the model and fingerprint still match', () => {
    expect(typeof estimateSessionContext).toBe('function')
    if (typeof estimateSessionContext !== 'function') return

    const base = estimateSessionContext({
      modelId: 'gpt-5.2',
      contextWindow: 400000,
      historyTurns: 'infinite',
      systemPrompt: 'Static prompt append',
      dynamicContext: 'Current time + project state',
      visibleMessages: [createMessage({ id: 'u1', role: 'user', content: 'same payload' })],
      currentTurnText: 'same payload',
    })

    const calibrated = estimateSessionContext({
      modelId: 'gpt-5.2',
      contextWindow: 400000,
      historyTurns: 'infinite',
      systemPrompt: 'Static prompt append',
      dynamicContext: 'Current time + project state',
      visibleMessages: [createMessage({ id: 'u1', role: 'user', content: 'same payload' })],
      currentTurnText: 'same payload',
      calibration: {
        modelId: 'gpt-5.2',
        fingerprint: base.fingerprint,
        estimatedTokens: base.estimatedTokens,
        actualTokens: 1234,
      },
    })

    const mismatched = estimateSessionContext({
      modelId: 'gpt-4o-mini',
      contextWindow: 128000,
      historyTurns: 'infinite',
      systemPrompt: 'Static prompt append',
      dynamicContext: 'Current time + project state',
      visibleMessages: [createMessage({ id: 'u1', role: 'user', content: 'same payload' })],
      currentTurnText: 'same payload',
      calibration: {
        modelId: 'gpt-5.2',
        fingerprint: base.fingerprint,
        estimatedTokens: base.estimatedTokens,
        actualTokens: 1234,
      },
    })

    expect(calibrated.displayTokens).toBe(1234)
    expect(calibrated.calibrationRatio).toBeDefined()
    expect(mismatched.displayTokens).not.toBe(1234)
    expect(mismatched.calibrationRatio).toBeUndefined()
  })

  test('builds a send-time context snapshot with segment summaries', () => {
    expect(typeof buildSessionContextSnapshot).toBe('function')
    if (typeof buildSessionContextSnapshot !== 'function') return

    const snapshot = buildSessionContextSnapshot({
      modelId: 'claude-sonnet-4-5',
      contextWindow: 200000,
      historyTurns: 'infinite',
      systemPrompt: 'System prompt',
      dynamicContext: 'Project context',
      historyMessages: [
        createMessage({ id: 'u1', role: 'user', content: 'Read src/index.ts' }),
        createMessage({ id: 'a1', role: 'assistant', content: 'I will inspect it.' }),
      ],
      currentTurnText: 'Continue the implementation.',
      toolDefinitions: [
        { name: 'Read', description: 'Read file content' },
        { name: 'Edit', description: 'Edit a file' },
      ],
    })

    expect(snapshot.modelId).toBe('claude-sonnet-4-5')
    expect(snapshot.contextWindow).toBe(200000)
    expect(snapshot.estimatedInputTokens).toBeGreaterThan(0)
    expect(snapshot.segmentSummary.historyTurns).toBe(1)
    expect(snapshot.segmentSummary.toolDefinitionsChars).toBeGreaterThan(0)
    expect(snapshot.segmentSummary.currentTurnChars).toBe('Continue the implementation.'.length)
  })
})

describe('buildSessionContextSnapshot 构成分解', () => {
  test('Given 内置与 MCP 工具混合 When 构建快照 Then 工具 token 按来源分组到对应分段', () => {
    const snapshot = buildSessionContextSnapshot({
      modelId: 'test-model',
      systemPrompt: 'You are a coding agent.',
      dynamicContext: '<user_clock_context>now</user_clock_context>',
      historyMessages: [createMessage({ id: 'u1', role: 'user', content: 'hello' })],
      currentTurnText: 'world',
      toolDefinitions: [
        { name: 'read', description: 'Read file content', source: 'builtin' },
        { name: 'bash', description: 'Run shell command', source: 'builtin' },
        { name: 'db__query', description: 'Query the database', source: 'mcp' },
      ],
    })

    const partition = snapshot.contextPartition!
    expect(partition.systemToolsTokens).toBeGreaterThan(0)
    expect(partition.mcpToolsTokens).toBeGreaterThan(0)
    // MCP 描述明显更长时不应被计入系统工具
    expect(partition.mcpToolsTokens).toBeGreaterThan(partition.systemToolsTokens / 2)
  })

  test('Given 技能列表段 When 构建快照 Then 技能单列且其余动态上下文归入 other', () => {
    const skills = '全局 Skills:\n- write: 写作技能 (/root/.kila/global-agent/skills/write/SKILL.md)'
    const dynamicContext = `<user_clock_context>time</user_clock_context>\n\n${skills}`
    const snapshot = buildSessionContextSnapshot({
      modelId: 'test-model',
      systemPrompt: 'sys',
      dynamicContext,
      skillContextText: skills,
      historyMessages: [],
      currentTurnText: 'go',
    })

    const partition = snapshot.contextPartition!
    expect(partition.skillsTokens).toBeGreaterThan(0)
    expect(partition.otherTokens).toBeGreaterThan(0)
    // other 不应吞掉技能段（差值口径允许少量估算误差，但不应归零）
    expect(partition.otherTokens).toBeLessThan(partition.skillsTokens * 2)
  })

  test('Given 空工具与空技能 When 构建快照 Then 对应分段为零而不是 NaN', () => {
    const snapshot = buildSessionContextSnapshot({
      modelId: 'm',
      systemPrompt: 'sys',
      dynamicContext: 'ctx',
      historyMessages: [createMessage({ id: 'u1', role: 'user', content: 'hi' })],
      currentTurnText: '',
    })

    const partition = snapshot.contextPartition!
    expect(partition.systemToolsTokens).toBe(0)
    expect(partition.mcpToolsTokens).toBe(0)
    expect(partition.skillsTokens).toBe(0)
    expect(partition.messagesTokens).toBeGreaterThan(0)
    expect(Number.isFinite(partition.otherTokens)).toBe(true)
  })
})
