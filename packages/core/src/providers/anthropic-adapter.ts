/**
 * Anthropic 供应商适配器
 *
 * 实现 Anthropic Messages API 的非流式请求构建与响应解析（标题 + 视觉描述）。
 * 特点：
 * - 图片格式：{ type: 'image', source: { type: 'base64', media_type, data } }
 * - 认证：x-api-key + Authorization: Bearer
 */

import type {
  ProviderAdapter,
  ProviderRequest,
  TitleRequestInput,
  VisionRequestInput,
} from './types.ts'
import { normalizeAnthropicBaseUrl } from './url-utils.ts'

// ===== Anthropic 特有类型 =====

/** Anthropic 内容块（视觉请求使用） */
interface AnthropicContentBlock {
  type: 'text' | 'image'
  text?: string
  source?: {
    type: 'base64'
    media_type: string
    data: string
  }
}

/** Anthropic 非流式响应（标题与视觉描述共用） */
interface AnthropicTitleResponse {
  content?: Array<{
    type: string
    text?: string
    thinking?: string
  }>
}

// ===== 适配器实现 =====

export class AnthropicAdapter implements ProviderAdapter {
  readonly providerType = 'anthropic' as const

  buildTitleRequest(input: TitleRequestInput): ProviderRequest {
    const url = normalizeAnthropicBaseUrl(input.baseUrl)

    return {
      url: `${url}/messages`,
      headers: {
        'x-api-key': input.apiKey,
        'Authorization': `Bearer ${input.apiKey}`,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: input.modelId,
        max_tokens: 50,
        messages: [{ role: 'user', content: input.prompt }],
        // 禁用 extended thinking（MiniMax 等供应商也会遵循此设置）
        thinking: { type: 'disabled' },
      }),
    }
  }

  parseTitleResponse(responseBody: unknown): string | null {
    const data = responseBody as AnthropicTitleResponse
    if (!data.content || data.content.length === 0) return null

    // 优先查找 type === "text" 的块
    const textBlock = data.content.find((block) => block.type === 'text')
    if (textBlock?.text) return textBlock.text

    // 如果没有 text 块，尝试从第一个 thinking 块中提取（MiniMax 兼容）
    const thinkingBlock = data.content.find((block) => block.type === 'thinking')
    if (thinkingBlock?.thinking) {
      const lines = thinkingBlock.thinking.trim().split('\n')
      const lastLine = lines[lines.length - 1]?.trim()
      if (lastLine?.startsWith('- ')) {
        return lastLine.slice(2).trim()
      }
      return lastLine || null
    }

    return null
  }

  buildVisionRequest(input: VisionRequestInput): ProviderRequest {
    const url = normalizeAnthropicBaseUrl(input.baseUrl)
    const content: AnthropicContentBlock[] = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: input.image.mimeType,
          data: input.image.data,
        },
      },
      { type: 'text', text: input.prompt || '请详细描述这张图片的内容。' },
    ]

    return {
      url: `${url}/messages`,
      headers: {
        'x-api-key': input.apiKey,
        'Authorization': `Bearer ${input.apiKey}`,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: input.modelId,
        max_tokens: 2048,
        messages: [{ role: 'user' as const, content }],
        thinking: { type: 'disabled' },
      }),
    }
  }

  parseVisionResponse(responseBody: unknown): string | null {
    return this.parseTitleResponse(responseBody)
  }
}
