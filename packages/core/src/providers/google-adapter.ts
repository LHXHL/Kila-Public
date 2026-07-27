/**
 * Google Generative AI 供应商适配器
 *
 * 实现 Google Generative AI (Gemini) API 的非流式请求构建与响应解析（标题 + 视觉描述）。
 * 特点：
 * - 角色：user / model（注意：assistant 映射为 model）
 * - 图片格式：{ inline_data: { mime_type, data } }
 * - 认证：API Key 通过 x-goog-api-key 请求头传递
 */

import type {
  ProviderAdapter,
  ProviderRequest,
  TitleRequestInput,
  VisionRequestInput,
} from './types.ts'
import { normalizeBaseUrl } from './url-utils.ts'

// ===== Google 特有类型 =====

/** Google 非流式响应（标题与视觉描述共用） */
interface GoogleTitleResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>
    }
  }>
}

// ===== 适配器实现 =====

export class GoogleAdapter implements ProviderAdapter {
  readonly providerType = 'google' as const

  buildTitleRequest(input: TitleRequestInput): ProviderRequest {
    const url = normalizeBaseUrl(input.baseUrl)

    return {
      url: `${url}/v1beta/models/${input.modelId}:generateContent`,
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': input.apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
        generationConfig: { maxOutputTokens: 50 },
      }),
    }
  }

  parseTitleResponse(responseBody: unknown): string | null {
    const data = responseBody as GoogleTitleResponse
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null
  }

  buildVisionRequest(input: VisionRequestInput): ProviderRequest {
    const url = normalizeBaseUrl(input.baseUrl)

    return {
      url: `${url}/v1beta/models/${input.modelId}:generateContent`,
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': input.apiKey,
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { inline_data: { mime_type: input.image.mimeType, data: input.image.data } },
            { text: input.prompt || '请详细描述这张图片的内容。' },
          ],
        }],
        generationConfig: { maxOutputTokens: 2048 },
      }),
    }
  }

  parseVisionResponse(responseBody: unknown): string | null {
    return this.parseTitleResponse(responseBody)
  }
}
