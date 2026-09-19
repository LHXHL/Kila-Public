import { describe, expect, test } from 'bun:test'
import { createRuntimeConfigFingerprint, resolveRuntimeConfigVersions } from './runtime-config'

describe('Runtime config fingerprint', () => {
  test('Given API Key 变化但其余配置相同 When 计算 fingerprint Then 不触发 AgentSession 重建', () => {
    const first = createRuntimeConfigFingerprint({
      channel: { provider: 'openai', baseUrl: 'https://api.example', apiKey: 'secret-a' },
      model: { id: 'model-a', api: 'openai-completions' },
      systemPrompt: 'system',
      cwd: '/tmp/project',
      toolDescriptorsHash: 'tools-1',
      thinkingLevel: 'high',
    })
    const second = createRuntimeConfigFingerprint({
      channel: { apiKey: 'secret-b', baseUrl: 'https://api.example', provider: 'openai' },
      model: { api: 'openai-completions', id: 'model-a' },
      systemPrompt: 'system',
      cwd: '/tmp/project',
      toolDescriptorsHash: 'tools-1',
      thinkingLevel: 'high',
    })
    expect(second).toBe(first)
  })

  test('Given system prompt 或工具集合变化 When 计算 fingerprint Then 产生新的配置身份', () => {
    const base = {
      channel: { provider: 'openai' },
      model: { id: 'model-a' },
      systemPrompt: 'system',
      cwd: '/tmp/project',
      toolDescriptorsHash: 'tools-1',
      thinkingLevel: 'high',
    }
    expect(createRuntimeConfigFingerprint(base)).not.toBe(createRuntimeConfigFingerprint({ ...base, systemPrompt: 'changed' }))
    expect(createRuntimeConfigFingerprint(base)).not.toBe(createRuntimeConfigFingerprint({ ...base, toolDescriptorsHash: 'tools-2' }))
  })

  test('Given 只有 API Key 变化 When 计算版本 Then 只推进 credentialRevision', () => {
    expect(resolveRuntimeConfigVersions({
      configFingerprint: 'same',
      apiKeyFingerprint: 'key-2',
      previous: {
        configRevision: 3,
        configFingerprint: 'same',
        credentialRevision: 1,
        apiKeyFingerprint: 'key-1',
      },
    })).toEqual({ configRevision: 3, credentialRevision: 2 })
  })

  test('Given运行配置变化 When 计算版本 Then configRevision 与 credentialRevision 都单调递增', () => {
    expect(resolveRuntimeConfigVersions({
      configFingerprint: 'next',
      apiKeyFingerprint: 'key-2',
      previous: {
        configRevision: 3,
        configFingerprint: 'old',
        credentialRevision: 1,
        apiKeyFingerprint: 'key-1',
      },
    })).toEqual({ configRevision: 4, credentialRevision: 2 })
  })
})
