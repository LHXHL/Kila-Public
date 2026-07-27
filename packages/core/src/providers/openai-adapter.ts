/**
 * OpenAI 兼容供应商适配器
 *
 * 实现 OpenAI Chat Completions API 的非流式请求构建与响应解析（标题 + 视觉描述）。
 * 同时适用于 OpenAI、DeepSeek 和自定义 OpenAI 兼容 API。
 * 特点：
 * - 图片格式：{ type: 'image_url', image_url: { url: 'data:mime;base64,...' } }
 * - 认证：Authorization: Bearer
 */

import type {
  ProviderAdapter,
  ProviderRequest,
  TitleRequestInput,
  VisionRequestInput,
} from './types.ts'
import { normalizeBaseUrl } from './url-utils.ts'

// ===== OpenAI 特有类型 =====

/** OpenAI 非流式响应（标题与视觉描述共用） */
interface OpenAITitleResponse {
  choices?: Array<{ message?: { content?: string } }>
}

// ===== 适配器实现 =====

export class OpenAIAdapter implements ProviderAdapter {
  readonly providerType = 'openai' as const

  buildTitleRequest(input: TitleRequestInput): ProviderRequest {
    const url = normalizeBaseUrl(input.baseUrl)

    return {
      url: `${url}/chat/completions`,
      headers: {
        'Authorization': `Bearer ${input.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: input.modelId,
        messages: [{ role: 'user', content: input.prompt }],
        max_tokens: 50,
      }),
    }
  }

  parseTitleResponse(responseBody: unknown): string | null {
    const data = responseBody as OpenAITitleResponse
    return data.choices?.[0]?.message?.content ?? null
  }

  buildVisionRequest(input: VisionRequestInput): ProviderRequest {
    const url = normalizeBaseUrl(input.baseUrl)

    return {
      url: `${url}/chat/completions`,
      headers: {
        'Authorization': `Bearer ${input.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: input.modelId,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${input.image.mimeType};base64,${input.image.data}` },
            },
            { type: 'text', text: input.prompt || '请详细描述这张图片的内容。' },
          ],
        }],
        max_tokens: 2048,
      }),
    }
  }

  parseVisionResponse(responseBody: unknown): string | null {
    return this.parseTitleResponse(responseBody)
  }
}
