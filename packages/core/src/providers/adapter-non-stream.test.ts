/**
 * Provider 非流式适配器回归测试
 *
 * core 的流式链路已整体移除，这里锁定剩余的两条真实消费路径：
 * - 标题生成（session-title-service / session-suggestion-service）
 * - 视觉描述（agent-tools/vision-tool）
 * 同时锁定“不得输出请求体/响应体”的日志脱敏要求。
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { fetchTitle, fetchVisionDescription, getAdapter } from './index.ts'

interface CapturedRequest {
  url: string
  init?: RequestInit
}

/** 构造一个只回放固定 JSON 的假 fetch，并记录收到的请求 */
function createFakeFetch(
  responseBody: unknown,
  options: { ok?: boolean; status?: number } = {},
): { fetchFn: typeof globalThis.fetch; captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = []
  const fetchFn = (async (url: string, init?: RequestInit) => {
    captured.push({ url, init })
    return {
      ok: options.ok ?? true,
      status: options.status ?? 200,
      statusText: 'OK',
      json: async () => responseBody,
      text: async () => JSON.stringify(responseBody),
    }
  }) as unknown as typeof globalThis.fetch
  return { fetchFn, captured }
}

const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  info: console.info,
}

/** 捕获 console 输出，用于验证不再泄漏请求体/响应体 */
function captureConsole(): string[] {
  const lines: string[] = []
  const record = (...args: unknown[]): void => { lines.push(args.map(String).join(' ')) }
  console.log = record
  console.warn = record
  console.error = record
  console.info = record
  return lines
}

afterEach(() => {
  console.log = originalConsole.log
  console.warn = originalConsole.warn
  console.error = originalConsole.error
  console.info = originalConsole.info
})

describe('标题生成路径', () => {
  test('Given Anthropic 渠道 When 构建并解析标题请求 Then 返回 text 块内容', async () => {
    const adapter = getAdapter('anthropic')
    const request = adapter.buildTitleRequest({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-test',
      modelId: 'claude-x',
      prompt: '为这段对话取标题：你好',
    })

    expect(request.url).toBe('https://api.anthropic.com/v1/messages')
    expect(request.headers['x-api-key']).toBe('sk-test')

    const { fetchFn } = createFakeFetch({ content: [{ type: 'text', text: '打招呼' }] })
    await expect(fetchTitle(request, adapter, fetchFn)).resolves.toBe('打招呼')
  })

  test('Given OpenAI 兼容渠道 When 解析标题响应 Then 返回 choices 首条内容', async () => {
    const adapter = getAdapter('deepseek')
    const request = adapter.buildTitleRequest({
      baseUrl: 'https://api.deepseek.com/v1/',
      apiKey: 'sk-test',
      modelId: 'deepseek-chat',
      prompt: 'p',
    })

    expect(request.url).toBe('https://api.deepseek.com/v1/chat/completions')

    const { fetchFn } = createFakeFetch({ choices: [{ message: { content: '会话标题' } }] })
    await expect(fetchTitle(request, adapter, fetchFn)).resolves.toBe('会话标题')
  })

  test('Given Google 渠道 When 解析标题响应 Then 返回 candidates 首个 part 文本', async () => {
    const adapter = getAdapter('google')
    const request = adapter.buildTitleRequest({
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKey: 'key',
      modelId: 'gemini-x',
      prompt: 'p',
    })

    expect(request.url).toContain('/v1beta/models/gemini-x:generateContent')

    const { fetchFn } = createFakeFetch({
      candidates: [{ content: { parts: [{ text: 'Gemini 标题' }] } }],
    })
    await expect(fetchTitle(request, adapter, fetchFn)).resolves.toBe('Gemini 标题')
  })

  test('Given 未注册的聚合商 provider When 获取适配器 Then 回落到 OpenAI 兼容协议', () => {
    const adapter = getAdapter('openrouter')
    const request = adapter.buildTitleRequest({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk',
      modelId: 'm',
      prompt: 'p',
    })
    expect(request.url).toBe('https://openrouter.ai/api/v1/chat/completions')
  })

  test('Given Provider 返回非 2xx When 请求标题 Then 返回 null 且不抛出', async () => {
    const adapter = getAdapter('openai')
    const request = adapter.buildTitleRequest({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk',
      modelId: 'm',
      prompt: 'p',
    })
    const { fetchFn } = createFakeFetch({ error: 'boom' }, { ok: false, status: 401 })
    await expect(fetchTitle(request, adapter, fetchFn)).resolves.toBeNull()
  })
})

describe('视觉描述路径', () => {
  test('Given Anthropic 渠道 When 构建视觉请求 Then 请求体携带 base64 图片块', async () => {
    const adapter = getAdapter('anthropic')
    const request = adapter.buildVisionRequest({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk',
      modelId: 'claude-x',
      image: { data: 'AAAA', mimeType: 'image/png' },
    })

    const body = JSON.parse(request.body) as {
      messages: Array<{ content: Array<{ type: string; source?: { media_type: string } }> }>
    }
    expect(body.messages[0]?.content[0]?.type).toBe('image')
    expect(body.messages[0]?.content[0]?.source?.media_type).toBe('image/png')

    const { fetchFn } = createFakeFetch({ content: [{ type: 'text', text: '一只猫' }] })
    await expect(fetchVisionDescription(request, adapter, fetchFn)).resolves.toBe('一只猫')
  })

  test('Given OpenAI 兼容渠道 When 构建视觉请求 Then 图片走 data URL', async () => {
    const adapter = getAdapter('openai')
    const request = adapter.buildVisionRequest({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk',
      modelId: 'gpt-x',
      image: { data: 'BBBB', mimeType: 'image/jpeg' },
      prompt: '描述图片',
    })

    expect(request.body).toContain('data:image/jpeg;base64,BBBB')
    expect(request.body).toContain('描述图片')

    const { fetchFn } = createFakeFetch({ choices: [{ message: { content: '一张风景照' } }] })
    await expect(fetchVisionDescription(request, adapter, fetchFn)).resolves.toBe('一张风景照')
  })
})

describe('日志脱敏', () => {
  test('Given 标题请求成功 When 执行 fetchTitle Then 不输出任何请求体或响应体日志', async () => {
    const adapter = getAdapter('openai')
    const request = adapter.buildTitleRequest({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-secret',
      modelId: 'm',
      prompt: '用户的私密会话内容',
    })
    const { fetchFn } = createFakeFetch({ choices: [{ message: { content: '标题' } }] })

    const lines = captureConsole()
    await fetchTitle(request, adapter, fetchFn)

    expect(lines).toEqual([])
  })

  test('Given 标题请求失败 When 执行 fetchTitle Then 仍然不输出 Provider 原始响应', async () => {
    const adapter = getAdapter('openai')
    const request = adapter.buildTitleRequest({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-secret',
      modelId: 'm',
      prompt: '用户的私密会话内容',
    })
    const { fetchFn } = createFakeFetch({ error: '原始响应正文' }, { ok: false, status: 500 })

    const lines = captureConsole()
    await fetchTitle(request, adapter, fetchFn)

    expect(lines).toEqual([])
  })
})
